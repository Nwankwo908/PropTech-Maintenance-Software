import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { applyVendorStatusTransition, parseVendorSmsReply } from "../../vendor_workflow.ts"
import {
  buildVendorAvailabilityAskSms,
  buildVendorScheduleClarifySms,
  buildVendorScheduleSaveRetrySms,
  buildVendorScheduleSoftConfirmSms,
  buildVendorSmsAcceptReply,
  buildVendorSmsDeclineReply,
  buildVendorSmsReplyPrompt,
} from "../../vendor_outreach_copy.ts"
import { resolveVendorAvailability } from "../../vendor_availability_parse.ts"
import { confirmVendorSchedule } from "../../vendor_job_schedule.ts"
import {
  appendInboundContext,
  appendOutboundContext,
  formatScheduleContextForPrompt,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  reduceScheduleFsm,
  type ScheduleFsmEffect,
  type VendorScheduleFsmState,
  wouldLoopOutbound,
} from "../../vendor_schedule_fsm.ts"
import { inboundOccurredAt } from "../../sms/sms_inbound_guard.ts"
import {
  recordVendorRepliedEvent,
  resolveVendorMaintenanceRequestId,
  type VendorStatusTransitionResultMeta,
} from "../../sms/vendorSmsRouting.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

async function handleUnknownSender(ctx: WorkflowExecutionContext): Promise<WorkflowActResult> {
  return {
    templateId: "identity_onboarding",
    route: workflowRouteForTemplate("identity_onboarding"),
    replyHint:
      ctx.sms?.selfHealingPhase === "unresolved"
        ? "I wasn't able to match that unit. I've let your property manager know — they'll follow up with you."
        : "Hi — this is Ulo. What's your unit number, and what's going on?",
    metadata: {
      selfHealed: ctx.sms?.selfHealed,
      onboarding: true,
      resolutionSource: ctx.sms?.resolutionSource,
      selfHealingPhase: ctx.sms?.selfHealingPhase,
      suggestedUnit: ctx.sms?.suggestedUnit,
    },
  }
}

function effectToReply(effect: ScheduleFsmEffect): string | undefined {
  switch (effect.kind) {
    case "soft_confirm":
      return buildVendorScheduleSoftConfirmSms(effect.windowText)
    case "clarify":
      return buildVendorScheduleClarifySms(effect.prompt)
    case "save_retry":
      return buildVendorScheduleSaveRetrySms(effect.windowText)
    case "expired":
      return effect.prompt
    case "decline_ack":
      return buildVendorSmsDeclineReply()
    default:
      return undefined
  }
}

async function persistScheduleTurn(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    ticketId: string | null
    prev: VendorScheduleFsmState | null
    next: VendorScheduleFsmState
    inboundBody: string
    inboundAt: string
    inboundSid?: string
    outboundBody?: string
  },
): Promise<VendorScheduleFsmState> {
  let state = appendInboundContext(
    params.next,
    params.inboundBody,
    params.inboundAt,
    params.inboundSid,
  )
  if (params.outboundBody) {
    state = appendOutboundContext(state, params.outboundBody, params.inboundAt)
  }
  await persistVendorScheduleFsm(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    next: state,
    expectedRevision: params.prev?.revision,
  })
  return state
}

async function runPersistEffect(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    conversationId: string
    windowText: string
    scheduledAt: string | null
    prev: VendorScheduleFsmState | null
    draftState: VendorScheduleFsmState
    inboundBody: string
    inboundAt: string
    inboundSid?: string
  },
): Promise<{ replyHint: string; state: VendorScheduleFsmState }> {
  const confirmed = await confirmVendorSchedule(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    conversationId: params.conversationId,
    windowText: params.windowText,
    scheduledAt: params.scheduledAt,
  })

  if (confirmed.ok) {
    // confirmVendorSchedule already wrote SAVE_OK + outbound context.
    return { replyHint: confirmed.replyHint, state: params.draftState }
  }

  console.error("[vendor_job_response] confirm schedule failed", {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    error: confirmed.error,
    windowText: params.windowText.slice(0, 120),
  })

  const fail = reduceScheduleFsm(params.draftState, {
    type: "SAVE_FAIL",
    at: params.inboundAt,
    windowText: params.windowText,
    scheduledAt: params.scheduledAt,
  })
  const replyHint = buildVendorScheduleSaveRetrySms(params.windowText)
  const state = await persistScheduleTurn(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    prev: params.prev,
    next: fail.state,
    inboundBody: params.inboundBody,
    inboundAt: params.inboundAt,
    inboundSid: params.inboundSid,
    outboundBody: replyHint,
  })
  return { replyHint, state }
}

function guardLoop(
  state: VendorScheduleFsmState | null,
  reply: string | undefined,
  opts?: { allowRepeat?: boolean },
): string | undefined {
  if (!reply) return undefined
  if (!opts?.allowRepeat && wouldLoopOutbound(state, reply, 1)) {
    console.warn("[vendor_job_response] circuit breaker suppressed loop", {
      bodyPreview: reply.slice(0, 80),
    })
    return undefined
  }
  return reply
}

/** True when schedule FSM points at a different job than the open assignment. */
function isStaleScheduleForTicket(
  prev: VendorScheduleFsmState | null,
  currentTicketId: string | null,
): boolean {
  if (!prev?.ticketId?.trim() || !currentTicketId?.trim()) return false
  return prev.ticketId.trim() !== currentTicketId.trim()
}

export const vendorJobResponseTemplate: WorkflowTemplate = {
  id: "vendor_job_response",
  name: "Vendor job response",
  supportedTriggers: ["sms_inbound", "vendor_portal", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    const sms = ctx.sms
    if (!sms) return null

    const hasLinkedVendor =
      sms.identity.identity_type === "vendor" && !!sms.identity.vendor_id?.trim()

    if (hasLinkedVendor) {
      return {
        templateId: "vendor_job_response",
        confidence: "high",
        reason: "linked_vendor_sms",
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
  ): Promise<WorkflowActResult> {
    const sms = ctx.sms
    if (!sms) {
      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        metadata: { error: "missing_sms_context" },
      }
    }

    if (!sms.identity.vendor_id?.trim()) {
      return handleUnknownSender(ctx)
    }

    const vendorId = sms.identity.vendor_id.trim()
    const ticketId = await resolveVendorMaintenanceRequestId(supabase, {
      vendorId,
      conversationId: sms.conversationId,
      conversationMaintenanceRequestId: sms.maintenanceRequestId,
    })

    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", sms.conversationId)
      .maybeSingle()

    const intake = (convo?.intake_state as Record<string, unknown> | null) ?? null
    const prev = readVendorScheduleFsm(intake)
    const inboundAt = inboundOccurredAt(
      sms.inbound.rawPayload as Record<string, unknown>,
      new Date(),
    )
    const inboundSid = sms.inbound.providerMessageSid
    const parsedAction = parseVendorSmsReply(sms.inbound.body)
    let transition: VendorStatusTransitionResultMeta | undefined
    let replyHint: string | undefined
    let scheduleStep = prev?.step
    let fsmMeta: Record<string, unknown> = {}

    const staleSchedule = isStaleScheduleForTicket(prev, ticketId)
    // Stale FSM from a prior job on this SMS thread must not steal YES / times
    // from a new assignment (skips accept + "Earliest availability?").
    const inScheduleFlow =
      !!prev &&
      !staleSchedule &&
      (prev.step === "awaiting_availability" ||
        prev.step === "awaiting_confirmation" ||
        !!prev.pendingWindowText?.trim())

    if (staleSchedule) {
      console.warn("[vendor_job_response] stale schedule ticket ignored", {
        scheduleTicketId: prev?.ticketId,
        currentTicketId: ticketId,
        step: prev?.step,
      })
    }

    if (inScheduleFlow && parsedAction !== "decline") {
      const scheduleTicketId = prev.ticketId || ticketId
      if (!scheduleTicketId) {
        replyHint = buildVendorScheduleClarifySms()
      } else if (parsedAction === "accept") {
        const reduced = reduceScheduleFsm(prev, {
          type: "CONFIRM_YES",
          at: inboundAt,
          inboundSid,
        })
        fsmMeta = { effect: reduced.effect.kind, suppress: reduced.suppressReply }

        if (reduced.suppressReply) {
          replyHint = undefined
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            prev,
            next: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
          })
        } else if (reduced.effect.kind === "persist") {
          const persisted = await runPersistEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            prev,
            draftState: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
          })
          // Always deliver confirm / save-retry — repeating "lock it in" is OK.
          replyHint = guardLoop(prev, persisted.replyHint, { allowRepeat: true })
          scheduleStep = "scheduled"
        } else {
          replyHint = guardLoop(prev, effectToReply(reduced.effect), {
            allowRepeat: reduced.effect.kind === "save_retry" ||
              reduced.effect.kind === "clarify",
          })
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            prev,
            next: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
            outboundBody: replyHint,
          })
          scheduleStep = reduced.state.step
        }
      } else {
        const resolved = await resolveVendorAvailability(sms.inbound.body, {
          conversationContext: formatScheduleContextForPrompt(prev),
        })
        const outcome =
          resolved.status === "resolved"
            ? "resolved" as const
            : resolved.status === "needs_confirmation"
            ? "needs_confirmation" as const
            : "needs_clarification" as const
        const windowText =
          resolved.status === "needs_clarification"
            ? sms.inbound.body.trim()
            : resolved.value.windowLabel
        const scheduledAt =
          resolved.status === "needs_clarification"
            ? null
            : resolved.value.scheduledAt
        const endAt =
          resolved.status === "needs_clarification"
            ? null
            : resolved.value.endAt

        const reduced = reduceScheduleFsm(prev, {
          type: "AVAILABILITY_TEXT",
          at: inboundAt,
          inboundSid,
          windowText,
          scheduledAt,
          endAt,
          outcome,
        })
        fsmMeta = { effect: reduced.effect.kind, suppress: reduced.suppressReply }

        if (reduced.suppressReply) {
          replyHint = undefined
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            prev,
            next: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
          })
        } else if (reduced.effect.kind === "persist") {
          const persisted = await runPersistEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            prev,
            draftState: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
          })
          // Confirm copy is already on the FSM for context; still must deliver SMS.
          replyHint = guardLoop(prev, persisted.replyHint, { allowRepeat: true })
          scheduleStep = "scheduled"
        } else {
          let reply = effectToReply(reduced.effect)
          if (
            reduced.effect.kind === "clarify" &&
            resolved.status === "needs_clarification"
          ) {
            reply = buildVendorScheduleClarifySms(resolved.softPrompt)
          }
          replyHint = guardLoop(prev, reply, {
            allowRepeat: reduced.effect.kind === "soft_confirm" ||
              reduced.effect.kind === "clarify" ||
              reduced.effect.kind === "save_retry",
          })
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            prev,
            next: reduced.state,
            inboundBody: sms.inbound.body,
            inboundAt,
            inboundSid,
            outboundBody: replyHint,
          })
          scheduleStep = reduced.state.step
        }
      }

      await recordVendorRepliedEvent(supabase, {
        landlordId: ctx.landlordId,
        vendorId,
        conversationId: sms.conversationId,
        messageId: sms.messageId,
        maintenanceRequestId: scheduleTicketId,
        bodyPreview: sms.inbound.body,
        parsedAction: parsedAction === "accept" ? "accept" : null,
        transition,
      })

      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        replyHint,
        metadata: {
          vendorId,
          maintenanceRequestId: scheduleTicketId,
          parsedAction,
          scheduleStep,
          fsm: fsmMeta,
          bodyPreview: sms.inbound.body.slice(0, 160),
          // Signal inbound_processor: do not invent a generic fallback reply.
          skipGenericAutoReply: true,
        },
      }
    }

    if (inScheduleFlow && parsedAction === "decline") {
      const scheduleTicketId = prev.ticketId || ticketId
      const reduced = reduceScheduleFsm(prev, {
        type: "DECLINE",
        at: inboundAt,
        inboundSid,
      })
      replyHint = guardLoop(prev, effectToReply(reduced.effect))
      await persistScheduleTurn(supabase, {
        conversationId: sms.conversationId,
        ticketId: scheduleTicketId,
        prev,
        next: reduced.state,
        inboundBody: sms.inbound.body,
        inboundAt,
        inboundSid,
        outboundBody: replyHint,
      })

      if (scheduleTicketId) {
        const result = await applyVendorStatusTransition(supabase, {
          ticketId: scheduleTicketId,
          vendorId,
          action: "decline",
          source: "sms",
          conversationId: sms.conversationId,
          askAvailability: false,
        })
        transition = result.ok
          ? {
              ok: true,
              fromStatus: result.fromStatus,
              toStatus: result.toStatus,
            }
          : {
              ok: false,
              fromStatus: result.currentStatus,
              reason: result.reason,
            }
      }

      await recordVendorRepliedEvent(supabase, {
        landlordId: ctx.landlordId,
        vendorId,
        conversationId: sms.conversationId,
        messageId: sms.messageId,
        maintenanceRequestId: scheduleTicketId,
        bodyPreview: sms.inbound.body,
        parsedAction: "decline",
        transition,
      })

      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        replyHint,
        metadata: {
          vendorId,
          maintenanceRequestId: scheduleTicketId,
          parsedAction: "decline",
          scheduleStep: reduced.state.step,
          skipGenericAutoReply: true,
        },
      }
    }

    if (ticketId && parsedAction) {
      const result = await applyVendorStatusTransition(supabase, {
        ticketId,
        vendorId,
        action: parsedAction,
        source: "sms",
        conversationId: sms.conversationId,
        askAvailability: parsedAction === "accept",
      })
      transition = result.ok
        ? {
            ok: true,
            fromStatus: result.fromStatus,
            toStatus: result.toStatus,
          }
        : {
            ok: false,
            fromStatus: result.currentStatus,
            reason: result.reason,
          }

      if (parsedAction === "accept" && result.ok) {
        // Prefer the dedicated ask SMS; if it failed, reply on this thread instead.
        replyHint =
          result.availabilityAskSent === false
            ? buildVendorAvailabilityAskSms()
            : undefined
      } else if (parsedAction === "decline") {
        replyHint = buildVendorSmsDeclineReply()
      } else if (parsedAction === "accept") {
        replyHint = buildVendorSmsAcceptReply()
      }
    } else if (ticketId && !inScheduleFlow) {
      replyHint = buildVendorSmsReplyPrompt()
    }

    await recordVendorRepliedEvent(supabase, {
      landlordId: ctx.landlordId,
      vendorId,
      conversationId: sms.conversationId,
      messageId: sms.messageId,
      maintenanceRequestId: ticketId,
      bodyPreview: sms.inbound.body,
      parsedAction,
      transition,
    })

    if (ticketId && !sms.maintenanceRequestId) {
      const { error } = await supabase
        .from("sms_conversations")
        .update({ maintenance_request_id: ticketId })
        .eq("id", sms.conversationId)
      if (error) {
        console.error("[workflow-engine] link conversation ticket", error.message)
      }
    }

    return {
      templateId: "vendor_job_response",
      route: workflowRouteForTemplate("vendor_job_response"),
      replyHint,
      metadata: {
        vendorId,
        maintenanceRequestId: ticketId,
        parsedAction,
        transition,
        bodyPreview: sms.inbound.body.slice(0, 160),
        skipGenericAutoReply: true,
      },
    }
  },
}
