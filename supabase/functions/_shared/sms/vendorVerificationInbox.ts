/**
 * Mirror vendor verification form submit into the invite SMS conversation
 * so Communication inbox admins see when the vendor responded.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { normalizeSmsPhone } from "./inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import type { VerificationChecklist } from "../vendor_verification/checklist.ts"

export const VENDOR_VERIFICATION_SUBMITTED_SOURCE = "vendor_verification_submitted"

/** Distinctive body markers used by the admin monitoring title/risk heuristics. */
export function isVendorVerificationSubmittedBody(text: string): boolean {
  return /finished the vendor verification form|verification form submitted/i.test(text)
}

export function buildVendorVerificationSubmittedInboxBody(input: {
  vendorLabel: string
  overall: "verified" | "needs_review"
  checklist: VerificationChecklist
  trades?: string[] | null
}): string {
  const outcome = input.overall === "verified"
    ? "I'm verified and ready for work orders."
    : "My form is in — please review a few items before assigning work."

  const itemLines = input.checklist.items
    .filter((item) => item.required)
    .map((item) => {
      const mark = item.status === "complete" ? "Done" : "Needs attention"
      return `· ${item.label}: ${mark}${item.detail ? ` (${item.detail})` : ""}`
    })

  const trades = (input.trades ?? []).map((t) => t.trim()).filter(Boolean)
  if (trades.length > 0) {
    itemLines.push(`· Services: ${trades.join(", ")}`)
  }

  return [
    "I finished the vendor verification form on Ulo.",
    "",
    outcome,
    "",
    ...itemLines,
  ].join("\n")
}

export async function resolveVendorVerificationConversationId(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
  },
): Promise<string | null> {
  const direct = params.inviteConversationId?.trim()
  if (direct) return direct

  if (params.workflowRunId?.trim()) {
    const { data } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("workflow_run_id", params.workflowRunId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id as string
  }

  if (params.vendorId?.trim()) {
    const { data } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("vendor_id", params.vendorId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id as string
  }

  const phone = normalizeSmsPhone(params.phone ?? "")
  if (phone) {
    const { data } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("external_phone_number", phone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id as string
  }

  return null
}

/**
 * Append an inbound "vendor responded" message to the invite thread.
 * Best-effort: never throws; returns null ids when no conversation exists.
 */
export async function appendVendorVerificationSubmittedToInbox(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
    vendorLabel: string
    overall: "verified" | "needs_review"
    checklist: VerificationChecklist
    trades?: string[] | null
    verificationId: string
  },
): Promise<{ conversationId: string | null; messageId: string | null }> {
  try {
    const conversationId = await resolveVendorVerificationConversationId(supabase, params)
    if (!conversationId) {
      console.warn("[vendorVerificationInbox] no invite conversation to update", {
        verificationId: params.verificationId,
        landlordId: params.landlordId,
      })
      return { conversationId: null, messageId: null }
    }

    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("id, sms_number_id, external_phone_number, vendor_id")
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()

    if (!conv?.id) {
      return { conversationId: null, messageId: null }
    }

    const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
    const uloNumber = line?.phone
      ? normalizeSmsPhone(line.phone)
      : null
    const vendorPhone = normalizeSmsPhone(
      params.phone || (conv.external_phone_number as string) || "",
    )

    const body = buildVendorVerificationSubmittedInboxBody({
      vendorLabel: params.vendorLabel,
      overall: params.overall,
      checklist: params.checklist,
      trades: params.trades,
    })

    const nowIso = new Date().toISOString()
    const { data: inserted, error } = await supabase
      .from("sms_messages")
      .insert({
        conversation_id: conversationId,
        landlord_id: params.landlordId,
        direction: "inbound",
        from_number: vendorPhone || "unknown",
        to_number: uloNumber || "unknown",
        body,
        media_urls: [],
        provider: line?.provider === "telnyx" ? "telnyx" : "twilio",
        provider_message_sid: `vendor-verification-submit:${params.verificationId}`,
        provider_status: "received",
        raw_payload: {
          source: VENDOR_VERIFICATION_SUBMITTED_SOURCE,
          verification_id: params.verificationId,
          overall: params.overall,
          simulated_inbound: true,
        },
      })
      .select("id")
      .single()

    if (error || !inserted?.id) {
      // Idempotent re-submit: unique provider_message_sid may already exist.
      if (error && /duplicate|unique/i.test(error.message)) {
        const { data: existing } = await supabase
          .from("sms_messages")
          .select("id")
          .eq("provider_message_sid", `vendor-verification-submit:${params.verificationId}`)
          .maybeSingle()
        return {
          conversationId,
          messageId: (existing?.id as string | undefined) ?? null,
        }
      }
      console.error("[vendorVerificationInbox] sms_messages insert", error?.message)
      return { conversationId, messageId: null }
    }

    await supabase
      .from("sms_conversations")
      .update({
        updated_at: nowIso,
        status: "open",
        vendor_id: params.vendorId ?? conv.vendor_id ?? null,
      })
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)

    return { conversationId, messageId: inserted.id as string }
  } catch (err) {
    console.error("[vendorVerificationInbox] append failed", err)
    return { conversationId: null, messageId: null }
  }
}
