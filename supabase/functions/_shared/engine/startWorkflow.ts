/**
 * Unified workflow start — create or reuse a run, then delegate first action to the engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  lifecycleStartEngineTrigger,
  runWorkflowEngineForExistingRun,
} from "./runner.ts"
import type { InspectionEngineInput } from "./inspectionEngine.ts"
import type { MoveInEngineInput } from "./moveInEngine.ts"
import type { MoveOutEngineInput } from "./moveOutEngine.ts"
import {
  createWorkflowRun,
  getWorkflowRunById,
} from "./workflowRuns.ts"
import type {
  WorkflowEngineResult,
  WorkflowEntityType,
  WorkflowExecutionContext,
  WorkflowRunRow,
  WorkflowTemplateId,
  WorkflowTriggerType,
} from "./types.ts"

export type LifecycleWorkflowStartResult = {
  workflow_run_id: string
  reused?: boolean
  engineResult?: WorkflowEngineResult | null
}

export type StartWorkflowInitialAction = {
  moveIn?: MoveInEngineInput
  moveOut?: MoveOutEngineInput
  inspection?: InspectionEngineInput
}

type LifecycleClassificationSource =
  | "unit_activation"
  | "dashboard"
  | "cron"
  | "resident_reply"
  | "workflow_spawn"

function buildClassificationMetadata(
  classification: string,
  source: LifecycleClassificationSource,
): Record<string, unknown> {
  return {
    classified_at: new Date().toISOString(),
    classification_source: source,
  }
}

async function resolvePropertyIdForUnit(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId?: string | null
    building?: string | null
  },
): Promise<string | null> {
  const { resolvePropertyId } = await import("../properties/ensureProperty.ts")
  return resolvePropertyId(supabase, {
    landlordId: params.landlordId,
    unitId: params.unitId,
    building: params.building,
  })
}

async function cancelOtherActiveMoveOutRuns(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId: string
    keepRunId: string
  },
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from("workflow_runs")
    .update({
      status: "cancelled",
      current_step: "cancelled",
      completed_at: now,
    })
    .eq("landlord_id", params.landlordId)
    .eq("template_id", "move_out")
    .eq("status", "active")
    .eq("unit_id", params.unitId)
    .neq("id", params.keepRunId)

  if (error) {
    console.error("[move_out] cancel sibling active runs", error.message)
  }
}

async function findActiveLifecycleRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    templateId: "move_in" | "move_out" | "inspection"
    unitId: string
    residentId?: string | null
  },
): Promise<string | null> {
  let query = supabase
    .from("workflow_runs")
    .select("id")
    .eq("landlord_id", params.landlordId)
    .eq("template_id", params.templateId)
    .eq("status", "active")
    .eq("unit_id", params.unitId)
    .order("started_at", { ascending: false })
    .limit(1)

  if (params.residentId) {
    query = query.eq("resident_id", params.residentId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error(`[${params.templateId}] find active run`, error.message)
    return null
  }

  return (data?.id as string | undefined) ?? null
}

async function invokeLifecycleEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    triggerType: WorkflowTriggerType
    initialAction?: StartWorkflowInitialAction
  },
): Promise<WorkflowEngineResult | null> {
  const extras: Partial<WorkflowExecutionContext> = {}
  if (params.initialAction?.moveIn) extras.moveIn = params.initialAction.moveIn
  if (params.initialAction?.moveOut) extras.moveOut = params.initialAction.moveOut
  if (params.initialAction?.inspection) {
    extras.inspection = params.initialAction.inspection
  }

  try {
    return await runWorkflowEngineForExistingRun(supabase, {
      landlordId: params.landlordId,
      run: params.run,
      trigger: lifecycleStartEngineTrigger(params.triggerType),
      extras,
    })
  } catch (err) {
    console.error(
      `[${params.run.template_id}] engine start failed`,
      err,
    )
    return null
  }
}

export type StartMoveInWorkflowParams = {
  landlordId: string
  unitId: string
  residentId?: string | null
  occupancyId?: string | null
  propertyId?: string | null
  unitLabel?: string | null
  building?: string | null
  moveInDate?: string | null
  skipTenantRegistration?: boolean
  triggerType?: WorkflowTriggerType
  classification?: "new_occupancy" | "skip_registration"
  reuseActiveRun?: boolean
  initialAction?: StartWorkflowInitialAction
}

export type StartMoveOutWorkflowParams = {
  landlordId: string
  unitId: string
  residentId?: string | null
  occupancyId?: string | null
  propertyId?: string | null
  unitLabel?: string | null
  building?: string | null
  moveOutDate?: string | null
  triggerType?: WorkflowTriggerType
  classification?: "voluntary_move_out" | "lease_end" | "eviction"
  reuseActiveRun?: boolean
  runId?: string | null
  sourceWorkflowRunId?: string | null
  sourceWorkflowTemplateId?: string | null
  initialAction?: StartWorkflowInitialAction
}

export type InspectionType =
  | "move_in"
  | "move_out"
  | "periodic"
  | "annual"
  | "common_area"

export type StartInspectionWorkflowParams = {
  landlordId: string
  unitId: string
  inspectionId?: string | null
  residentId?: string | null
  occupancyId?: string | null
  propertyId?: string | null
  unitLabel?: string | null
  building?: string | null
  scheduledAt?: string | null
  inspectionType?: InspectionType
  triggerType?: WorkflowTriggerType
  classification?: InspectionType
  reuseActiveRun?: boolean
  parentWorkflowRunId?: string | null
  initialAction?: StartWorkflowInitialAction
}

export type StartWorkflowParams =
  | ({ templateId: "move_in" } & StartMoveInWorkflowParams)
  | ({ templateId: "move_out" } & StartMoveOutWorkflowParams)
  | ({ templateId: "inspection" } & StartInspectionWorkflowParams)

/**
 * Start a lifecycle workflow: create or reuse a run, then run the engine for the first action.
 */
export async function startWorkflow(
  supabase: SupabaseClient,
  params: StartWorkflowParams,
): Promise<LifecycleWorkflowStartResult> {
  switch (params.templateId) {
    case "move_in":
      return startMoveInWorkflow(supabase, params)
    case "move_out":
      return startMoveOutWorkflow(supabase, params)
    case "inspection":
      return startInspectionWorkflow(supabase, params)
  }
}

/** Start move_in — create/reuse run, engine owns outreach and registration. */
export async function startMoveInWorkflow(
  supabase: SupabaseClient,
  params: StartMoveInWorkflowParams,
): Promise<LifecycleWorkflowStartResult> {
  const triggerType = params.triggerType ?? "dashboard"
  const classification = params.classification ??
    (params.skipTenantRegistration ? "skip_registration" : "new_occupancy")
  const classificationMeta = buildClassificationMetadata(
    classification,
    "unit_activation",
  )

  if (params.reuseActiveRun !== false) {
    const existingId = await findActiveLifecycleRun(supabase, {
      landlordId: params.landlordId,
      templateId: "move_in",
      unitId: params.unitId,
      residentId: params.residentId,
    })
    if (existingId) {
      const run = await getWorkflowRunById(supabase, existingId)
      const engineResult = run && params.initialAction
        ? await invokeLifecycleEngine(supabase, {
          landlordId: params.landlordId,
          run,
          triggerType,
          initialAction: params.initialAction,
        })
        : null
      return { workflow_run_id: existingId, reused: true, engineResult }
    }
  }

  const propertyId = params.propertyId ??
    await resolvePropertyIdForUnit(supabase, {
      landlordId: params.landlordId,
      unitId: params.unitId,
      building: params.building,
    })

  const entityType: WorkflowEntityType = params.occupancyId
    ? "occupancy"
    : "unit"
  const entityId = params.occupancyId ?? params.unitId

  const run = await createWorkflowRun(supabase, {
    templateId: "move_in",
    landlordId: params.landlordId,
    triggerType,
    currentStep: "initiated",
    entityType,
    entityId,
    propertyId,
    residentId: params.residentId ?? null,
    unitId: params.unitId,
    metadata: {
      unit_label: params.unitLabel?.trim() || undefined,
      building: params.building?.trim() || undefined,
      move_in_date: params.moveInDate?.trim() || undefined,
      occupancy_id: params.occupancyId ?? undefined,
      skip_tenant_registration: params.skipTenantRegistration === true,
      move_in_classification: classification,
      ...classificationMeta,
      step_state: {
        step: "initiated",
        move_in_classification: classification,
        move_in_date: params.moveInDate ?? null,
        occupancy_id: params.occupancyId ?? null,
      },
    },
    logTriggerEvent: true,
  })

  if (!run) {
    throw new Error("Failed to create workflow_run for move_in")
  }

  const engineResult = await invokeLifecycleEngine(supabase, {
    landlordId: params.landlordId,
    run,
    triggerType,
    initialAction: params.initialAction,
  })

  return { workflow_run_id: run.id, engineResult }
}

/** Start move_out — create/reuse run, engine owns outreach and vacancy steps. */
export async function startMoveOutWorkflow(
  supabase: SupabaseClient,
  params: StartMoveOutWorkflowParams,
): Promise<LifecycleWorkflowStartResult> {
  const triggerType = params.triggerType ?? "dashboard"
  const classification = params.classification ?? "voluntary_move_out"
  const classificationMeta = buildClassificationMetadata(classification, "dashboard")

  if (!params.runId && params.reuseActiveRun !== false) {
    const existingId = await findActiveLifecycleRun(supabase, {
      landlordId: params.landlordId,
      templateId: "move_out",
      unitId: params.unitId,
      residentId: params.residentId,
    })
    if (existingId) {
      const run = await getWorkflowRunById(supabase, existingId)
      const engineResult = run && params.initialAction
        ? await invokeLifecycleEngine(supabase, {
          landlordId: params.landlordId,
          run,
          triggerType,
          initialAction: params.initialAction,
        })
        : null
      return { workflow_run_id: existingId, reused: true, engineResult }
    }
  }

  const propertyId = params.propertyId ??
    await resolvePropertyIdForUnit(supabase, {
      landlordId: params.landlordId,
      unitId: params.unitId,
      building: params.building,
    })

  const entityType: WorkflowEntityType = params.occupancyId
    ? "occupancy"
    : "unit"
  const entityId = params.occupancyId ?? params.unitId

  const run = await createWorkflowRun(supabase, {
    id: params.runId?.trim() || undefined,
    templateId: "move_out",
    landlordId: params.landlordId,
    triggerType,
    currentStep: "initiated",
    entityType,
    entityId,
    propertyId,
    residentId: params.residentId ?? null,
    unitId: params.unitId,
    metadata: {
      unit_label: params.unitLabel?.trim() || undefined,
      building: params.building?.trim() || undefined,
      move_out_date: params.moveOutDate?.trim() || undefined,
      occupancy_id: params.occupancyId ?? undefined,
      move_out_classification: classification,
      source_workflow: params.sourceWorkflowTemplateId ?? undefined,
      source_workflow_run_id: params.sourceWorkflowRunId ?? undefined,
      source_workflow_template_id: params.sourceWorkflowTemplateId ?? undefined,
      ...classificationMeta,
      step_state: {
        step: "initiated",
        move_out_classification: classification,
        move_out_date: params.moveOutDate ?? null,
        occupancy_id: params.occupancyId ?? null,
      },
    },
    logTriggerEvent: true,
  })

  if (!run) {
    throw new Error("Failed to create workflow_run for move_out")
  }

  if (params.runId?.trim()) {
    await cancelOtherActiveMoveOutRuns(supabase, {
      landlordId: params.landlordId,
      unitId: params.unitId,
      keepRunId: run.id,
    })
  }

  const engineResult = await invokeLifecycleEngine(supabase, {
    landlordId: params.landlordId,
    run,
    triggerType,
    initialAction: params.initialAction,
  })

  return { workflow_run_id: run.id, engineResult }
}

/** Start inspection — create/reuse run, engine owns notice and record creation. */
export async function startInspectionWorkflow(
  supabase: SupabaseClient,
  params: StartInspectionWorkflowParams,
): Promise<LifecycleWorkflowStartResult> {
  const triggerType = params.triggerType ?? "dashboard"
  const inspectionType = params.inspectionType ?? params.classification ?? "periodic"
  const classificationMeta = buildClassificationMetadata(
    inspectionType,
    params.triggerType === "cron" ? "cron" : "dashboard",
  )

  if (params.reuseActiveRun !== false && params.inspectionId) {
    const { data } = await supabase
      .from("workflow_runs")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("template_id", "inspection")
      .eq("status", "active")
      .eq("entity_type", "inspection")
      .eq("entity_id", params.inspectionId)
      .maybeSingle()

    if (data?.id) {
      const runId = String(data.id)
      const run = await getWorkflowRunById(supabase, runId)
      const engineResult = run && params.initialAction
        ? await invokeLifecycleEngine(supabase, {
          landlordId: params.landlordId,
          run,
          triggerType,
          initialAction: params.initialAction,
        })
        : null
      return { workflow_run_id: runId, reused: true, engineResult }
    }
  }

  if (params.reuseActiveRun !== false && !params.inspectionId) {
    const existingId = await findActiveLifecycleRun(supabase, {
      landlordId: params.landlordId,
      templateId: "inspection",
      unitId: params.unitId,
      residentId: params.residentId,
    })
    if (existingId) {
      const run = await getWorkflowRunById(supabase, existingId)
      const engineResult = run && params.initialAction
        ? await invokeLifecycleEngine(supabase, {
          landlordId: params.landlordId,
          run,
          triggerType,
          initialAction: params.initialAction,
        })
        : null
      return { workflow_run_id: existingId, reused: true, engineResult }
    }
  }

  const propertyId = params.propertyId ??
    await resolvePropertyIdForUnit(supabase, {
      landlordId: params.landlordId,
      unitId: params.unitId,
      building: params.building,
    })

  const entityType: WorkflowEntityType = params.inspectionId
    ? "inspection"
    : "unit"
  const entityId = params.inspectionId ?? params.unitId

  const run = await createWorkflowRun(supabase, {
    templateId: "inspection",
    landlordId: params.landlordId,
    triggerType,
    currentStep: "scheduled",
    entityType,
    entityId,
    propertyId,
    residentId: params.residentId ?? null,
    unitId: params.unitId,
    metadata: {
      unit_label: params.unitLabel?.trim() || undefined,
      building: params.building?.trim() || undefined,
      inspection_id: params.inspectionId ?? undefined,
      inspection_type: inspectionType,
      scheduled_at: params.scheduledAt ?? undefined,
      occupancy_id: params.occupancyId ?? undefined,
      inspection_classification: inspectionType,
      parent_workflow_run_id: params.parentWorkflowRunId?.trim() || undefined,
      ...classificationMeta,
      step_state: {
        step: "scheduled",
        inspection_classification: inspectionType,
        inspection_type: inspectionType,
        scheduled_at: params.scheduledAt ?? null,
        inspection_id: params.inspectionId ?? null,
      },
    },
    logTriggerEvent: true,
  })

  if (!run) {
    throw new Error("Failed to create workflow_run for inspection")
  }

  const engineResult = await invokeLifecycleEngine(supabase, {
    landlordId: params.landlordId,
    run,
    triggerType,
    initialAction: params.initialAction,
  })

  return { workflow_run_id: run.id, engineResult }
}

export type LifecycleTemplateId = Extract<
  WorkflowTemplateId,
  "move_in" | "move_out" | "inspection"
>
