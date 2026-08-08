import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { InboundSMSMessage } from "./types.ts"
import type { SmsIdentityRow } from "./inbound_db.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  actorIdForIdentity,
  actorTypeForIdentity,
} from "./workflow_router.ts"
import {
  resolveInboundAutoReplyBody,
  sendInboundAutoReply,
} from "./inboundReply.ts"
import { readVendorScheduleFsm } from "../vendor_schedule_fsm.ts"
import { shouldTripOutboundCircuit } from "./sms_inbound_guard.ts"
import type {
  IdentityResolutionSource,
  SelfHealingPhase,
} from "./resolveIdentity.ts"
import type {
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"
import type { ProcessInboundSmsResult } from "./inboundHandlerTypes.ts"

export async function trySendAutoReply(
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
    /** When true, never invent a generic maintenance fallback. */
    skipGenericFallback?: boolean
  },
): Promise<string | undefined> {
  let replyBody = resolveInboundAutoReplyBody(
    params.resolutionHint,
    params.workflowHint,
    params.workflowRoute,
  )

  if (!replyBody) {
    const skipGeneric =
      params.skipGenericFallback ||
      params.workflowRoute === "vendor_response" ||
      params.source.includes("vendor")
    if (skipGeneric) {
      console.info("[sms-inbound] auto-reply skipped — no workflow reply", {
        conversationId: params.conversationId,
        source: params.source,
        workflowRoute: params.workflowRoute,
      })
      return undefined
    }
    replyBody =
      params.workflowHint?.trim() ||
      params.resolutionHint?.trim() ||
      "Thanks for reaching out — this is Ulo. How can we help with your maintenance issue today?"
  }

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

  let scheduleState = null
  try {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", params.conversationId)
      .maybeSingle()
    scheduleState = readVendorScheduleFsm(
      (convo?.intake_state as Record<string, unknown> | null) ?? null,
    )
  } catch {
    scheduleState = null
  }

  const applyCircuit =
    params.workflowRoute === "vendor_response" ||
    params.source.includes("vendor")
  if (applyCircuit) {
    const circuit = await shouldTripOutboundCircuit(supabase, {
      conversationId: params.conversationId,
      body: replyBody,
      scheduleState,
    })
    if (circuit.trip) {
      console.warn("[sms-inbound] outbound circuit breaker tripped", {
        conversationId: params.conversationId,
        reason: circuit.reason,
        bodyPreview: replyBody.slice(0, 80),
      })
      return undefined
    }
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

export async function recordInboundSmsGraphEvent(
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

type HandledInboundResult = Extract<InboundSmsHandlerResult, { handled: true }>

/** Shared post-handler path: auto-reply (when needed), activity log, success response. */
export async function finishHandledInbound(
  ctx: InboundSmsHandlerContext,
  result: HandledInboundResult,
): Promise<ProcessInboundSmsResult> {
  const { supabase, inbound, landlordId, conversationId, messageId, identity } =
    ctx

  let outboundMessageId: string | undefined
  const reply = result.reply

  if (reply?.alreadySent) {
    outboundMessageId = reply.outboundMessageId
  } else if (reply) {
    outboundMessageId = await trySendAutoReply(supabase, {
      conversationId,
      landlordId,
      uloNumber: inbound.to,
      externalPhone: inbound.from,
      provider: inbound.provider,
      workflowHint: reply.body,
      source: reply.source,
      workflowRoute: result.workflowRoute,
      skipGenericFallback: reply.skipGenericFallback,
    })
  }

  const maintenanceRequestId = result.maintenanceRequestId !== undefined
    ? result.maintenanceRequestId
    : ctx.maintenanceRequestId

  await recordInboundSmsGraphEvent(supabase, {
    landlordId,
    identity,
    conversationId,
    messageId,
    maintenanceRequestId,
    inbound,
    workflowRoute: result.workflowRoute,
    workflowMetadata: result.workflowMetadata,
    selfHealed: ctx.selfHealed,
    resolutionSource: ctx.resolutionSource,
    selfHealingPhase: ctx.selfHealingPhase,
  })

  return {
    ok: true,
    conversationId,
    messageId,
    outboundMessageId,
    workflowRoute: result.workflowRoute,
    identityType: identity.identity_type,
    landlordId,
    resolutionSource: ctx.resolutionSource,
    selfHealingPhase: ctx.selfHealingPhase,
  }
}
