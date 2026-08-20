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
} from "./inbound_db.ts"
import { resolvePhoneIdentity } from "./resolveIdentity.ts"
import { routeInboundSmsWorkflow } from "./workflow_router.ts"
import {
  decideInboundDebounce,
  type SaveInboundResult,
} from "./sms_inbound_guard.ts"
import {
  finishHandledInbound,
  recordInboundSmsGraphEvent,
  trySendAutoReply,
} from "./inboundFinish.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import { tryHandleInterpretedInbound } from "./inboundInterpretationAct.ts"
import {
  InboundSmsError,
  type InboundSmsHandlerContext,
  type ProcessInboundSmsResult,
} from "./inboundHandlerTypes.ts"
import {
  inboundMediaWasRehosted,
  rehostInboundSmsMedia,
} from "./rehostInboundMedia.ts"

export {
  InboundSmsError,
  type ProcessInboundSmsResult,
} from "./inboundHandlerTypes.ts"

async function saveInboundMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    inbound: InboundSMSMessage
  },
): Promise<SaveInboundResult> {
  const { data: existing } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("provider", params.inbound.provider)
    .eq("provider_message_sid", params.inbound.providerMessageSid)
    .maybeSingle()

  if (existing?.id) {
    return { messageId: existing.id as string, duplicate: true }
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
    if (error?.code === "23505") {
      const { data: raced } = await supabase
        .from("sms_messages")
        .select("id")
        .eq("provider", params.inbound.provider)
        .eq("provider_message_sid", params.inbound.providerMessageSid)
        .maybeSingle()
      if (raced?.id) {
        return { messageId: raced.id as string, duplicate: true }
      }
    }
    console.error("[sms-inbound] sms_messages insert", error?.message)
    throw new InboundSmsError("Failed to save inbound message", 500)
  }

  return { messageId: data.id as string, duplicate: false }
}

/** Rehost MMS into private storage so Messages / work orders can render it. */
async function persistRehostedInboundMedia(
  supabase: SupabaseClient,
  params: {
    inbound: InboundSMSMessage
    conversationId: string
    messageId: string
    duplicate: boolean
  },
): Promise<void> {
  if (params.duplicate || params.inbound.mediaUrls.length === 0) return
  try {
    const rehosted = await rehostInboundSmsMedia(supabase, {
      mediaUrls: params.inbound.mediaUrls,
      provider: params.inbound.provider,
      storagePrefix: `sms/${params.conversationId}/${params.messageId}`,
    })
    if (!inboundMediaWasRehosted(params.inbound.mediaUrls, rehosted)) return
    const { error } = await supabase
      .from("sms_messages")
      .update({ media_urls: rehosted })
      .eq("id", params.messageId)
    if (error) {
      console.error("[sms-inbound] media_urls update failed", error.message)
      return
    }
    params.inbound.mediaUrls = rehosted
  } catch (e) {
    console.error("[sms-inbound] media rehost failed", e)
  }
}

async function loadActiveMaintenanceIntake(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data: intakeConv } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", conversationId)
      .maybeSingle()
    const intakeState = (intakeConv as { intake_state?: Record<string, unknown> | null } | null)
      ?.intake_state
    const step = typeof intakeState?.step === "string" ? intakeState.step : ""
    if (step && step !== "submitted") return true
    if (intakeState?.awaiting_schedule_confirmation) return true
    return false
  } catch {
    return false
  }
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

      const saved = await saveInboundMessage(supabase, {
        conversationId,
        landlordId,
        inbound,
      })
      const messageId = saved.messageId
      await persistRehostedInboundMedia(supabase, {
        inbound,
        conversationId,
        messageId,
        duplicate: saved.duplicate,
      })
      if (saved.duplicate) {
        return {
          ok: true,
          releasedPending: true,
          conversationId,
          messageId,
        }
      }

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

  const saved = await saveInboundMessage(supabase, {
    conversationId,
    landlordId,
    inbound,
  })
  const messageId = saved.messageId
  await persistRehostedInboundMedia(supabase, {
    inbound,
    conversationId,
    messageId,
    duplicate: saved.duplicate,
  })

  if (saved.duplicate) {
    console.info("[sms-inbound] duplicate provider SID — skip reprocess", {
      conversationId,
      messageId,
      providerMessageSid: inbound.providerMessageSid,
    })
    return {
      ok: true,
      conversationId,
      messageId,
      workflowRoute: "duplicate_sid",
      identityType: identity.identity_type,
      landlordId,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    }
  }

  const debounce = await decideInboundDebounce(supabase, {
    conversationId,
    messageId,
  })
  if (debounce.action === "skip") {
    console.info("[sms-inbound] debounced inbound — skip workflow", {
      conversationId,
      messageId,
      reason: debounce.reason,
    })
    return {
      ok: true,
      conversationId,
      messageId,
      workflowRoute: "debounced",
      identityType: identity.identity_type,
      landlordId,
      resolutionSource: resolution.source,
      selfHealingPhase: resolution.selfHealingPhase,
    }
  }

  const handlerContext: InboundSmsHandlerContext = {
    supabase,
    inbound,
    landlordId,
    conversationId,
    conversationType,
    messageId,
    identity,
    maintenanceRequestId,
    selfHealed,
    resolutionSource: resolution.source,
    selfHealingPhase: resolution.selfHealingPhase,
    activeMaintenanceIntake: await loadActiveMaintenanceIntake(
      supabase,
      conversationId,
    ),
  }

  const handlerResult = await tryInboundSmsHandlers(handlerContext)
  if (handlerResult.handled) {
    return finishHandledInbound(handlerContext, handlerResult)
  }

  // Pending question first (intake photo, urgency, YES confirms, …), then
  // follow-up / switch / new issue. Draft work orders must not steal the ask.
  const interpreted = await tryHandleInterpretedInbound(handlerContext)
  if (interpreted.handled) {
    return finishHandledInbound(handlerContext, interpreted)
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
      interpretation: interpreted.interpretation ?? null,
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
    skipGenericFallback: workflow.metadata?.skipGenericAutoReply === true ||
      workflow.route === "vendor_response",
  })

  await recordInboundSmsGraphEvent(supabase, {
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
