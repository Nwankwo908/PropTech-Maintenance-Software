import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  classifyMaintenanceRequest,
  MAINTENANCE_CLASSIFICATION_EVENTS,
} from "../maintenance_classification/mod.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import {
  findActiveWorkflowRun,
  updateWorkflowRun,
} from "../engine/workflowRuns.ts"
import {
  ensureEarlySmsMaintenanceTicket,
  shouldMintEarlyTicket,
  withDraftTicketId,
} from "./ensureEarlySmsTicket.ts"
import { processUnknownContactIntakeTurn } from "./unknownContactIntake.ts"
import {
  beginMultiIssueSharedIntake,
  buildMultiIssueConfirmSms,
  buildMultiIssueSubmittedSms,
  buildRequestSubmittedSms,
  detectMultipleMaintenanceIssues,
  intakeSliceForPendingIssue,
  intakeStateForMultiIssueConfirm,
  INTAKE_MULTI_SUBMIT_FAILED_SMS,
  INTAKE_SUBMIT_FAILED_SMS,
  isNoReply,
} from "./multiIssueIntake.ts"
import type { WorkflowContext, WorkflowResult } from "./workflow_types.ts"
import { extractResidentAvailabilityText } from "./residentAvailabilityExtract.ts"
import { submitSmsMaintenanceRequest } from "./submitSmsMaintenanceRequest.ts"
import {
  buildConfirmationSummary,
  computeIntakeSeverity,
  conversationStatusForStep,
  EDIT_FIELD_OPTIONS,
  extractFirstNoticedFromText,
  extractRoomFromText,
  intakeQuestionForStep,
  INTAKE_VALIDATION,
  nextCollectingStep,
  normalizeRoomOrArea,
  parseContactMethod,
  parseEditFieldChoice,
  parseIssueType,
  recordIntakePromptRepeat,
  resolveUrgencyReply,
  pipelineTradeToIssueType,
  recommendUrgency,
  sanitizeIntakeState,
  type IntakeStep,
  type SmsIntakeState,
  urgencyQuestion,
} from "./residentIntakeTypes.ts"

const MAX_CLASSIFICATION_CLARIFICATIONS = 2

const INTAKE_LOOP_HANDOFF_SMS =
  "I've passed your message to the property team so they can help with what you need. They'll follow up with you here.\n\nIf something in your home needs a repair, just text a short description anytime."

function tradeLabelForAck(trade: string): string {
  const labels: Record<string, string> = {
    appliance_repair: "appliance repair",
    electrical: "electrical",
    hvac: "HVAC",
    locksmith: "locksmith",
    pest_control: "pest control",
    plumbing: "plumbing",
    roofing: "roofing",
    general: "general maintenance",
  }
  return labels[trade] ?? trade.replace(/_/g, " ")
}

function isYesReply(body: string): boolean {
  return /^(yes|y|confirm|submit|ok)\b/i.test(body.trim())
}

/** Merge any media attached to this inbound message into the intake state (dedup). */
function captureInboundMedia(
  state: SmsIntakeState,
  mediaUrls: string[] | undefined,
  provider: string | undefined,
): SmsIntakeState {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return state
  const existing = Array.isArray(state.photo_urls) ? state.photo_urls : []
  const merged = [...existing]
  for (const url of mediaUrls) {
    if (typeof url === "string" && url.trim() && !merged.includes(url.trim())) {
      merged.push(url.trim())
    }
  }
  if (merged.length === existing.length) return state
  return { ...state, photo_urls: merged, photo_provider: provider ?? state.photo_provider }
}

function isEditReply(body: string): boolean {
  return /^(edit|change|update|modify)\b/i.test(body.trim())
}

function questionForStep(state: SmsIntakeState, step: IntakeStep): string {
  if (step === "classification_clarification") {
    return (
      state.clarification_question?.trim() ||
      "Thanks for the update. Could you tell me which fixture or appliance is having the problem, and which room it's in?"
    )
  }
  if (step === "urgency") {
    return urgencyQuestion(state)
  }
  if (step === "awaiting_edit_selection") return EDIT_FIELD_OPTIONS
  if (step === "awaiting_confirm") return buildConfirmationSummary(state)
  return intakeQuestionForStep(
    state,
    step as Exclude<
      IntakeStep,
      | "awaiting_confirm"
      | "awaiting_edit_selection"
      | "submitted"
      | "classification_clarification"
    >,
  )
}

async function loadIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<SmsIntakeState> {
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state, maintenance_request_id")
    .eq("id", conversationId)
    .maybeSingle()

  if (error) {
    console.error("[sms-intake] load state", error.message)
    return {}
  }

  const raw = (data as { intake_state?: SmsIntakeState | null } | null)?.intake_state
  const state = (raw && typeof raw === "object") ? { ...raw } : {}
  return sanitizeIntakeState(state)
}

async function saveIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
  state: SmsIntakeState,
): Promise<void> {
  const cleaned = sanitizeIntakeState(state)
  const step = cleaned.step ?? "issue_type"
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      intake_state: cleaned,
      status: conversationStatusForStep(step),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)

  if (error) {
    console.error("[sms-intake] save state failed (continuing with reply)", {
      conversationId,
      step,
      error: error.message,
    })
  }
}

async function initializeIntake(
  body: string,
  mediaCount: number,
  clarificationAnswers: string[] = [],
): Promise<SmsIntakeState> {
  let initial = body.trim()
  if (mediaCount > 0) {
    initial = initial
      ? `${initial}\n(Photo attached)`
      : "Maintenance issue (photo attached)"
  }

  const classification = await classifyMaintenanceRequest({
    rawDescription: initial,
    clarificationAnswers,
    // Use embeddings in production when OpenAI is configured; Jaccard still runs offline/tests.
    skipEmbeddings: !Deno.env.get("OPENAI_API_KEY")?.trim(),
  })

  const inferred = pipelineTradeToIssueType(
    classification.issueType,
    classification.vendorTrade,
  )
  const extractedRoom =
    extractRoomFromText(initial) ??
    (classification.entities.location
      ? extractRoomFromText(classification.entities.location)
      : null)
  const extractedNoticed = extractFirstNoticedFromText(initial)

  const visitWindows = extractResidentAvailabilityText(initial) ?? undefined

  const base: SmsIntakeState = {
    initial_message: initial,
    description: initial,
    photo_urls: [],
    ...(extractedNoticed ? { first_noticed: extractedNoticed } : {}),
    sanitized_description: classification.sanitizedDescription,
    preferred_visit_windows: visitWindows,
    vendor_trade:
      classification.vendorTrade !== "other" || !classification.clarificationRequired
        ? classification.vendorTrade
        : undefined,
    classification_confidence: classification.classificationConfidence,
    classification_pipeline_version: classification.pipelineVersion,
    clarification_answers: clarificationAnswers.length
      ? clarificationAnswers
      : undefined,
    clarification_attempts: clarificationAnswers.length,
  }

  if (classification.clarificationRequired && classification.clarification) {
    if (clarificationAnswers.length < MAX_CLASSIFICATION_CLARIFICATIONS) {
      return sanitizeIntakeState({
        ...base,
        step: "classification_clarification",
        issue_type: inferred ?? undefined,
        room_or_area: extractedRoom ?? undefined,
        clarification_question: classification.clarification.question,
      })
    }
    // After max clarifications: continue with best signal; never invent a trade.
  }

  if (inferred) {
    if (extractedRoom) {
      return sanitizeIntakeState({
        ...base,
        step: extractedNoticed ? "safety_concerns" : "first_noticed",
        issue_type: inferred,
        room_or_area: extractedRoom,
        vendor_trade: classification.vendorTrade,
      })
    }
    return sanitizeIntakeState({
      ...base,
      step: "room_or_area",
      issue_type: inferred,
      vendor_trade: classification.vendorTrade,
    })
  }

  if (extractedRoom) {
    return sanitizeIntakeState({
      ...base,
      step: "issue_type",
      room_or_area: extractedRoom,
    })
  }

  return sanitizeIntakeState({
    ...base,
    step: "issue_type",
  })
}

async function logClassificationAudit(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string | null
    state: SmsIntakeState
    eventType: string
    extra?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: params.eventType,
      source: "sms_intake",
      actor_type: "system",
      resident_id: params.residentId,
      conversation_id: params.conversationId,
      maintenance_request_id: params.state.draft_ticket_id ?? null,
      metadata: {
        raw_description: params.state.initial_message ?? params.state.description,
        sanitized_description: params.state.sanitized_description,
        vendor_trade: params.state.vendor_trade,
        issue_type: params.state.issue_type,
        classification_confidence: params.state.classification_confidence,
        pipeline_version: params.state.classification_pipeline_version,
        clarification_attempts: params.state.clarification_attempts ?? 0,
        draft_ticket_id: params.state.draft_ticket_id ?? null,
        ...params.extra,
      },
    })
  } catch (e) {
    console.warn("[sms-intake] classification audit log failed", e)
  }
}

/** Mint/patch durable ticket so Active Tasks never depends on a conversation-id WO. */
async function persistEarlyTicket(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
  state: SmsIntakeState,
): Promise<SmsIntakeState> {
  if (!shouldMintEarlyTicket(state)) return state
  const residentId = ctx.identity.resident_id?.trim()
  if (!residentId) return state

  const { ticketId } = await ensureEarlySmsMaintenanceTicket(supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    residentId,
    intake: state,
  })
  return withDraftTicketId(state, ticketId)
}

/** Unpin a maintenance_intake run so the next text is not stuck on the wizard. */
export async function releaseMaintenanceIntakePin(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    state?: SmsIntakeState | null
    runStatus: "escalated" | "completed" | "cancelled"
    currentStep: string
    reason: string
    lastResidentMessage?: string | null
    eventMessage: string
    /** Drop the draft ticket id so a cancelled request cannot re-pin this thread. */
    clearDraftTicket?: boolean
  },
): Promise<{ runId: string | null; draftTicketId: string | null }> {
  const draftTicketId = params.state?.draft_ticket_id ?? null
  const run = await findActiveWorkflowRun(supabase, {
    landlordId: params.landlordId,
    conversationId: params.conversationId,
    templateId: "maintenance_intake",
  })

  if (run?.id) {
    await updateWorkflowRun(supabase, run.id, {
      status: params.runStatus,
      currentStep: params.currentStep,
      completedAt: params.runStatus === "escalated"
        ? undefined
        : new Date().toISOString(),
      metadata: {
        handed_off_reason: params.reason,
        last_resident_message: params.lastResidentMessage ?? null,
      },
      pipelineStage: params.runStatus === "escalated" ? "escalate" : "log",
      eventMessage: params.eventMessage,
      eventStep: params.currentStep,
    })
  }

  await supabase
    .from("sms_conversations")
    .update({
      workflow_run_id: null,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  await saveIntakeState(supabase, params.conversationId, {
    step: "submitted",
    draft_ticket_id: params.clearDraftTicket ? undefined : draftTicketId ?? undefined,
    photo_urls: [],
  })

  return { runId: run?.id ?? null, draftTicketId }
}

async function handOffStuckIntake(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
  state: SmsIntakeState,
): Promise<WorkflowResult> {
  const residentId = ctx.identity.resident_id?.trim() || null
  const latest = ctx.inbound.body.trim().slice(0, 160)
  const step = state.prompt_repeat_step ?? state.step ?? "unknown"

  const { runId } = await releaseMaintenanceIntakePin(supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    state,
    runStatus: "escalated",
    currentStep: "handed_off",
    reason: "intake_clarify_loop",
    lastResidentMessage: latest,
    eventMessage:
      "Intake handed off after the same question was repeated without a valid answer.",
  })

  void notifyLandlordNeedsAttention(supabase, {
    landlordId: ctx.landlordId,
    kind: "workflow_escalated",
    headline: "Resident needs help over text",
    detail: latest
      ? `They said this isn't a repair we could take as a work order. Latest message: "${latest}"`
      : "We couldn't match their replies to a maintenance request.",
    idempotencyKey: `intake-handoff:${ctx.conversationId}:${step}`,
    maintenanceRequestId: state.draft_ticket_id ?? ctx.maintenanceRequestId ?? null,
    workflowRunId: runId,
    unitId: ctx.identity.unit_id ?? null,
    residentId,
  })

  await recordActivityLog(supabase, {
    landlordId: ctx.landlordId,
    eventType: "sms.intake_handed_off",
    source: "sms",
    actorType: "system",
    actorId: residentId,
    unitId: ctx.identity.unit_id ?? null,
    residentId,
    maintenanceRequestId: state.draft_ticket_id ?? ctx.maintenanceRequestId ?? null,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    workflowRunId: runId,
    workflowTemplateId: "maintenance_intake",
    metadata: {
      message:
        "Passed the resident's text to the property team after the same question was asked twice without a usable answer.",
      handed_off_step: step,
      last_resident_message: latest,
      draft_ticket_id: state.draft_ticket_id ?? null,
    },
  })

  return {
    route: "resident_maintenance_intake",
    replyHint: INTAKE_LOOP_HANDOFF_SMS,
    metadata: {
      intakeStep: "handed_off",
      handedOff: true,
      handed_off_step: step,
      skipGenericAutoReply: true,
    },
  }
}

/** Persist + send an intake question, or hand off if this step has been asked too many times. */
async function finishIntakeQuestion(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
  state: SmsIntakeState,
  replyHint: string,
  metadata: Record<string, unknown> = {},
): Promise<WorkflowResult> {
  const step = (state.step ?? "issue_type") as IntakeStep
  const repeated = recordIntakePromptRepeat(state, step)
  if (repeated.shouldHandoff) {
    return handOffStuckIntake(supabase, ctx, repeated.state)
  }
  await saveIntakeState(supabase, ctx.conversationId, repeated.state)
  return {
    route: "resident_maintenance_intake",
    replyHint,
    metadata: {
      ...metadata,
      intakeStep: step,
      promptRepeatCount: repeated.state.prompt_repeat_count,
    },
  }
}

function applyStepAnswer(
  state: SmsIntakeState,
  step: IntakeStep,
  body: string,
): { ok: true; state: SmsIntakeState } | { ok: false; retry: string } {
  const answer = body.trim()
  if (!answer) {
    return { ok: false, retry: questionForStep(state, step) }
  }

  const next = { ...state }

  switch (step) {
    case "issue_type": {
      const parsed = parseIssueType(answer)
      if (!parsed) {
        return {
          ok: false,
          retry: INTAKE_VALIDATION.issue_type,
        }
      }
      next.issue_type = parsed
      next.step = nextCollectingStep("issue_type", next)
      break
    }
    case "room_or_area": {
      const room = normalizeRoomOrArea(answer, state.initial_message)
      if (!room) {
        const noticed = extractFirstNoticedFromText(answer)
        if (noticed) {
          next.first_noticed = noticed
          next.prompt_repeat_count = 0
          next.prompt_repeat_step = undefined
          next.step = "room_or_area"
          break
        }
        return {
          ok: false,
          retry:
            "Sorry you're dealing with that. Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?",
        }
      }
      next.room_or_area = room
      next.step = nextCollectingStep("room_or_area", next)
      break
    }
    case "first_noticed":
      next.first_noticed = answer
      next.step = nextCollectingStep("first_noticed", next)
      break
    case "safety_concerns":
      next.safety_concerns = /^none$/i.test(answer) ? "None reported" : answer
      next.recommended_urgency = recommendUrgency(next)
      next.step = "urgency"
      break
    case "urgency": {
      const parsed = resolveUrgencyReply(answer, next.recommended_urgency)
      if (!parsed) {
        return {
          ok: false,
          retry: INTAKE_VALIDATION.urgency,
        }
      }
      next.urgency = parsed
      next.step = nextCollectingStep("urgency")
      break
    }
    case "preferred_contact_method": {
      const parsed = parseContactMethod(answer)
      if (!parsed) {
        return {
          ok: false,
          retry: INTAKE_VALIDATION.contact_method,
        }
      }
      next.preferred_contact_method = parsed
      next.severity = computeIntakeSeverity(next)
      next.step = (next.photo_urls?.length ?? 0) > 0 ? "awaiting_confirm" : "photo"
      break
    }
    default:
      break
  }

  return { ok: true, state: next }
}

/** Structured SMS maintenance intake — one question at a time. */
export async function processResidentMaintenanceIntake(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  const body = ctx.inbound.body.trim()
  const residentId = ctx.identity.resident_id?.trim()

  console.info("[sms-intake] processing", {
    conversationId: ctx.conversationId,
    residentId,
    resolutionSource: ctx.resolutionSource,
    selfHealingPhase: ctx.selfHealingPhase,
    bodyPreview: body.slice(0, 120),
  })

  if (!residentId) {
    // Hand off to conversational unknown-contact intake so unit replies like
    // "1a" are parsed instead of looping the same "need your unit" prompt.
    try {
      const priorIntake = await loadIntakeState(supabase, ctx.conversationId)
      const seedIssue =
        priorIntake.initial_message?.trim() ||
        priorIntake.description?.trim() ||
        null
      const turn = await processUnknownContactIntakeTurn(supabase, {
        landlordId: ctx.landlordId,
        conversationId: ctx.conversationId,
        senderPhone: ctx.inbound.from,
        inboundBody: body,
        identity: ctx.identity,
        suggestedUnit: ctx.suggestedUnit,
        seedIssueMessage: seedIssue,
      })
      return {
        route: "unknown_sender_onboarding",
        replyHint: turn.replyHint,
        metadata: {
          blocked: "missing_resident_id",
          handoff_unknown_contact: true,
          selfHealingPhase: turn.selfHealingPhase,
          ...turn.metadata,
        },
      }
    } catch (err) {
      console.error("[sms-intake] unknown-contact handoff failed", err)
      return {
        route: "unknown_sender_onboarding",
        replyHint:
          "Hi! I can help with that. I don't recognize this phone number yet. Which property and apartment are you contacting us about?",
        metadata: {
          blocked: "missing_resident_id",
          handoff_unknown_contact: true,
          handoff_error: true,
        },
      }
    }
  }

  if (
    ctx.selfHealingPhase === "resolved" &&
    ctx.resolutionSource === "self_healed_unit"
  ) {
    return {
      route: "resident_maintenance_intake",
      replyHint:
        "Great news, I found your unit! Whenever you're ready, tell me what's going on (a photo helps too).",
      metadata: { intakeDeferred: true },
    }
  }

  if (ctx.maintenanceRequestId) {
    const existing = await loadIntakeState(supabase, ctx.conversationId)
    if (existing.step === "submitted") {
      await saveIntakeState(supabase, ctx.conversationId, {})
    }
  }

  let state = await loadIntakeState(supabase, ctx.conversationId)
  const isFresh = !state.step || state.step === "submitted"

  if (isFresh) {
    // Multi-ask path: confirm split before the single-issue wizard.
    try {
      const multiIssues = await detectMultipleMaintenanceIssues(body)
      if (multiIssues.length >= 2) {
        state = intakeStateForMultiIssueConfirm(body, multiIssues)
        state = captureInboundMedia(
          state,
          ctx.inbound.mediaUrls,
          ctx.inbound.provider,
        )
        await saveIntakeState(supabase, ctx.conversationId, state)
        console.info("[sms-intake] multi-issue confirm", {
          conversationId: ctx.conversationId,
          issueCount: multiIssues.length,
          trades: multiIssues.map((i) => i.vendor_trade),
        })
        return finishIntakeQuestion(
          supabase,
          ctx,
          state,
          buildMultiIssueConfirmSms(multiIssues),
          {
            started: true,
            multiIssue: true,
            issueCount: multiIssues.length,
            trades: multiIssues.map((i) => i.vendor_trade),
          },
        )
      }
    } catch (err) {
      console.warn("[sms-intake] multi-issue detect failed; single path", err)
    }

    state = await initializeIntake(body, ctx.inbound.mediaUrls.length)
    state = captureInboundMedia(state, ctx.inbound.mediaUrls, ctx.inbound.provider)
    state = sanitizeIntakeState(state)
    state = await persistEarlyTicket(supabase, ctx, state)
    await saveIntakeState(supabase, ctx.conversationId, state)
    await logClassificationAudit(supabase, {
      landlordId: ctx.landlordId,
      conversationId: ctx.conversationId,
      residentId,
      state,
      eventType: state.step === "classification_clarification"
        ? MAINTENANCE_CLASSIFICATION_EVENTS.CLARIFICATION_REQUESTED
        : MAINTENANCE_CLASSIFICATION_EVENTS.CLASSIFIED,
      extra: {
        started: true,
        clarification_required: state.step === "classification_clarification",
      },
    })
    const replyHint = questionForStep(state, state.step as IntakeStep)
    console.info("[sms-intake] started new intake", {
      conversationId: ctx.conversationId,
      step: state.step,
      inferredIssueType: state.issue_type ?? null,
      vendorTrade: state.vendor_trade ?? null,
      confidence: state.classification_confidence ?? null,
      draftTicketId: state.draft_ticket_id ?? null,
    })
    return finishIntakeQuestion(supabase, ctx, state, replyHint, {
      started: true,
      vendor_trade: state.vendor_trade,
      classification_confidence: state.classification_confidence,
      draft_ticket_id: state.draft_ticket_id,
    })
  }

  if (ctx.inbound.mediaUrls.length > 0) {
    state = captureInboundMedia(state, ctx.inbound.mediaUrls, ctx.inbound.provider)
    // Persist immediately so a photo is never lost, even on branches below that
    // return a static reply without saving (e.g. an unrecognized confirm reply).
    await saveIntakeState(supabase, ctx.conversationId, state)
  }

  const step = state.step as IntakeStep

  if (step === "classification_clarification") {
    const answers = [...(state.clarification_answers ?? []), body]
    const seed = state.initial_message || state.description || body
    const priorDraft = state.draft_ticket_id
    state = await initializeIntake(seed, 0, answers)
    if (priorDraft) state = { ...state, draft_ticket_id: priorDraft }
    state = captureInboundMedia(state, ctx.inbound.mediaUrls, ctx.inbound.provider)
    state = sanitizeIntakeState(state)
    state = await persistEarlyTicket(supabase, ctx, state)
    await saveIntakeState(supabase, ctx.conversationId, state)
    await logClassificationAudit(supabase, {
      landlordId: ctx.landlordId,
      conversationId: ctx.conversationId,
      residentId,
      state,
      eventType: state.step === "classification_clarification"
        ? MAINTENANCE_CLASSIFICATION_EVENTS.CLARIFICATION_REQUESTED
        : MAINTENANCE_CLASSIFICATION_EVENTS.CLASSIFIED,
      extra: {
        clarification_answer: body.slice(0, 240),
        clarification_round: answers.length,
      },
    })

    let replyHint = questionForStep(state, state.step as IntakeStep)
    if (
      state.step !== "classification_clarification" &&
      state.vendor_trade &&
      state.vendor_trade !== "other"
    ) {
      const ack =
        `Thanks for clarifying. I've classified this as a ${tradeLabelForAck(state.vendor_trade)} issue. `
      replyHint = `${ack}${replyHint}`
    }

    return finishIntakeQuestion(supabase, ctx, state, replyHint, {
      clarified: true,
      vendor_trade: state.vendor_trade,
      classification_confidence: state.classification_confidence,
      draft_ticket_id: state.draft_ticket_id,
    })
  }

  if (step === "awaiting_multi_issue_confirm") {
    const issues = Array.isArray(state.pending_issues) ? state.pending_issues : []
    if (isYesReply(body) && issues.length >= 2) {
      // Keep the split, then run the normal shared intake script for assets/info.
      state = beginMultiIssueSharedIntake({
        ...state,
        pending_issues: issues,
      })
      state = captureInboundMedia(
        state,
        ctx.inbound.mediaUrls,
        ctx.inbound.provider,
      )
      state = sanitizeIntakeState(state)
      await saveIntakeState(supabase, ctx.conversationId, state)
      const nextStep = state.step as IntakeStep
      const followUp =
        nextStep === "room_or_area"
          ? "Great — I'll open a separate work order for each. Which room are these mostly happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?"
          : questionForStep(state, nextStep)
      return finishIntakeQuestion(supabase, ctx, state, followUp, {
        multiIssue: true,
        multiIssueConfirmed: true,
        issueCount: issues.length,
      })
    }

    if (isNoReply(body)) {
      // Fall back to normal single-issue wizard on the full message.
      state = await initializeIntake(
        state.initial_message || state.description || body,
        0,
      )
      state = captureInboundMedia(
        state,
        ctx.inbound.mediaUrls,
        ctx.inbound.provider,
      )
      state = sanitizeIntakeState(state)
      state = await persistEarlyTicket(supabase, ctx, state)
      await saveIntakeState(supabase, ctx.conversationId, state)
      return finishIntakeQuestion(
        supabase,
        ctx,
        state,
        questionForStep(state, state.step as IntakeStep),
        {
          multiIssueDeclined: true,
          draft_ticket_id: state.draft_ticket_id,
        },
      )
    }

    return finishIntakeQuestion(
      supabase,
      ctx,
      state,
      issues.length >= 2
        ? buildMultiIssueConfirmSms(issues)
        : "Reply YES to open separate work orders, or NO to treat this as one request.",
      { multiIssue: true },
    )
  }

  if (step === "awaiting_confirm") {
    if (isYesReply(body)) {
      const multiIssues = Array.isArray(state.pending_issues)
        ? state.pending_issues
        : []
      if (multiIssues.length >= 2) {
        try {
          const ticketIds: string[] = []
          let allVendorsAssigned = true
          // Same unit + same trade → reuse the first assigned vendor.
          const vendorByTrade = new Map<string, string>()
          for (let i = 0; i < multiIssues.length; i++) {
            const issue = multiIssues[i]
            const slice = intakeSliceForPendingIssue(state, issue, {
              forceNewTicket: i > 0,
            })
            const tradeKey = (issue.vendor_trade || "").trim().toLowerCase()
            const preferVendorId = tradeKey
              ? vendorByTrade.get(tradeKey) ?? null
              : null
            const { ticketId, vendorId, vendorAssigned } =
              await submitSmsMaintenanceRequest(supabase, {
                landlordId: ctx.landlordId,
                conversationId: ctx.conversationId,
                residentId,
                intake: slice,
                forceNewTicket: i > 0,
                preferVendorId,
              })
            ticketIds.push(ticketId)
            if (!vendorAssigned) allVendorsAssigned = false
            if (tradeKey && vendorId) {
              vendorByTrade.set(tradeKey, vendorId)
            }
          }
          const submitted: SmsIntakeState = {
            ...state,
            step: "submitted",
            pending_issues: multiIssues,
            draft_ticket_id: ticketIds[0],
          }
          await saveIntakeState(supabase, ctx.conversationId, submitted)
          return {
            route: "resident_maintenance_intake",
            replyHint: buildMultiIssueSubmittedSms(
              ticketIds,
              allVendorsAssigned,
            ),
            metadata: {
              submitted: true,
              multiIssue: true,
              ticketIds,
              intakeStep: "submitted",
            },
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error("[sms-intake] multi-issue submit failed", message)
          return {
            route: "resident_maintenance_intake",
            replyHint: INTAKE_MULTI_SUBMIT_FAILED_SMS,
            metadata: { submitError: message, multiIssue: true },
          }
        }
      }

      try {
        const { ticketId, vendorAssigned } = await submitSmsMaintenanceRequest(
          supabase,
          {
            landlordId: ctx.landlordId,
            conversationId: ctx.conversationId,
            residentId,
            intake: state,
          },
        )
        const submitted: SmsIntakeState = { ...state, step: "submitted" }
        await saveIntakeState(supabase, ctx.conversationId, submitted)
        return {
          route: "resident_maintenance_intake",
          replyHint: buildRequestSubmittedSms(ticketId, vendorAssigned),
          metadata: { submitted: true, ticketId, intakeStep: "submitted" },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[sms-intake] submit failed", message)
        return {
          route: "resident_maintenance_intake",
          replyHint: INTAKE_SUBMIT_FAILED_SMS,
          metadata: { submitError: message },
        }
      }
    }

    if (isEditReply(body)) {
      state = { ...state, step: "awaiting_edit_selection" }
      return finishIntakeQuestion(supabase, ctx, state, EDIT_FIELD_OPTIONS)
    }

    return finishIntakeQuestion(
      supabase,
      ctx,
      state,
      "Reply YES if that looks good, or tell me what you'd like to change.",
    )
  }

  if (step === "awaiting_edit_selection") {
    const field = parseEditFieldChoice(body)
    if (!field) {
      return finishIntakeQuestion(supabase, ctx, state, EDIT_FIELD_OPTIONS, {
        invalidEditChoice: true,
      })
    }

    if (field === "description") {
      state = { ...state, step: "awaiting_edit_selection", edit_field: "description" }
      return finishIntakeQuestion(
        supabase,
        ctx,
        state,
        "Sure thing! Send me the updated description.",
        { editing: "description" },
      )
    }

    state = { ...state, step: field, edit_field: field }
    if (field === "urgency") {
      state.recommended_urgency = recommendUrgency(state)
    }
    return finishIntakeQuestion(
      supabase,
      ctx,
      state,
      questionForStep(state, field),
      { editing: field },
    )
  }

  if (state.edit_field === "description" && step === "awaiting_edit_selection") {
    state = {
      ...state,
      description: body,
      edit_field: undefined,
      severity: computeIntakeSeverity({ ...state, description: body }),
      step: "awaiting_confirm",
    }
    await saveIntakeState(supabase, ctx.conversationId, state)
    return finishIntakeQuestion(
      supabase,
      ctx,
      state,
      buildConfirmationSummary(state),
      { edited: "description" },
    )
  }

  if (step === "photo") {
    // Media (if any) was already captured above. This step never traps the
    // resident: a photo, "skip", or any other reply moves us to confirmation.
    const hasPhoto = (state.photo_urls?.length ?? 0) > 0
    const receivedNow = ctx.inbound.mediaUrls.length > 0
    state = { ...state, edit_field: undefined, step: "awaiting_confirm" }
    state.severity = computeIntakeSeverity(state)
    await saveIntakeState(supabase, ctx.conversationId, state)
    const ack = receivedNow
      ? "Got the photo, thank you! "
      : hasPhoto
        ? "Thanks! "
        : "No problem. "
    return finishIntakeQuestion(
      supabase,
      ctx,
      state,
      `${ack}${buildConfirmationSummary(state)}`,
      {
        photoReceived: receivedNow,
        photoCount: state.photo_urls?.length ?? 0,
      },
    )
  }

  const result = applyStepAnswer(state, step, body)
  if (!result.ok) {
    return finishIntakeQuestion(supabase, ctx, state, result.retry, {
      invalidAnswer: true,
    })
  }

  state = result.state
  state = sanitizeIntakeState(state)

  if (state.edit_field && step === state.edit_field) {
    state.edit_field = undefined
    state.severity = computeIntakeSeverity(state)
    state.step = "awaiting_confirm"
  } else if (state.step === "awaiting_confirm") {
    state.severity = computeIntakeSeverity(state)
  }

  state = await persistEarlyTicket(supabase, ctx, state)
  console.info("[sms-intake] advanced", {
    conversationId: ctx.conversationId,
    step: state.step,
    issue_type: state.issue_type,
    urgency: state.urgency,
    severity: state.severity,
    draftTicketId: state.draft_ticket_id ?? null,
  })

  return finishIntakeQuestion(
    supabase,
    ctx,
    state,
    questionForStep(state, state.step as IntakeStep),
    {
      issue_type: state.issue_type,
      recommended_urgency: state.recommended_urgency,
      severity: state.severity,
      draft_ticket_id: state.draft_ticket_id,
    },
  )
}
