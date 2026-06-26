import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { InboundSMSMessage } from "./types.ts"
import {
  createUnknownIdentity,
  findOpenConversation,
  findOrCreateConversation,
  lookupReleasedPendingSmsNumber,
  normalizeSmsPhone,
  resolveInboundSmsNumber,
  resolveOpenMaintenanceRequestId,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import {
  resolvePhoneIdentity,
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
import {
  resolveInboundAutoReplyBody,
  sendInboundAutoReply,
} from "./inboundReply.ts"
import { tryHandleVendorFeedbackInbound } from "../vendor_feedback.ts"

export type ProcessInboundSmsResult =
  | {
      ok: true
      releasedPending: true
      conversationId: string
      messageId: string
      outboundMessageId?: string
    }
  | {
      ok: true
      releasedPending?: false
      conversationId: string
      messageId: string
      outboundMessageId?: string
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

async function trySendAutoReply(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    uloNumber: string
    externalPhone: string
    provider: InboundSMSMessage["provider"]
    resolutionHint?: string
    workflowHint?: string
    source: string
    workflowRoute?: string
  },
): Promise<string | undefined> {
  const replyBody = resolveInboundAutoReplyBody(
    params.resolutionHint,
    params.workflowHint,
    params.workflowRoute,
  )

  if (!replyBody) {
    console.warn("[sms-inbound] auto-reply skipped — no reply text", {
      conversationId: params.conversationId,
      source: params.source,
      workflowRoute: params.workflowRoute,
      hasResolutionHint: !!params.resolutionHint?.trim(),
      hasWorkflowHint: !!params.workflowHint?.trim(),
    })
    return undefined
  }

  const sent = await sendInboundAutoReply(supabase, {
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    fromNumber: params.uloNumber,
    toNumber: params.externalPhone,
    body: replyBody,
    provider: params.provider,
    source: params.source,
  })

  if (!sent.ok) {
    console.warn("[sms-inbound] auto-reply not delivered", {
      conversationId: params.conversationId,
      source: params.source,
      workflowRoute: params.workflowRoute,
      error: sent.error,
    })
    return undefined
  }

  return sent.messageId
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
    workflowMetadata?: Record<string, unknown>
    selfHealed: boolean
    resolutionSource: IdentityResolutionSource
    selfHealingPhase: SelfHealingPhase
  },
): Promise<void> {
  const templateId =
    typeof params.workflowMetadata?.workflow_template_id === "string"
      ? params.workflowMetadata.workflow_template_id
      : null
  const runId =
    typeof params.workflowMetadata?.workflow_run_id === "string"
      ? params.workflowMetadata.workflow_run_id
      : null

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
    workflow_run_id: runId,
    workflow_template_id: templateId,
    metadata: {
      workflow_route: params.workflowRoute,
      workflow_template_id: templateId ?? undefined,
      workflow_run_id: runId ?? undefined,
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
  const smsNumber = await resolveInboundSmsNumber(supabase, inbound.to)
  if (!smsNumber) {
    const pending = await lookupReleasedPendingSmsNumber(supabase, inbound.to)
    if (pending) {
      const autoReply =
        pending.release_auto_reply?.trim() ||
        Deno.env.get("SMS_RELEASE_AUTO_REPLY")?.trim() ||
        "This Ulo SMS line is no longer active. Please contact your property manager directly."

      const landlordId = pending.landlord_id?.trim()
      if (!landlordId) {
        throw new InboundSmsError(
          "Released SMS number is missing landlord_id",
          422,
        )
      }

      const identity = await createUnknownIdentity(
        supabase,
        inbound.from,
        landlordId,
      )

      const { conversationId } = await findOrCreateConversation(supabase, {
        landlordId,
        smsNumberId: pending.id,
        externalPhone: inbound.from,
        identity,
        maintenanceRequestId: null,
        conversationStatus: "closed",
      })

      const messageId = await saveInboundMessage(supabase, {
        conversationId,
        landlordId,
        inbound,
      })

      const outboundMessageId = await trySendAutoReply(supabase, {
        conversationId,
        landlordId,
        uloNumber: inbound.to,
        externalPhone: inbound.from,
        provider: inbound.provider,
        workflowHint: autoReply,
        source: "released_pending_auto_reply",
      })

      console.info("[sms-inbound] released_pending auto-reply handled", {
        to: inbound.to,
        smsNumberId: pending.id,
        conversationId,
        inboundMessageId: messageId,
        outboundMessageId,
      })

      return {
        ok: true,
        releasedPending: true,
        conversationId,
        messageId,
        outboundMessageId,
      }
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

  const feedbackResult = await tryHandleVendorFeedbackInbound(supabase, {
    landlordId,
    conversationId,
    messageId,
    body: inbound.body,
    residentId: identity.resident_id,
    identityType: identity.identity_type,
  })

  if (feedbackResult.handled) {
    const outboundMessageId = await trySendAutoReply(supabase, {
      conversationId,
      landlordId,
      uloNumber: inbound.to,
      externalPhone: inbound.from,
      provider: inbound.provider,
      workflowHint: feedbackResult.replyBody,
      source: `vendor_feedback_${feedbackResult.eventType}`,
      workflowRoute: "vendor_feedback",
    })

    await recordGraphEvent(supabase, {
      landlordId,
      identity,
      conversationId,
      messageId,
      maintenanceRequestId: feedbackResult.maintenanceRequestId,
      inbound,
      workflowRoute: "vendor_feedback",
      workflowMetadata: {
        vendor_feedback_event: feedbackResult.eventType,
        rating: feedbackResult.rating,
      },
      selfHealed,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    })

    return {
      ok: true,
      conversationId,
      messageId,
      outboundMessageId,
      workflowRoute: "vendor_feedback",
      identityType: identity.identity_type,
      landlordId,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    }
  }

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

  let workflow
  try {
    workflow = await routeInboundSmsWorkflow(supabase, {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[sms-inbound] workflow failed", {
      conversationId,
      error: message,
    })
    workflow = {
      route: "resident_maintenance_intake" as const,
      replyHint: resolution.replyHint ??
        "Thanks for reaching out — I'm having a little trouble on my end. Please try again in a moment.",
      metadata: { workflowError: message },
    }
  }

  const outboundMessageId = await trySendAutoReply(supabase, {
    conversationId,
    landlordId,
    uloNumber: inbound.to,
    externalPhone: inbound.from,
    provider: inbound.provider,
    resolutionHint: resolution.replyHint,
    workflowHint: workflow.replyHint,
    source: `workflow_${workflow.route}`,
    workflowRoute: workflow.route,
  })

  await recordGraphEvent(supabase, {
    landlordId,
    identity,
    conversationId,
    messageId,
    maintenanceRequestId,
    inbound,
    workflowRoute: workflow.route,
    workflowMetadata: workflow.metadata,
    selfHealed,
    resolutionSource: resolution.source,
    selfHealingPhase: resolution.selfHealingPhase,
  })

  return {
    ok: true,
    conversationId,
    messageId,
    outboundMessageId,
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
