/**
 * Lifecycle workflow progress — auto-forward after start, outreach, complete.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { executeMoveOutOutreach } from "./moveOutProgress.ts"
import { executeInspectionOutreach } from "./inspectionProgress.ts"
import {
  readLifecycleStepState,
  type LifecycleStep,
  type LifecycleStepState,
} from "./lifecyclePolicy.ts"
import { executeMoveInOutreach } from "./moveInProgress.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  getWorkflowRunById,
  logPipelineStageEvent,
  logWorkflowEvent,
  updateWorkflowRun,
  type WorkflowRunRow,
} from "./workflowRuns.ts"

function mergeStepState(
  run: WorkflowRunRow,
  patch: LifecycleStepState,
): LifecycleStepState {
  return {
    ...readLifecycleStepState(run),
    ...patch,
    last_activity_at: patch.last_activity_at ?? new Date().toISOString(),
  }
}

async function advanceRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    step: LifecycleStep
    stage?: "classify" | "route" | "act" | "log"
    eventStep: string
    message: string
    graphEventType?: string
    landlordId: string
    patch?: LifecycleStepState
    status?: "active" | "completed"
  },
): Promise<void> {
  const now = new Date().toISOString()
  await logPipelineStageEvent(supabase, {
    runId: params.run.id,
    stage: params.stage ?? "act",
    step: params.eventStep,
    message: params.message,
    metadata: { step: params.step },
  })

  await updateWorkflowRun(supabase, params.run.id, {
    status: params.status ?? "active",
    currentStep: params.step,
    completedAt: params.status === "completed" ? now : null,
    metadata: {
      step_state: mergeStepState(params.run, {
        step: params.step,
        ...(params.patch ?? {}),
      }),
    },
  })

  if (params.graphEventType) {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: params.graphEventType,
      source: "automation",
      actor_type: "system",
      resident_id: params.run.resident_id,
      unit_id: params.run.unit_id,
      property_id: params.run.property_id,
      workflow_run_id: params.run.id,
      workflow_template_id: params.run.template_id,
      metadata: { message: params.message, step: params.step },
    })
  }
}

/**
 * After a lifecycle run is created, classify + send outreach + advance step.
 * Prefer template initial_act via the runner; kept for callers that invoke directly.
 */
export async function executeLifecycleInitialAct(
  supabase: SupabaseClient,
  params: { landlordId: string; runId: string },
): Promise<{ ok: boolean; step: string; outreachSent: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.status !== "active") {
    return { ok: false, step: "missing", outreachSent: false }
  }

  const templateId = run.template_id
  const state = readLifecycleStepState(run)

  // Idempotent: skip if the run already left the start step.
  if (templateId === "move_in") {
    const step = state.step ?? "initiated"
    if (step !== "initiated" && step !== "occupancy_registered") {
      return { ok: true, step, outreachSent: false }
    }
  } else if (templateId === "move_out") {
    const step = state.step ?? "initiated"
    if (step !== "initiated" && step !== "notice_sent") {
      return { ok: true, step, outreachSent: false }
    }
  } else if (templateId === "inspection") {
    const step = state.step ?? "scheduled"
    if (
      step !== "initiated" &&
      step !== "scheduled" &&
      step !== "notice_sent"
    ) {
      return { ok: true, step, outreachSent: false }
    }
  }

  if (templateId === "move_in") {
    return executeMoveInOutreach(supabase, params)
  }

  if (templateId === "move_out") {
    return executeMoveOutOutreach(supabase, params)
  }

  if (templateId === "inspection") {
    return executeInspectionOutreach(supabase, params)
  }

  return { ok: false, step: run.current_step ?? "unknown", outreachSent: false }
}

/** Mark lifecycle workflow complete (engine-owned completion). */
export async function completeLifecycleWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    message?: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  const prefix = run.template_id
  await advanceRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "completed",
    status: "completed",
    eventStep: "completed",
    message: params.message ?? "Lifecycle workflow completed.",
    graphEventType: `${prefix}.${LIFECYCLE_GRAPH_EVENTS.completed}`,
  })
}

/**
 * Advance move-out to inspection_scheduled and spawn a child inspection run.
 */
export async function scheduleMoveOutInspection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    moveOutRunId: string
    scheduledAt?: string | null
  },
): Promise<{ inspectionRunId: string | null }> {
  const { executeMoveOutScheduleInspection } = await import("./moveOutProgress.ts")
  return executeMoveOutScheduleInspection(supabase, {
    landlordId: params.landlordId,
    runId: params.moveOutRunId,
    scheduledAt: params.scheduledAt,
  })
}

/**
 * Spawn a move-in inspection for an active move-in run (auto-forward).
 */
export async function scheduleMoveInInspection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    moveInRunId: string
    scheduledAt?: string | null
  },
): Promise<{ inspectionRunId: string | null }> {
  const run = await getWorkflowRunById(supabase, params.moveInRunId)
  if (!run || run.template_id !== "move_in" || !run.unit_id) {
    return { inspectionRunId: null }
  }

  const { startInspectionWorkflow } = await import("./startWorkflow.ts")
  const scheduledAt = params.scheduledAt ?? new Date().toISOString()

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "act",
    step: "schedule_move_in_inspection",
    message: "Move-in inspection scheduled automatically.",
  })

  const started = await startInspectionWorkflow(supabase, {
    landlordId: params.landlordId,
    unitId: run.unit_id,
    residentId: run.resident_id,
    propertyId: run.property_id,
    unitLabel: typeof run.metadata?.unit_label === "string"
      ? run.metadata.unit_label
      : null,
    building: typeof run.metadata?.building === "string"
      ? run.metadata.building
      : null,
    scheduledAt,
    inspectionType: "move_in",
    triggerType: "automation",
    parentWorkflowRunId: params.moveInRunId,
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: `move_in.${LIFECYCLE_GRAPH_EVENTS.inspectionScheduled}`,
    source: "automation",
    actor_type: "system",
    resident_id: run.resident_id,
    unit_id: run.unit_id,
    property_id: run.property_id,
    workflow_run_id: run.id,
    workflow_template_id: "move_in",
    metadata: {
      message: "Move-in inspection scheduled",
      inspection_run_id: started.workflow_run_id,
    },
  })

  return { inspectionRunId: started.workflow_run_id }
}
