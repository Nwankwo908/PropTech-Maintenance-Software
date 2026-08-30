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
  formatWorkOrderRef,
  stripWorkOrderRefFromSms,
} from "../../vendor_outreach_copy.ts"
import {
  buildVendorWorkOrderClarifySms,
  createVendorWorkOrderClarification,
  isVendorWorkOrderClarificationExpired,
  listVendorActiveJobs,
  persistVendorWorkOrderClarification,
  readVendorWorkOrderClarification,
  resolveClarificationSelection,
  readPendingVendorJobOffer,
  VENDOR_WO_CLARIFICATION_KEY,
} from "../../sms/vendorWorkOrderClarification.ts"
import { resolveVendorAvailability } from "../../vendor_availability_parse.ts"
import { confirmVendorSchedule } from "../../vendor_job_schedule.ts"
import {
  askTenantScheduleConfirmation,
  buildVendorWaitingOnTenantSms,
} from "../../sms/tenantScheduleConfirm.ts"
import {
  appendInboundContext,
  appendOutboundContext,
  createIdleScheduleState,
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
  resolveVendorTicketForInbound,
  type VendorStatusTransitionResultMeta,
} from "../../sms/vendorSmsRouting.ts"
import { tryActVendorRescheduleTurn } from "../../sms/vendorRescheduleWorkflowAct.ts"
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
    case "waiting_on_tenant":
      return buildVendorWaitingOnTenantSms(effect.windowText)
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

async function runAskTenantEffect(
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
  const ask = await askTenantScheduleConfirmation(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorConversationId: params.conversationId,
    windowText: params.windowText,
    scheduledAt: params.scheduledAt,
  })

  const replyHint = ask.ok
    ? buildVendorWaitingOnTenantSms(params.windowText)
    : buildVendorScheduleClarifySms(
      "Thanks — we couldn't reach the resident yet. We'll keep trying. Reply with another time if this one changes.",
    )

  if (!ask.ok) {
    console.error("[vendor_job_response] tenant schedule ask failed", {
      ticketId: params.ticketId,
      error: ask.error,
    })
  }

  const state = await persistScheduleTurn(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    prev: params.prev,
    next: params.draftState,
    inboundBody: params.inboundBody,
    inboundAt: params.inboundAt,
    inboundSid: params.inboundSid,
    outboundBody: replyHint,
  })
  return { replyHint, state }
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
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult> {
    const sms = ctx.sms
    if (!sms) {
      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        metadata: { error: "missing_sms_context" },
      }
    }

    const rescheduleTurn = await tryActVendorRescheduleTurn(supabase, ctx, intent)
    if (rescheduleTurn) return rescheduleTurn

    if (!sms.identity.vendor_id?.trim()) {
      return handleUnknownSender(ctx)
    }

    const vendorId = sms.identity.vendor_id.trim()

    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state, maintenance_request_id")
      .eq("id", sms.conversationId)
      .maybeSingle()

    let intake = (convo?.intake_state as Record<string, unknown> | null) ?? null
    const prev = readVendorScheduleFsm(intake)
    const inboundAt = inboundOccurredAt(
      sms.inbound.rawPayload as Record<string, unknown>,
      new Date(),
    )
    const inboundSid = sms.inbound.providerMessageSid
    let transition: VendorStatusTransitionResultMeta | undefined
    let replyHint: string | undefined
    let scheduleStep = prev?.step
    let fsmMeta: Record<string, unknown> = {}

    const openJobs = await listVendorActiveJobs(supabase, vendorId)
    let effectiveBody = sms.inbound.body
    let forcedTicketId: string | null = null
    let resumedFromClarification = false
    let clarificationOriginalIntent: string | null = null

    const pendingClarify = readVendorWorkOrderClarification(intake)
    if (pendingClarify) {
      if (isVendorWorkOrderClarificationExpired(pendingClarify)) {
        await persistVendorWorkOrderClarification(supabase, {
          conversationId: sms.conversationId,
          clarification: null,
        })
        intake = { ...intake }
        delete intake[VENDOR_WO_CLARIFICATION_KEY]
      } else {
        const selectedId = resolveClarificationSelection(
          sms.inbound.body,
          pendingClarify,
          openJobs,
        )
        if (selectedId) {
          forcedTicketId = selectedId
          effectiveBody = pendingClarify.originalMessage
          resumedFromClarification = true
          clarificationOriginalIntent = pendingClarify.originalIntent
          await persistVendorWorkOrderClarification(supabase, {
            conversationId: sms.conversationId,
            clarification: null,
          })
        } else {
          const candidates = openJobs.filter((j) =>
            pendingClarify.candidateWorkOrderIds.includes(j.ticketId)
          )
          replyHint = buildVendorWorkOrderClarifySms(
            candidates.length > 0 ? candidates : openJobs,
            "need_work_order",
          )
          await recordVendorRepliedEvent(supabase, {
            landlordId: ctx.landlordId,
            vendorId,
            conversationId: sms.conversationId,
            messageId: sms.messageId,
            maintenanceRequestId: null,
            bodyPreview: sms.inbound.body,
            parsedAction: null,
            transition: undefined,
          })
          return {
            templateId: "vendor_job_response",
            route: workflowRouteForTemplate("vendor_job_response"),
            replyHint,
            metadata: {
              vendorId,
              maintenanceRequestId: null,
              awaitingWorkOrderClarification: true,
              bodyPreview: sms.inbound.body.slice(0, 160),
              skipGenericAutoReply: true,
            },
          }
        }
      }
    }

    const parsedAction = parseVendorSmsReply(effectiveBody)

    const prevInScheduleSteps =
      !!prev &&
      (prev.step === "awaiting_availability" ||
        prev.step === "awaiting_confirmation" ||
        prev.step === "awaiting_tenant_confirmation" ||
        !!prev.pendingWindowText?.trim())

    const ticketBind = forcedTicketId
      ? {
          ok: true as const,
          ticketId: forcedTicketId,
          boundBy: "clarification",
          openJobs,
        }
      : await resolveVendorTicketForInbound(supabase, {
          vendorId,
          inboundBody: effectiveBody,
          scheduleTicketId: prevInScheduleSteps ? prev?.ticketId : null,
          conversationTicketId:
            typeof convo?.maintenance_request_id === "string"
              ? convo.maintenance_request_id
              : null,
          pendingOfferTicketId: readPendingVendorJobOffer(intake)?.ticketId ??
            null,
          openJobs,
        })

    if (!ticketBind.ok) {
      if (
        ticketBind.reason === "need_work_order" ||
        ticketBind.reason === "unknown_work_order"
      ) {
        await persistVendorWorkOrderClarification(supabase, {
          conversationId: sms.conversationId,
          clarification: createVendorWorkOrderClarification({
            vendorId,
            conversationId: sms.conversationId,
            landlordId: ctx.landlordId,
            originalMessage: effectiveBody,
            originalIntent: parsedAction,
            candidateWorkOrderIds: ticketBind.openJobs.map((j) => j.ticketId),
          }),
        })
      }
      replyHint = buildVendorWorkOrderClarifySms(
        ticketBind.openJobs,
        ticketBind.reason,
      )
      await recordVendorRepliedEvent(supabase, {
        landlordId: ctx.landlordId,
        vendorId,
        conversationId: sms.conversationId,
        messageId: sms.messageId,
        maintenanceRequestId: null,
        bodyPreview: sms.inbound.body,
        parsedAction,
        transition: undefined,
      })
      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        replyHint,
        metadata: {
          vendorId,
          maintenanceRequestId: null,
          parsedAction,
          ticketBindReason: ticketBind.reason,
          openJobCount: ticketBind.openJobs.length,
          awaitingWorkOrderClarification: true,
          bodyPreview: sms.inbound.body.slice(0, 160),
          skipGenericAutoReply: true,
        },
      }
    }

    const ticketId = ticketBind.ticketId
    const workOrderRef = formatWorkOrderRef(ticketId)

    const staleSchedule = isStaleScheduleForTicket(prev, ticketId)
    // Stale FSM from a prior job on this SMS thread must not steal YES / times
    // from a new assignment (skips accept + "Earliest availability?").
    let schedulePrev = prev
    let inScheduleFlow = Boolean(prevInScheduleSteps && !staleSchedule && prev)

    // After WO clarification, re-apply the original message (e.g. "tomorrow at 10")
    // even if the schedule FSM was idle or pointed at another job.
    if (
      resumedFromClarification &&
      !parsedAction &&
      !inScheduleFlow &&
      stripWorkOrderRefFromSms(effectiveBody).length >= 3
    ) {
      schedulePrev = createIdleScheduleState(ticketId)
      inScheduleFlow = true
    }

    if (staleSchedule) {
      console.warn("[vendor_job_response] stale schedule ticket ignored", {
        scheduleTicketId: prev?.ticketId,
        currentTicketId: ticketId,
        step: prev?.step,
      })
    }

    if (inScheduleFlow && schedulePrev && parsedAction !== "decline") {
      const scheduleTicketId = schedulePrev.ticketId || ticketId
      if (!scheduleTicketId) {
        replyHint = buildVendorScheduleClarifySms()
      } else if (parsedAction === "accept") {
        const reduced = reduceScheduleFsm(schedulePrev, {
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
            schedulePrev,
            next: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
        } else if (reduced.effect.kind === "ask_tenant") {
          const asked = await runAskTenantEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            schedulePrev,
            draftState: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
          replyHint = guardLoop(schedulePrev, asked.replyHint, { allowRepeat: true })
          scheduleStep = "awaiting_tenant_confirmation"
        } else if (reduced.effect.kind === "persist") {
          const persisted = await runPersistEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            schedulePrev,
            draftState: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
          // Always deliver confirm / save-retry — repeating "lock it in" is OK.
          replyHint = guardLoop(schedulePrev, persisted.replyHint, { allowRepeat: true })
          scheduleStep = "scheduled"
        } else {
          replyHint = guardLoop(schedulePrev, effectToReply(reduced.effect), {
            allowRepeat: reduced.effect.kind === "save_retry" ||
              reduced.effect.kind === "clarify" ||
              reduced.effect.kind === "waiting_on_tenant",
          })
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            schedulePrev,
            next: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
            outboundBody: replyHint,
          })
          scheduleStep = reduced.state.step
        }
      } else {
        const availabilityBody = stripWorkOrderRefFromSms(effectiveBody) ||
          effectiveBody
        const resolved = await resolveVendorAvailability(availabilityBody, {
          conversationContext: formatScheduleContextForPrompt(schedulePrev),
          clarifyAttempts: schedulePrev.clarifyAttempts ?? 0,
        })
        const outcome =
          resolved.status === "resolved"
            ? "resolved" as const
            : resolved.status === "needs_confirmation"
            ? "needs_confirmation" as const
            : "needs_clarification" as const
        const windowText =
          resolved.status === "needs_clarification"
            ? availabilityBody.trim()
            : (resolved.value.entity?.display_text ??
              resolved.value.windowLabel)
        const scheduledAt =
          resolved.status === "needs_clarification"
            ? null
            : resolved.value.scheduledAt
        const endAt =
          resolved.status === "needs_clarification"
            ? null
            : (resolved.value.entity?.type === "WINDOW"
              ? resolved.value.endAt
              : null)

        const reduced = reduceScheduleFsm(schedulePrev, {
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
            schedulePrev,
            next: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
        } else if (reduced.effect.kind === "ask_tenant") {
          const asked = await runAskTenantEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            schedulePrev,
            draftState: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
          replyHint = guardLoop(schedulePrev, asked.replyHint, { allowRepeat: true })
          scheduleStep = "awaiting_tenant_confirmation"
        } else if (reduced.effect.kind === "persist") {
          const persisted = await runPersistEffect(supabase, {
            ticketId: scheduleTicketId,
            vendorId,
            conversationId: sms.conversationId,
            windowText: reduced.effect.windowText,
            scheduledAt: reduced.effect.scheduledAt,
            schedulePrev,
            draftState: reduced.state,
            inboundBody: effectiveBody,
            inboundAt,
            inboundSid,
          })
          // Confirm copy is already on the FSM for context; still must deliver SMS.
          replyHint = guardLoop(schedulePrev, persisted.replyHint, { allowRepeat: true })
          scheduleStep = "scheduled"
        } else {
          let reply = effectToReply(reduced.effect)
          if (
            reduced.effect.kind === "clarify" &&
            resolved.status === "needs_clarification"
          ) {
            reply = buildVendorScheduleClarifySms(resolved.softPrompt)
          }
          if (
            reduced.effect.kind === "soft_confirm" &&
            resolved.status === "needs_confirmation"
          ) {
            // Prefer typed WINDOW/EXACT softPrompt over raw windowText.
            reply = resolved.softPrompt
          }
          replyHint = guardLoop(schedulePrev, reply, {
            allowRepeat: reduced.effect.kind === "soft_confirm" ||
              reduced.effect.kind === "clarify" ||
              reduced.effect.kind === "save_retry" ||
              reduced.effect.kind === "waiting_on_tenant",
          })
          await persistScheduleTurn(supabase, {
            conversationId: sms.conversationId,
            ticketId: scheduleTicketId,
            schedulePrev,
            next: reduced.state,
            inboundBody: effectiveBody,
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
          boundBy: ticketBind.boundBy,
          resumedFromClarification,
          effectiveBodyPreview: effectiveBody.slice(0, 160),
          bodyPreview: sms.inbound.body.slice(0, 160),
          // Signal inbound_processor: do not invent a generic fallback reply.
          skipGenericAutoReply: true,
        },
      }
    }

    if (inScheduleFlow && schedulePrev && parsedAction === "decline") {
      const scheduleTicketId = schedulePrev.ticketId || ticketId
      const reduced = reduceScheduleFsm(schedulePrev, {
        type: "DECLINE",
        at: inboundAt,
        inboundSid,
      })
      replyHint = guardLoop(schedulePrev, effectToReply(reduced.effect))
      await persistScheduleTurn(supabase, {
        conversationId: sms.conversationId,
        ticketId: scheduleTicketId,
        schedulePrev,
        next: reduced.state,
        inboundBody: effectiveBody,
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
            ? buildVendorAvailabilityAskSms(workOrderRef)
            : undefined
      } else if (parsedAction === "decline") {
        replyHint = buildVendorSmsDeclineReply()
      } else if (parsedAction === "accept") {
        replyHint = buildVendorSmsAcceptReply(workOrderRef)
      }
    } else if (ticketId && !inScheduleFlow) {
      replyHint = buildVendorSmsReplyPrompt(workOrderRef)
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
        boundBy: ticketBind.boundBy,
        resumedFromClarification,
        effectiveBodyPreview: effectiveBody.slice(0, 160),
        bodyPreview: sms.inbound.body.slice(0, 160),
        skipGenericAutoReply: true,
      },
    }
  },
}
