import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider } from "./providerFactory.ts"
import { normalizeSmsPhone } from "./inbound_db.ts"
import type { SmsProviderName } from "./types.ts"

export type SendInboundAutoReplyParams = {
  conversationId: string
  landlordId: string
  /** Ulo SMS line (sender). */
  fromNumber: string
  /** External texter (recipient). */
  toNumber: string
  body: string
  provider: SmsProviderName
  source?: string
}

export type SendInboundAutoReplyResult =
  | { ok: true; messageId: string; providerMessageSid: string }
  | { ok: false; error: string }

/** Resolve the auto-reply body from identity resolution and workflow handlers. */
export function resolveInboundAutoReplyBody(
  resolutionHint: string | undefined,
  workflowHint: string | undefined,
  workflowRoute?: string,
): string | null {
  const resolution = resolutionHint?.trim()
  const workflow = workflowHint?.trim()

  if (
    workflowRoute === "resident_maintenance_intake" ||
    workflowRoute === "lease_renewal"
  ) {
    return workflow || resolution || null
  }

  return resolution || workflow || null
}

/**
 * Send an inbound auto-reply via getSMSProvider().sendMessage() and persist to sms_messages.
 * Always writes an outbound sms_messages row (sent or failed) for resident-intake auditing.
 */
export async function sendInboundAutoReply(
  supabase: SupabaseClient,
  params: SendInboundAutoReplyParams,
): Promise<SendInboundAutoReplyResult> {
  const body = params.body.trim()
  if (!body) {
    console.warn("[sms-inbound] auto-reply skipped — empty body", {
      conversationId: params.conversationId,
      source: params.source ?? "inbound_auto_reply",
    })
    return { ok: false, error: "empty reply body" }
  }

  console.info("[sms-inbound] auto-reply generated", {
    conversationId: params.conversationId,
    from: params.fromNumber,
    to: params.toNumber,
    source: params.source ?? "inbound_auto_reply",
    bodyPreview: body.slice(0, 160),
  })

  let sendResult: Awaited<ReturnType<ReturnType<typeof getSMSProvider>["sendMessage"]>>
  try {
    sendResult = await getSMSProvider().sendMessage({
      to: params.toNumber,
      body,
      from: params.fromNumber,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[sms-inbound] sendMessage threw", {
      conversationId: params.conversationId,
      to: params.toNumber,
      from: params.fromNumber,
      error: message,
    })
    sendResult = { provider: params.provider, error: message }
  }

  if (sendResult.error) {
    console.error("[sms-inbound] sendMessage failed", {
      conversationId: params.conversationId,
      to: params.toNumber,
      from: params.fromNumber,
      provider: sendResult.provider,
      error: sendResult.error,
    })

    const { data, error } = await supabase
      .from("sms_messages")
      .insert({
        conversation_id: params.conversationId,
        landlord_id: params.landlordId,
        direction: "outbound",
        from_number: normalizeSmsPhone(params.fromNumber),
        to_number: normalizeSmsPhone(params.toNumber),
        body,
        media_urls: [],
        provider: sendResult.provider ?? params.provider,
        provider_message_sid: sendResult.providerMessageSid ?? null,
        provider_status: "failed",
        raw_payload: {
          source: params.source ?? "inbound_auto_reply",
          send_error: sendResult.error,
        },
      })
      .select("id")
      .single()

    if (error || !data?.id) {
      console.error("[sms-inbound] failed outbound auto-reply save", error?.message)
    } else {
      console.info("[sms-inbound] failed outbound auto-reply saved", {
        conversationId: params.conversationId,
        messageId: data.id,
      })
    }

    return { ok: false, error: sendResult.error }
  }

  const providerMessageSid =
    sendResult.providerMessageSid ?? sendResult.messageId ??
    crypto.randomUUID()

  console.info("[sms-inbound] sendMessage succeeded", {
    conversationId: params.conversationId,
    to: params.toNumber,
    provider: sendResult.provider,
    providerMessageSid,
    status: sendResult.status,
  })

  const { data, error } = await supabase
    .from("sms_messages")
    .insert({
      conversation_id: params.conversationId,
      landlord_id: params.landlordId,
      direction: "outbound",
      from_number: normalizeSmsPhone(params.fromNumber),
      to_number: normalizeSmsPhone(params.toNumber),
      body,
      media_urls: [],
      provider: sendResult.provider,
      provider_message_sid: providerMessageSid,
      provider_status: sendResult.status ?? "sent",
      raw_payload: {
        source: params.source ?? "inbound_auto_reply",
      },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[sms-inbound] outbound auto-reply save failed", error?.message)
    return {
      ok: false,
      error: error?.message ?? "Failed to save outbound SMS message",
    }
  }

  console.info("[sms-inbound] outbound auto-reply saved", {
    conversationId: params.conversationId,
    messageId: data.id,
    providerMessageSid,
  })

  return {
    ok: true,
    messageId: data.id as string,
    providerMessageSid,
  }
}
