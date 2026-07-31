import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { finalizeJobAfterResidentFeedback } from "./finalizeAfterResidentFeedback.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import { findActiveLandlordMain } from "./sms/smsNumberPool.ts"
import type { SmsProviderName } from "./sms/types.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"

const RATING_REQUEST_BODY =
  "How was your repair experience? Reply 1–5."

const LOW_RATING_FOLLOWUP_BODY =
  "We're sorry to hear that.\n\nCan you briefly tell us what went wrong?"

const THANK_YOU_BODY =
  "Thank you for your feedback — it helps us improve vendor service."

export type RequestVendorFeedbackInput = {
  ticketId: string
  landlordId: string
  vendorId: string
  residentId?: string | null
  residentPhone?: string | null
  residentName?: string | null
}

export type VendorFeedbackHandleResult =
  | { handled: false }
  | {
      handled: true
      replyBody: string
      eventType: string
      vendorId: string
      maintenanceRequestId: string
      rating?: number
    }

const RATING_WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
}

/** Parse a 1–5 repair rating from a short SMS body. */
export function parseRating(body: string): number | null {
  const trimmed = body.trim()
  if (!trimmed) return null

  const exact = trimmed.match(/^([1-5])$/)
  if (exact) return Number(exact[1])

  const withScale = trimmed.match(/^([1-5])\s*[/／]\s*5$/)
  if (withScale) return Number(withScale[1])

  const stars = trimmed.match(/^([1-5])\s*(?:stars?|★|⭐️?)$/i)
  if (stars) return Number(stars[1])

  const starPrefix = trimmed.match(/^(?:★|⭐️?)\s*([1-5])$/i)
  if (starPrefix) return Number(starPrefix[1])

  const labeled = trimmed.match(/^(?:rate[d]?|rating)[:\s]+([1-5])(?:\s*[/／]\s*5)?$/i)
  if (labeled) return Number(labeled[1])

  const word = trimmed.toLowerCase().replace(/[^a-z]/g, "")
  if (word in RATING_WORD) return RATING_WORD[word]

  return null
}

export function ratingQualityLabel(rating: number): string {
  switch (rating) {
    case 1:
      return "Poor"
    case 2:
      return "Fair"
    case 3:
      return "Good"
    case 4:
      return "Very Good"
    case 5:
      return "Excellent"
    default:
      return ""
  }
}

type OpenFeedbackRequest = {
  id: string
  vendor_id: string
  maintenance_request_id: string
  resident_id: string | null
  conversation_id: string | null
  phase: string
  feedback_id: string | null
}

async function fetchOpenFeedbackRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId?: string | null
    residentId?: string | null
  },
): Promise<OpenFeedbackRequest | null> {
  const base = () =>
    supabase
      .from("vendor_feedback_requests")
      .select(
        "id, vendor_id, maintenance_request_id, resident_id, conversation_id, phase, feedback_id",
      )
      .eq("landlord_id", params.landlordId)
      .eq("rater_type", "resident")
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)

  if (params.conversationId) {
    const { data, error } = await base()
      .eq("conversation_id", params.conversationId)
      .maybeSingle()
    if (error) {
      console.error("[vendor-feedback] lookup by conversation", error.message)
    } else if (data) {
      return data as OpenFeedbackRequest
    }
  }

  // Fall back when the reply landed on a different conversation than the ask
  // (identity heal, new thread, or maintenance_request_id rebind).
  if (params.residentId) {
    const { data, error } = await base()
      .eq("resident_id", params.residentId)
      .maybeSingle()
    if (error) {
      console.error("[vendor-feedback] lookup by resident", error.message)
      return null
    }
    if (!data) return null
    const row = data as OpenFeedbackRequest
    if (
      params.conversationId &&
      row.conversation_id &&
      row.conversation_id !== params.conversationId
    ) {
      const { error: healErr } = await supabase
        .from("vendor_feedback_requests")
        .update({ conversation_id: params.conversationId })
        .eq("id", row.id)
      if (healErr) {
        console.warn(
          "[vendor-feedback] heal conversation_id",
          healErr.message,
        )
      } else {
        row.conversation_id = params.conversationId
      }
    }
    return row
  }

  return null
}

async function lookupOpenFeedbackRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId?: string | null
    residentId?: string | null
  },
): Promise<OpenFeedbackRequest | null> {
  if (!params.conversationId && !params.residentId) return null
  return fetchOpenFeedbackRequest(supabase, params)
}

/** Send post-completion resident SMS rating request (non-throwing). */
export async function requestVendorFeedback(
  supabase: SupabaseClient,
  input: RequestVendorFeedbackInput,
): Promise<void> {
  const phoneE164 = normalizePhoneFlexible(input.residentPhone)
  if (!phoneE164) {
    console.warn("[vendor-feedback] skip — no resident phone", input.ticketId)
    return
  }

  const { data: existingFeedback } = await supabase
    .from("vendor_feedback")
    .select("id")
    .eq("maintenance_request_id", input.ticketId)
    .eq("rater_type", "resident")
    .maybeSingle()

  if (existingFeedback?.id) {
    console.info("[vendor-feedback] skip — feedback already exists", input.ticketId)
    return
  }

  const { data: existingRequest } = await supabase
    .from("vendor_feedback_requests")
    .select("id, status")
    .eq("maintenance_request_id", input.ticketId)
    .eq("rater_type", "resident")
    .maybeSingle()

  if (existingRequest?.status === "open") {
    console.info("[vendor-feedback] skip — open request exists", input.ticketId)
    return
  }

  const smsNumber = await findActiveLandlordMain(supabase, input.landlordId)
  if (!smsNumber?.phone_number) {
    console.warn(
      "[vendor-feedback] skip — no landlord_main SMS number",
      input.landlordId,
    )
    return
  }

  const provider = (smsNumber.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: phoneE164,
    landlordId: input.landlordId,
    identityType: "resident",
    residentId: input.residentId ?? undefined,
  })

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: input.landlordId,
    smsNumberId: smsNumber.id,
    externalPhone: phoneE164,
    identity,
    maintenanceRequestId: input.ticketId,
    conversationStatus: "open",
  })

  const { data: requestRow, error: requestErr } = await supabase
    .from("vendor_feedback_requests")
    .insert({
      landlord_id: input.landlordId,
      vendor_id: input.vendorId,
      maintenance_request_id: input.ticketId,
      resident_id: input.residentId ?? null,
      conversation_id: conversationId,
      rater_type: "resident",
      phase: "rating",
      status: "open",
    })
    .select("id")
    .single()

  if (requestErr || !requestRow?.id) {
    console.error("[vendor-feedback] insert request", requestErr?.message)
    return
  }

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: input.landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: phoneE164,
    body: RATING_REQUEST_BODY,
    provider,
    source: "vendor_feedback_request",
  })

  if (!sent.ok) {
    console.warn("[vendor-feedback] SMS not delivered", {
      ticketId: input.ticketId,
      error: sent.error,
    })
  }

  await logGraphEvent(supabase, {
    landlord_id: input.landlordId,
    event_type: "vendor.feedback_requested",
    source: "edge_function",
    actor_type: "system",
    resident_id: input.residentId ?? null,
    vendor_id: input.vendorId,
    maintenance_request_id: input.ticketId,
    conversation_id: conversationId,
    metadata: {
      request_id: requestRow.id,
      sms_delivered: sent.ok,
    },
  })
}

/**
 * Handle inbound resident replies for vendor rating / low-score comment follow-up.
 * Returns handled=true when the message was consumed (caller should skip workflow routing).
 */
export async function tryHandleVendorFeedbackInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    residentId?: string | null
    identityType: string
  },
): Promise<VendorFeedbackHandleResult> {
  if (params.identityType !== "resident") {
    return { handled: false }
  }

  const request = await lookupOpenFeedbackRequest(supabase, {
    landlordId: params.landlordId,
    conversationId: params.conversationId,
    residentId: params.residentId,
  })

  if (!request) {
    return { handled: false }
  }

  const now = new Date().toISOString()

  if (request.phase === "rating") {
    const rating = parseRating(params.body)
    if (rating == null) {
      return {
        handled: true,
        replyBody:
          "Please reply with a number from 1 (Poor) to 5 (Excellent) to rate your maintenance experience.",
        eventType: "vendor.feedback_rating_invalid",
        vendorId: request.vendor_id,
        maintenanceRequestId: request.maintenance_request_id,
      }
    }

    const { data: feedback, error: feedbackErr } = await supabase
      .from("vendor_feedback")
      .insert({
        landlord_id: params.landlordId,
        vendor_id: request.vendor_id,
        maintenance_request_id: request.maintenance_request_id,
        resident_id: request.resident_id,
        rater_type: "resident",
        rating,
        submitted_at: now,
      })
      .select("id")
      .single()

    if (feedbackErr || !feedback?.id) {
      console.error("[vendor-feedback] insert feedback", feedbackErr?.message)
      return { handled: false }
    }

    if (rating <= 2) {
      await supabase
        .from("vendor_feedback_requests")
        .update({
          phase: "comment",
          feedback_id: feedback.id,
        })
        .eq("id", request.id)

      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "vendor.feedback_received",
        source: "sms",
        actor_type: "resident",
        actor_id: request.resident_id,
        resident_id: request.resident_id,
        vendor_id: request.vendor_id,
        maintenance_request_id: request.maintenance_request_id,
        conversation_id: params.conversationId,
        message_id: params.messageId,
        metadata: { rating, needs_comment: true },
      })

      return {
        handled: true,
        replyBody: LOW_RATING_FOLLOWUP_BODY,
        eventType: "vendor.feedback_received",
        vendorId: request.vendor_id,
        maintenanceRequestId: request.maintenance_request_id,
        rating,
      }
    }

    await supabase
      .from("vendor_feedback_requests")
      .update({
        status: "completed",
        feedback_id: feedback.id,
        completed_at: now,
      })
      .eq("id", request.id)

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.feedback_received",
      source: "sms",
      actor_type: "resident",
      actor_id: request.resident_id,
      resident_id: request.resident_id,
      vendor_id: request.vendor_id,
      maintenance_request_id: request.maintenance_request_id,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      metadata: { rating },
    })

    // Rating 3–5 closes the job on both ends; 4–5 queues invoice for Needs Your Attention.
    try {
      await finalizeJobAfterResidentFeedback(supabase, {
        landlordId: params.landlordId,
        ticketId: request.maintenance_request_id,
        vendorId: request.vendor_id,
        rating,
      })
    } catch (e) {
      console.error("[vendor-feedback] finalize after rating", e)
    }

    return {
      handled: true,
      replyBody: THANK_YOU_BODY,
      eventType: "vendor.feedback_received",
      vendorId: request.vendor_id,
      maintenanceRequestId: request.maintenance_request_id,
      rating,
    }
  }

  if (request.phase === "comment") {
    const comment = params.body.trim()
    if (!comment) {
      return {
        handled: true,
        replyBody: LOW_RATING_FOLLOWUP_BODY,
        eventType: "vendor.feedback_comment_invalid",
        vendorId: request.vendor_id,
        maintenanceRequestId: request.maintenance_request_id,
      }
    }

    if (request.feedback_id) {
      await supabase
        .from("vendor_feedback")
        .update({ comment })
        .eq("id", request.feedback_id)
    }

    await supabase
      .from("vendor_feedback_requests")
      .update({
        status: "completed",
        completed_at: now,
      })
      .eq("id", request.id)

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.feedback_comment_received",
      source: "sms",
      actor_type: "resident",
      actor_id: request.resident_id,
      resident_id: request.resident_id,
      vendor_id: request.vendor_id,
      maintenance_request_id: request.maintenance_request_id,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      metadata: { comment_preview: comment.slice(0, 280) },
    })

    // Low ratings still close the job after the resident explains what went wrong.
    try {
      const { data: fb } = request.feedback_id
        ? await supabase
          .from("vendor_feedback")
          .select("rating")
          .eq("id", request.feedback_id)
          .maybeSingle()
        : { data: null }
      const rating = Number(fb?.rating) || 1
      await finalizeJobAfterResidentFeedback(supabase, {
        landlordId: params.landlordId,
        ticketId: request.maintenance_request_id,
        vendorId: request.vendor_id,
        rating,
      })
    } catch (e) {
      console.error("[vendor-feedback] finalize after comment", e)
    }

    return {
      handled: true,
      replyBody: THANK_YOU_BODY,
      eventType: "vendor.feedback_comment_received",
      vendorId: request.vendor_id,
      maintenanceRequestId: request.maintenance_request_id,
    }
  }

  return { handled: false }
}
