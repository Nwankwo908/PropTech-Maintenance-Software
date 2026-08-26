/**
 * Move-in workflow progress — occupancy, checklist outreach, completion.
 * Called from the move_in engine template.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { activateUnit, type ActivateUnitResult } from "../unitVacancy.ts"
import {
  buildMoveInChecklistSms,
  checklistToMetadata,
  initMoveInChecklist,
  markMoveInChecklistComplete,
  parseMoveInResidentReply,
  readMoveInChecklist,
  type MoveInChecklistState,
} from "./moveInChecklist.ts"
import { readLifecycleStepState, type LifecycleStep } from "./lifecyclePolicy.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  logWorkflowEvent,
  updateWorkflowRun,
  type WorkflowRunRow,
} from "./workflowRuns.ts"

type ResidentContact = {
  id: string
  full_name: string | null
  phone: string | null
  unit: string | null
}

export type MoveInRegisterOccupancyInput = {
  tenantName?: string | null
  tenantPhone?: string | null
  tenantEmail?: string | null
  moveInDate?: string | null
  residentId?: string | null
}

function firstName(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim() || ""
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] || "there"
}

async function loadResident(
  supabase: SupabaseClient,
  residentId: string | null | undefined,
): Promise<ResidentContact | null> {
  if (!residentId) return null
  const { data } = await supabase
    .from("users")
    .select("id, full_name, phone, unit")
    .eq("id", residentId)
    .maybeSingle()
  return (data as ResidentContact | null) ?? null
}

async function sendMoveInSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    body: string
    runId: string
    source: string
  },
): Promise<{ ok: boolean; conversationId: string | null }> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line) return { ok: false, conversationId: null }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "resident",
    residentId: params.residentId,
  })
  if (!identity) return { ok: false, conversationId: null }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: line.id,
    externalPhone: params.phone,
    identity,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.runId,
    templateId: "move_in",
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: line.phone,
    toNumber: params.phone,
    body: params.body,
    provider: line.provider,
    source: params.source,
  })

  return { ok: sent.ok, conversationId }
}

async function persistMoveInRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    landlordId: string
    step: LifecycleStep
    eventStep: string
    message: string
    eventType?: string
    status?: "active" | "completed"
    checklist?: MoveInChecklistState
    patch?: Record<string, unknown>
    extraMetadata?: Record<string, unknown>
  },
): Promise<WorkflowRunRow | null> {
  const now = new Date().toISOString()
  const prevState = readLifecycleStepState(params.run)

  await logPipelineStageEvent(supabase, {
    runId: params.run.id,
    stage: "act",
    step: params.eventStep,
    message: params.message,
    metadata: { step: params.step },
  })

  const metadata: Record<string, unknown> = {
    ...(params.run.metadata ?? {}),
    ...(params.extraMetadata ?? {}),
    step_state: {
      ...prevState,
      step: params.step,
      ...(params.patch ?? {}),
      last_activity_at: now,
    },
  }
  if (params.checklist) {
    metadata.checklist = checklistToMetadata(params.checklist)
  }

  await updateWorkflowRun(supabase, params.run.id, {
    status: params.status ?? "active",
    currentStep: params.step,
    completedAt: params.status === "completed" ? now : null,
    metadata,
  })

  if (params.eventType) {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: params.eventType,
      source: "automation",
      actorType: "system",
      residentId: params.run.resident_id,
      unitId: params.run.unit_id,
      propertyId: params.run.property_id,
      workflowRunId: params.run.id,
      workflowTemplateId: "move_in",
      metadata: { message: params.message, step: params.step },
    })
  }

  return await getWorkflowRunById(supabase, params.run.id)
}

/** Activate unit, register occupancy, and link the workflow run. */
export async function executeMoveInRegisterOccupancy(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    register: MoveInRegisterOccupancyInput
  },
): Promise<{ ok: boolean; activation?: ActivateUnitResult; error?: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_in" || !run.unit_id) {
    return { ok: false, error: "Move-in workflow run not found." }
  }

  const state = readLifecycleStepState(run)
  if (state.step !== "initiated" && state.step !== "occupancy_registered") {
    return { ok: true, activation: undefined }
  }

  try {
    const activation = await activateUnit(supabase, {
      landlordId: params.landlordId,
      unitId: run.unit_id,
      skipTenantRegistration: false,
      tenantName: params.register.tenantName,
      tenantPhone: params.register.tenantPhone,
      tenantEmail: params.register.tenantEmail,
      moveInDate: params.register.moveInDate,
      residentId: params.register.residentId ?? run.resident_id,
    })

    const checklist = readMoveInChecklist(run.metadata ?? {})
    if (checklist.requiredCount === 0) {
      // Ensure checklist exists even before outreach.
    }
    const initChecklist = checklist.requiredCount > 0 ? checklist : initMoveInChecklist()

    await supabase
      .from("workflow_runs")
      .update({
        resident_id: activation.residentId,
        metadata: {
          ...(run.metadata ?? {}),
          occupancy_id: activation.occupancyId,
          resident_id: activation.residentId,
          move_in_date: params.register.moveInDate ?? run.metadata?.move_in_date,
          checklist: checklistToMetadata(initChecklist),
          step_state: {
            ...state,
            step: "occupancy_registered",
            last_activity_at: new Date().toISOString(),
          },
        },
        current_step: "occupancy_registered",
        current_stage: "occupancy_registered",
      })
      .eq("id", params.runId)

    await logPipelineStageEvent(supabase, {
      runId: params.runId,
      stage: "act",
      step: "register_occupancy",
      message: "Unit activated and resident occupancy registered.",
      metadata: {
        unit_id: activation.unitId,
        resident_id: activation.residentId,
        occupancy_id: activation.occupancyId,
      },
    })

    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.unitActivated}`,
      source: "automation",
      actorType: "system",
      residentId: activation.residentId,
      unitId: activation.unitId,
      workflowRunId: params.runId,
      workflowTemplateId: "move_in",
      metadata: {
        message: "Unit activated and resident marked as occupying the unit.",
        occupancy_id: activation.occupancyId,
        move_in_date: params.register.moveInDate ?? null,
      },
    })

    return { ok: true, activation }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[moveInProgress] register occupancy", message)
    return { ok: false, error: message }
  }
}

/** Send welcome + checklist SMS and track checklist tasks on the run. */
export async function executeMoveInOutreach(
  supabase: SupabaseClient,
  params: { landlordId: string; runId: string },
): Promise<{ ok: boolean; step: string; outreachSent: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_in" || run.status !== "active") {
    return { ok: false, step: "missing", outreachSent: false }
  }

  const state = readLifecycleStepState(run)
  const step = state.step ?? "initiated"
  if (step !== "initiated" && step !== "occupancy_registered" && step !== "checklist_sent") {
    return { ok: true, step, outreachSent: false }
  }

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "classify",
    step: "classify_move_in",
    message: "Classified as new move-in occupancy.",
  })

  const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
  const residentId = run.resident_id ??
    (typeof run.metadata?.resident_id === "string" ? run.metadata.resident_id : null)
  const resident = await loadResident(supabase, residentId)
  const checklist = readMoveInChecklist(run.metadata ?? {})
  const normalizedChecklist = checklist.requiredCount > 0 ? checklist : initMoveInChecklist()

  let outreachSent = false
  let conversationId: string | null = state.conversation_id ?? null
  const phone = resident?.phone?.trim()
  const unitLabel = typeof run.metadata?.unit_label === "string"
    ? run.metadata.unit_label
    : resident?.unit ?? null
  const moveInDate = state.move_in_date ??
    (typeof run.metadata?.move_in_date === "string" ? run.metadata.move_in_date : null)

  if (resident && phone) {
    const body = buildMoveInChecklistSms({
      residentName: firstName(resident.full_name),
      companyName,
      unitLabel,
      moveInDate,
    })
    const sent = await sendMoveInSms(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      phone,
      body,
      runId: run.id,
      source: "workflow_move_in_checklist",
    })
    outreachSent = sent.ok
    conversationId = sent.conversationId ?? conversationId
  }

  const next: LifecycleStep = outreachSent ? "awaiting_confirm" : "checklist_sent"
  await persistMoveInRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: next,
    eventStep: outreachSent ? "send_welcome_outreach" : "create_checklist_tasks",
    message: outreachSent
      ? "Move-in checklist sent to the resident."
      : "Move-in checklist ready (no resident phone on file).",
    eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.checklistSent}`,
    checklist: normalizedChecklist,
    patch: {
      conversation_id: conversationId,
      reminder_count: 0,
    },
  })

  if (outreachSent) {
    await logWorkflowEvent(supabase, {
      workflowRunId: run.id,
      eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.taskCreated}`,
      step: "checklist_sent",
      actorType: "system",
      message: "Move-in checklist tasks created",
      metadata: { task_count: normalizedChecklist.requiredCount },
    })
  }

  return { ok: true, step: next, outreachSent }
}

/** Process resident SMS — mark checklist complete when they reply DONE. */
export async function processMoveInResidentReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    body: string
  },
): Promise<{ step: string; completed: boolean; replyHint: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_in") {
    return {
      step: "unknown",
      completed: false,
      replyHint: "Thanks — reply here if you need help with your move-in.",
    }
  }

  const state = readLifecycleStepState(run)
  if (state.step === "completed") {
    return {
      step: "completed",
      completed: true,
      replyHint: "Your move-in is complete. Reply here anytime if you need help.",
    }
  }

  const intent = parseMoveInResidentReply(params.body)
  if (intent === "complete_all") {
    const checklist = markMoveInChecklistComplete(readMoveInChecklist(run.metadata ?? {}))
    await persistMoveInRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: "utilities_confirmed",
      eventStep: "confirm_readiness",
      message: "Resident confirmed move-in checklist items are complete.",
      eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.taskCompleted}`,
      checklist,
      patch: { move_in_classification: "checklist_complete" },
    })

    await completeMoveInWorkflow(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
    })

    return {
      step: "completed",
      completed: true,
      replyHint: "Thank you — your move-in is all set. Welcome home! Reply here anytime if you need help.",
    }
  }

  return {
    step: state.step ?? "awaiting_confirm",
    completed: false,
    replyHint: "Thanks — please finish any remaining move-in checklist items. Reply DONE when complete, or message us here if you need help.",
  }
}

/** Complete the move-in workflow run. */
export async function completeMoveInWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    message?: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_in") return

  const message = params.message ?? "Move-in workflow completed."
  await persistMoveInRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "completed",
    eventStep: "completed",
    message,
    eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.completed}`,
    status: "completed",
  })
}

/** Register occupancy then send checklist outreach in one engine pass. */
export async function executeMoveInRegisterAndOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    register?: MoveInRegisterOccupancyInput
  },
): Promise<{ ok: boolean; step: string; error?: string }> {
  if (params.register) {
    const registered = await executeMoveInRegisterOccupancy(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
      register: params.register,
    })
    const alreadyActive = registered.error?.toLowerCase().includes("already active")
    if (!registered.ok && !alreadyActive) {
      return { ok: false, step: "initiated", error: registered.error }
    }
  }

  const outreach = await executeMoveInOutreach(supabase, {
    landlordId: params.landlordId,
    runId: params.runId,
  })
  return { ok: outreach.ok, step: outreach.step, error: undefined }
}
