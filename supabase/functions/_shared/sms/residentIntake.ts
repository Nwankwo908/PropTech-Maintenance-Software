import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { WorkflowContext, WorkflowResult } from "./workflow_types.ts"
import { submitSmsMaintenanceRequest } from "./submitSmsMaintenanceRequest.ts"
import {
  buildConfirmationSummary,
  computeIntakeSeverity,
  conversationStatusForStep,
  EDIT_FIELD_OPTIONS,
  extractRoomFromText,
  inferIssueTypeFromText,
  intakeQuestionForStep,
  INTAKE_VALIDATION,
  nextCollectingStep,
  normalizeRoomOrArea,
  parseContactMethod,
  parseEditFieldChoice,
  parseIssueType,
  parseUrgency,
  recommendUrgency,
  sanitizeIntakeState,
  type IntakeStep,
  type SmsIntakeState,
  urgencyQuestion,
} from "./residentIntakeTypes.ts"

function isYesReply(body: string): boolean {
  return /^(yes|y|confirm|submit|ok)\b/i.test(body.trim())
}

function isEditReply(body: string): boolean {
  return /^(edit|change|update|modify)\b/i.test(body.trim())
}

function questionForStep(state: SmsIntakeState, step: IntakeStep): string {
  if (step === "urgency") {
    return urgencyQuestion(state)
  }
  if (step === "awaiting_edit_selection") return EDIT_FIELD_OPTIONS
  if (step === "awaiting_confirm") return buildConfirmationSummary(state)
  return intakeQuestionForStep(state, step as Exclude<IntakeStep, "awaiting_confirm" | "awaiting_edit_selection" | "submitted">)
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

function initializeIntake(body: string, mediaCount: number): SmsIntakeState {
  let initial = body.trim()
  if (mediaCount > 0) {
    initial = initial
      ? `${initial}\n(Photo attached)`
      : "Maintenance issue (photo attached)"
  }

  const inferred = inferIssueTypeFromText(initial)
  const extractedRoom = extractRoomFromText(initial)

  if (inferred) {
    if (extractedRoom) {
      return sanitizeIntakeState({
        step: "first_noticed",
        issue_type: inferred,
        initial_message: initial,
        description: initial,
        room_or_area: extractedRoom,
      })
    }
    return {
      step: "room_or_area",
      issue_type: inferred,
      initial_message: initial,
      description: initial,
    }
  }

  if (extractedRoom) {
    return sanitizeIntakeState({
      step: "issue_type",
      initial_message: initial,
      description: initial,
      room_or_area: extractedRoom,
    })
  }

  return {
    step: "issue_type",
    initial_message: initial,
    description: initial,
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
        return {
          ok: false,
          retry:
            "Sorry you're dealing with that. Which room is this happening in — kitchen, bathroom, basement, bedroom, or somewhere else?",
        }
      }
      next.room_or_area = room
      next.step = nextCollectingStep("room_or_area", next)
      break
    }
    case "first_noticed":
      next.first_noticed = answer
      next.step = nextCollectingStep("first_noticed")
      break
    case "safety_concerns":
      next.safety_concerns = /^none$/i.test(answer) ? "None reported" : answer
      next.recommended_urgency = recommendUrgency(next)
      next.step = "urgency"
      break
    case "urgency": {
      const parsed = parseUrgency(answer)
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
      next.step = "awaiting_confirm"
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
    return {
      route: "resident_maintenance_intake",
      replyHint:
        "Happy to help — I'll just need your unit number first so I can pull up the right home.",
      metadata: { blocked: "missing_resident_id" },
    }
  }

  if (
    ctx.selfHealingPhase === "resolved" &&
    ctx.resolutionSource === "self_healed_unit"
  ) {
    return {
      route: "resident_maintenance_intake",
      replyHint:
        "Great — I found your unit. When you're ready, tell me what's going on (a photo helps too).",
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
    state = initializeIntake(body, ctx.inbound.mediaUrls.length)
    state = sanitizeIntakeState(state)
    await saveIntakeState(supabase, ctx.conversationId, state)
    const replyHint = questionForStep(state, state.step as IntakeStep)
    console.info("[sms-intake] started new intake", {
      conversationId: ctx.conversationId,
      step: state.step,
      inferredIssueType: state.issue_type ?? null,
    })
    return {
      route: "resident_maintenance_intake",
      replyHint,
      metadata: { intakeStep: state.step, started: true },
    }
  }

  const step = state.step as IntakeStep

  if (step === "awaiting_confirm") {
    if (isYesReply(body)) {
      try {
        const { ticketId } = await submitSmsMaintenanceRequest(supabase, {
          landlordId: ctx.landlordId,
          conversationId: ctx.conversationId,
          residentId,
          intake: state,
        })
        const submitted: SmsIntakeState = { ...state, step: "submitted" }
        await saveIntakeState(supabase, ctx.conversationId, submitted)
        return {
          route: "resident_maintenance_intake",
          replyHint:
            `You're all set — I've submitted your request (ref ${ticketId.slice(0, 8).toUpperCase()}). We'll get a vendor on it and keep you posted.`,
          metadata: { submitted: true, ticketId, intakeStep: "submitted" },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[sms-intake] submit failed", message)
        return {
          route: "resident_maintenance_intake",
          replyHint:
            "Sorry about that — I wasn't able to submit your request just now. Give it another try in a moment, or reach out to your property manager if it keeps happening.",
          metadata: { submitError: message },
        }
      }
    }

    if (isEditReply(body)) {
      state = { ...state, step: "awaiting_edit_selection" }
      await saveIntakeState(supabase, ctx.conversationId, state)
      return {
        route: "resident_maintenance_intake",
        replyHint: EDIT_FIELD_OPTIONS,
        metadata: { intakeStep: state.step },
      }
    }

    return {
      route: "resident_maintenance_intake",
      replyHint: "Reply YES if that looks good, or tell me what you'd like to change.",
      metadata: { intakeStep: step },
    }
  }

  if (step === "awaiting_edit_selection") {
    const field = parseEditFieldChoice(body)
    if (!field) {
      return {
        route: "resident_maintenance_intake",
        replyHint: EDIT_FIELD_OPTIONS,
        metadata: { intakeStep: step, invalidEditChoice: true },
      }
    }

    if (field === "description") {
      state = { ...state, step: "awaiting_edit_selection", edit_field: "description" }
      await saveIntakeState(supabase, ctx.conversationId, state)
      return {
        route: "resident_maintenance_intake",
        replyHint: "Sure — send me the updated description.",
        metadata: { intakeStep: step, editing: "description" },
      }
    }

    state = { ...state, step: field, edit_field: field }
    if (field === "urgency") {
      state.recommended_urgency = recommendUrgency(state)
    }
    await saveIntakeState(supabase, ctx.conversationId, state)
    return {
      route: "resident_maintenance_intake",
      replyHint: questionForStep(state, field),
      metadata: { intakeStep: field, editing: field },
    }
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
    return {
      route: "resident_maintenance_intake",
      replyHint: buildConfirmationSummary(state),
      metadata: { intakeStep: "awaiting_confirm", edited: "description" },
    }
  }

  const result = applyStepAnswer(state, step, body)
  if (!result.ok) {
    return {
      route: "resident_maintenance_intake",
      replyHint: result.retry,
      metadata: { intakeStep: step, invalidAnswer: true },
    }
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

  await saveIntakeState(supabase, ctx.conversationId, state)

  const replyHint = questionForStep(state, state.step as IntakeStep)
  console.info("[sms-intake] advanced", {
    conversationId: ctx.conversationId,
    step: state.step,
    issue_type: state.issue_type,
    urgency: state.urgency,
    severity: state.severity,
  })

  return {
    route: "resident_maintenance_intake",
    replyHint,
    metadata: {
      intakeStep: state.step,
      issue_type: state.issue_type,
      recommended_urgency: state.recommended_urgency,
      severity: state.severity,
    },
  }
}
