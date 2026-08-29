/**
 * Vendor verification SMS after form submit: acknowledge receipt only.
 * Do not text approval, incomplete items, or a request to finish.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import { resolveVendorVerificationConversationId } from "./vendorVerificationInbox.ts"
import type { SmsProviderName } from "./types.ts"

import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
import { buildVendorVerificationReceivedSms } from "./vendorVerificationFollowUpCopy.ts"

export { buildVendorVerificationReceivedSms } from "./vendorVerificationFollowUpCopy.ts"

async function ensureConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
  },
): Promise<{
  conversationId: string | null
  fromNumber: string | null
  toNumber: string | null
  provider: SmsProviderName | null
}> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line?.phone) {
    return {
      conversationId: null,
      fromNumber: null,
      toNumber: null,
      provider: null,
    }
  }

  const provider: SmsProviderName = line.provider === "telnyx" ? "telnyx" : "twilio"
  const toNumber = normalizeSmsPhone(params.phone ?? "")
  let conversationId = await resolveVendorVerificationConversationId(supabase, params)

  if (!conversationId && toNumber) {
    const identity = await upsertSmsIdentityForPhone(supabase, {
      landlordId: params.landlordId,
      phone: toNumber,
      identityType: "vendor",
      vendorId: params.vendorId ?? null,
    })
    if (identity) {
      const created = await findOrCreateConversation(supabase, {
        landlordId: params.landlordId,
        smsNumberId: line.id,
        externalPhone: toNumber,
        identity,
        conversationStatus: "open",
      })
      conversationId = created.conversationId
    }
  }

  if (!conversationId) {
    return {
      conversationId: null,
      fromNumber: normalizeSmsPhone(line.phone),
      toNumber: toNumber || null,
      provider,
    }
  }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("external_phone_number")
    .eq("id", conversationId)
    .maybeSingle()

  const external = normalizeSmsPhone(
    (conv?.external_phone_number as string | undefined) ?? "",
  )

  return {
    conversationId,
    fromNumber: normalizeSmsPhone(line.phone),
    toNumber: toNumber || external || null,
    provider,
  }
}

export type VendorVerificationFollowUpResult = {
  conversationId: string | null
  receivedMessageId: string | null
}

/**
 * After form submit: SMS acknowledgement only. Best-effort; never throws.
 */
export async function sendVendorVerificationFollowUpSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    verificationId: string
    vendorLabel: string
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
    companyName?: string | null
  },
): Promise<VendorVerificationFollowUpResult> {
  const empty: VendorVerificationFollowUpResult = {
    conversationId: null,
    receivedMessageId: null,
  }

  try {
    const companyName = params.companyName ??
      (await loadLandlordDisplayName(supabase, params.landlordId))

    const channel = await ensureConversation(supabase, params)
    if (
      !channel.conversationId ||
      !channel.fromNumber ||
      !channel.toNumber ||
      !channel.provider
    ) {
      console.warn("[vendorVerificationFollowUp] no SMS channel", {
        verificationId: params.verificationId,
      })
      return empty
    }

    const receivedBody = buildVendorVerificationReceivedSms({
      vendorLabel: params.vendorLabel,
      companyName,
    })
    const received = await sendInboundAutoReply(supabase, {
      conversationId: channel.conversationId,
      landlordId: params.landlordId,
      fromNumber: channel.fromNumber,
      toNumber: channel.toNumber,
      body: receivedBody,
      provider: channel.provider,
      source: "vendor_verification_received",
    })

    if (received.messageId) {
      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "vendor.verification_ack_sent",
        source: "edge_function",
        actor_type: "system",
        vendor_id: params.vendorId ?? null,
        conversation_id: channel.conversationId,
        message_id: received.messageId,
        workflow_run_id: params.workflowRunId ?? null,
        workflow_template_id: params.workflowRunId ? "vendor_onboarding" : null,
        metadata: {
          message: `Verification form acknowledgement sent to ${params.vendorLabel}.`,
          verification_id: params.verificationId,
        },
      })
    }

    await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        status: "open",
        vendor_id: params.vendorId ?? null,
      })
      .eq("id", channel.conversationId)
      .eq("landlord_id", params.landlordId)

    return {
      conversationId: channel.conversationId,
      receivedMessageId: received.messageId ?? null,
    }
  } catch (err) {
    console.error("[vendorVerificationFollowUp] failed", err)
    return empty
  }
}
