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

function parseRating(body: string): number | null {
  const trimmed = body.trim()
  const match = trimmed.match(/^([1-5])$/)
  if (!match) return null
  return Number(match[1])
}

async function lookupOpenFeedbackRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId?: string | null
    residentId?: string | null
  },
): Promise<{
  id: string
  vendor_id: string
  maintenance_request_id: string
  resident_id: string | null
  phase: string
  feedback_id: string | null
} | null> {
  let query = supabase
    .from("vendor_feedback_requests")
    .select(
      "id, vendor_id, maintenance_request_id, resident_id, phase, feedback_id",
    )
    .eq("landlord_id", params.landlordId)
    .eq("rater_type", "resident")
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)

  if (params.conversationId) {
    query = query.eq("conversation_id", params.conversationId)
  } else if (params.residentId) {
    query = query.eq("resident_id", params.residentId)
  } else {
    return null
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error("[vendor-feedback] lookup open request", error.message)
    return null
  }
  return data as typeof data
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

    // Rating 3–5 closes the job on both ends; 4–5 also texts the landlord pay options.
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
