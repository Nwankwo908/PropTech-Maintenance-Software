import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { InboundSMSMessage } from "./types.ts"
import {
  findOpenConversation,
  findOrCreateConversation,
  lookupReleasedPendingSmsNumber,
  lookupSmsNumberByTo,
  normalizeSmsPhone,
  resolveOpenMaintenanceRequestId,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import {
  resolvePhoneIdentity,
  sendIdentityReplyHint,
  type IdentityResolutionSource,
  type SelfHealingPhase,
} from "./resolveIdentity.ts"
import {
  actorIdForIdentity,
  actorTypeForIdentity,
  routeInboundSmsWorkflow,
} from "./workflow_router.ts"
import { relayInboundProxiedMessage } from "./proxiedMessaging.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"

export type ProcessInboundSmsResult =
  | {
      ok: true
      releasedPending: true
      autoReply: string
    }
  | {
      ok: true
      releasedPending?: false
      conversationId: string
      messageId: string
      workflowRoute: string
      identityType: string
      landlordId: string
      resolutionSource: IdentityResolutionSource
      selfHealingPhase: SelfHealingPhase
    }

export class InboundSmsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = "InboundSmsError"
  }
}

async function saveInboundMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    inbound: InboundSMSMessage
  },
): Promise<string> {
  const { data: existing } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("provider", params.inbound.provider)
    .eq("provider_message_sid", params.inbound.providerMessageSid)
    .maybeSingle()

  if (existing?.id) {
    return existing.id as string
  }

  const { data, error } = await supabase
    .from("sms_messages")
    .insert({
      conversation_id: params.conversationId,
      landlord_id: params.landlordId,
      direction: "inbound",
      from_number: normalizeSmsPhone(params.inbound.from),
      to_number: normalizeSmsPhone(params.inbound.to),
      body: params.inbound.body,
      media_urls: params.inbound.mediaUrls,
      provider: params.inbound.provider,
      provider_message_sid: params.inbound.providerMessageSid,
      provider_status: "received",
      raw_payload: params.inbound.rawPayload,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[sms-inbound] sms_messages insert", error?.message)
    throw new InboundSmsError("Failed to save inbound message", 500)
  }

  return data.id as string
}

async function recordGraphEvent(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    identity: SmsIdentityRow
    conversationId: string
    messageId: string
    maintenanceRequestId: string | null
    inbound: InboundSMSMessage
    workflowRoute: string
    selfHealed: boolean
    resolutionSource: IdentityResolutionSource
    selfHealingPhase: SelfHealingPhase
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "sms.message_received",
    source: "sms",
    actor_type: actorTypeForIdentity(params.identity.identity_type),
    actor_id: actorIdForIdentity(params.identity),
    unit_id: params.identity.unit_id,
    resident_id: params.identity.resident_id,
    vendor_id: params.identity.vendor_id,
    maintenance_request_id: params.maintenanceRequestId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      workflow_route: params.workflowRoute,
      provider_message_sid: params.inbound.providerMessageSid,
      from: params.inbound.from,
      to: params.inbound.to,
      body_preview: params.inbound.body.slice(0, 280),
      media_count: params.inbound.mediaUrls.length,
      self_healed: params.selfHealed,
      resolution_source: params.resolutionSource,
      self_healing_phase: params.selfHealingPhase,
    },
  })
}

/** Core inbound SMS pipeline (webhook-agnostic). */
export async function processInboundSms(
  supabase: SupabaseClient,
  inbound: InboundSMSMessage,
): Promise<ProcessInboundSmsResult> {
  const smsNumber = await lookupSmsNumberByTo(supabase, inbound.to)
  if (!smsNumber) {
    const pending = await lookupReleasedPendingSmsNumber(supabase, inbound.to)
    if (pending) {
      const autoReply =
        pending.release_auto_reply?.trim() ||
        Deno.env.get("SMS_RELEASE_AUTO_REPLY")?.trim() ||
        "This Ulo SMS line is no longer active. Please contact your property manager directly."
      console.info("[sms-inbound] released_pending auto-reply", {
        to: inbound.to,
        smsNumberId: pending.id,
      })
      return { ok: true, releasedPending: true, autoReply }
    }
    throw new InboundSmsError(`Unknown SMS destination number: ${inbound.to}`, 404)
  }

  if (!smsNumber.landlord_id) {
    throw new InboundSmsError(
      "SMS number is not assigned to a landlord (landlord_id required)",
      422,
    )
  }

  const landlordId = smsNumber.landlord_id

  const existingConversation = await findOpenConversation(supabase, {
    landlordId,
    smsNumberId: smsNumber.id,
    externalPhone: inbound.from,
  })

  const resolution = await resolvePhoneIdentity(supabase, {
    fromNumber: inbound.from,
    landlordId,
    messageBody: inbound.body,
    conversationId: existingConversation?.id ?? null,
    conversationStatus: existingConversation?.status ?? null,
    replyFromNumber: inbound.to,
  })

  const identity = resolution.identity
  const selfHealed = resolution.source === "self_healed_unit" ||
    (resolution.createdOrUpdated && resolution.source !== "sms_identity")

  await sendIdentityReplyHint(
    inbound.from,
    inbound.to,
    resolution.replyHint,
  )

  const maintenanceRequestId =
    existingConversation?.maintenance_request_id ??
    (await resolveOpenMaintenanceRequestId(supabase, identity, inbound.from))

  const conversationStatus = resolution.conversationStatus ?? "open"
  const { conversationId, conversationType } = await findOrCreateConversation(
    supabase,
    {
      landlordId,
      smsNumberId: smsNumber.id,
      externalPhone: inbound.from,
      identity,
      maintenanceRequestId,
      conversationStatus,
    },
  )

  console.info("[sms-inbound] conversation routing", {
    identity_type: identity.identity_type,
    vendor_id: identity.vendor_id,
    resident_id: identity.resident_id,
    conversation_type: conversationType,
    resolution_source: resolution.source,
    self_healing_phase: resolution.selfHealingPhase,
    continue_intake: resolution.continueIntake,
    conversation_id: conversationId,
  })

  const messageId = await saveInboundMessage(supabase, {
    conversationId,
    landlordId,
    inbound,
  })

  if (conversationType === "vendor_tenant_proxy") {
    const relay = await relayInboundProxiedMessage(supabase, {
      conversationId,
      inboundMessageId: messageId,
      inboundFrom: inbound.from,
      body: inbound.body,
      mediaUrls: inbound.mediaUrls,
    })
    console.info("[sms-inbound] vendor_tenant_proxy relay", {
      conversationId,
      inboundMessageId: messageId,
      relayOk: relay.ok,
      skipped: "skipped" in relay ? relay.skipped : false,
      reason: "reason" in relay ? relay.reason : undefined,
      eventType: relay.ok ? relay.eventType : undefined,
    })

    await recordGraphEvent(supabase, {
      landlordId,
      identity,
      conversationId,
      messageId,
      maintenanceRequestId,
      inbound,
      workflowRoute: "vendor_tenant_proxy",
      selfHealed,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    })

    return {
      ok: true,
      conversationId,
      messageId,
      workflowRoute: "vendor_tenant_proxy",
      identityType: identity.identity_type,
      landlordId,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    }
  }

  const workflow = await routeInboundSmsWorkflow(supabase, {
    inbound,
    landlordId,
    identity,
    conversationId,
    messageId,
    maintenanceRequestId,
    selfHealed,
    continueIntake: resolution.continueIntake,
    resolutionSource: resolution.source,
    selfHealingPhase: resolution.selfHealingPhase,
    suggestedUnit: resolution.suggestedUnit,
  })

  await recordGraphEvent(supabase, {
    landlordId,
    identity,
    conversationId,
    messageId,
    maintenanceRequestId,
    inbound,
    workflowRoute: workflow.route,
    selfHealed,
    resolutionSource: resolution.source,
    selfHealingPhase: resolution.selfHealingPhase,
  })

  return {
    ok: true,
    conversationId,
    messageId,
    workflowRoute: workflow.route,
    identityType: identity.identity_type,
    landlordId,
    resolutionSource: resolution.source,
    selfHealingPhase: resolution.selfHealingPhase,
  }
}

/** Twilio-compatible empty TwiML (200). */
export function twilioEmptyTwiMLResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    },
  )
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Twilio TwiML with a single SMS reply body. */
export function twilioMessageResponse(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`,
    {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    },
  )
}
