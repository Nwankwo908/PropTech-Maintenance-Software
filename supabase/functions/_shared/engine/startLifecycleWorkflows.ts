import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logPropertyOperationsGraph } from "../graph/logPropertyOperationsGraph.ts"
import {
  logOperationsGraphEvent,
  resolveOperationsGraphScope,
  type OperationsGraphScope,
} from "../graph/operationsGraph.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  createWorkflowRun,
  logWorkflowEvent,
} from "./workflowRuns.ts"
import type { WorkflowEntityType, WorkflowTriggerType } from "./types.ts"

export type LifecycleWorkflowStartResult = {
  workflow_run_id: string
}

type LifecycleClassificationSource =
  | "unit_activation"
  | "dashboard"
  | "cron"
  | "resident_reply"
  | "workflow_spawn"

type LifecycleGraphLinks = {
  landlordId: string
  propertyId: string | null
  unitId: string | null
  residentId: string | null
  workflowRunId: string
  workflowTemplateId: string
}

function triggerToGraphSource(
  trigger: WorkflowTriggerType,
): "sms" | "dashboard" | "vendor_portal" | "edge_function" | "automation" {
  switch (trigger) {
    case "sms_inbound":
      return "sms"
    case "dashboard":
      return "dashboard"
    case "vendor_portal":
      return "vendor_portal"
    case "webhook":
      return "edge_function"
    default:
      return "automation"
  }
}

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
  let building = params.building?.trim() || null

  if (!building && params.unitId) {
    const { data: unit } = await supabase
      .from("units")
      .select("building")
      .eq("id", params.unitId)
      .maybeSingle()

    if (unit?.building != null) {
      building = String(unit.building)
    }
  }

  const { data, error } = await supabase.rpc("derive_property_id", {
    p_landlord_id: params.landlordId,
    p_building: building ?? "",
  })

  if (error || data == null) return null
  return String(data)
}

async function writeLifecycleGraphStartedEvent(
  supabase: SupabaseClient,
  params: {
    links: LifecycleGraphLinks
    eventType: string
    eventSource: ReturnType<typeof triggerToGraphSource>
    message: string
    payload: Record<string, unknown>
    legacyScope: OperationsGraphScope
  },
): Promise<void> {
  const eventPayload = {
    message: params.message,
    workflow_template_id: params.links.workflowTemplateId,
    ...params.payload,
  }

  await logPropertyOperationsGraph(supabase, {
    landlord_id: params.links.landlordId,
    property_id: params.links.propertyId,
    unit_id: params.links.unitId,
    resident_id: params.links.residentId,
    workflow_run_id: params.links.workflowRunId,
    event_type: params.eventType,
    event_source: params.eventSource,
    event_payload: eventPayload,
  })

  await logOperationsGraphEvent(supabase, {
    scope: params.legacyScope,
    eventType: params.eventType,
    source: params.eventSource,
    actorType: "system",
    metadata: eventPayload,
  })
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
}

/** Start a move_in workflow run and log move_in.started on the property operations graph. */
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
      return { workflow_run_id: existingId }
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

  const graphScope: OperationsGraphScope = {
    landlordId: params.landlordId,
    workflowRunId: run.id,
    workflowTemplateId: "move_in",
    propertyId,
    unitId: params.unitId,
    residentId: params.residentId ?? null,
    occupancyId: params.occupancyId ?? null,
    unitLabel: params.unitLabel ?? null,
    building: params.building ?? null,
  }

  const resolved = await resolveOperationsGraphScope(supabase, graphScope)
  const eventType = `move_in.${LIFECYCLE_GRAPH_EVENTS.started}`

  await writeLifecycleGraphStartedEvent(supabase, {
    links: {
      landlordId: params.landlordId,
      propertyId: resolved.propertyId,
      unitId: resolved.unitId,
      residentId: resolved.residentId,
      workflowRunId: run.id,
      workflowTemplateId: "move_in",
    },
    eventType,
    eventSource: triggerToGraphSource(triggerType),
    message: params.skipTenantRegistration
      ? "Move-in workflow started (tenant registration skipped)"
      : "Move-in workflow started for new occupancy",
    payload: {
      move_in_classification: classification,
      move_in_date: params.moveInDate ?? null,
      occupancy_id: params.occupancyId ?? null,
      unit_label: params.unitLabel ?? null,
      building: params.building ?? null,
      skip_tenant_registration: params.skipTenantRegistration === true,
    },
    legacyScope: graphScope,
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: run.id,
    eventType,
    step: "initiated",
    actorType: "system",
    message: "Move-in workflow started",
    metadata: {
      move_in_classification: classification,
      unit_id: params.unitId,
      resident_id: params.residentId ?? null,
    },
  })

  return { workflow_run_id: run.id }
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
}

/** Start a move_out workflow run and log move_out.started on the property operations graph. */
export async function startMoveOutWorkflow(
  supabase: SupabaseClient,
  params: StartMoveOutWorkflowParams,
): Promise<LifecycleWorkflowStartResult> {
  const triggerType = params.triggerType ?? "dashboard"
  const classification = params.classification ?? "voluntary_move_out"
  const classificationMeta = buildClassificationMetadata(classification, "dashboard")

  if (params.reuseActiveRun !== false) {
    const existingId = await findActiveLifecycleRun(supabase, {
      landlordId: params.landlordId,
      templateId: "move_out",
      unitId: params.unitId,
      residentId: params.residentId,
    })
    if (existingId) {
      return { workflow_run_id: existingId }
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

  const graphScope: OperationsGraphScope = {
    landlordId: params.landlordId,
    workflowRunId: run.id,
    workflowTemplateId: "move_out",
    propertyId,
    unitId: params.unitId,
    residentId: params.residentId ?? null,
    occupancyId: params.occupancyId ?? null,
    unitLabel: params.unitLabel ?? null,
    building: params.building ?? null,
  }

  const resolved = await resolveOperationsGraphScope(supabase, graphScope)
  const eventType = `move_out.${LIFECYCLE_GRAPH_EVENTS.started}`

  await writeLifecycleGraphStartedEvent(supabase, {
    links: {
      landlordId: params.landlordId,
      propertyId: resolved.propertyId,
      unitId: resolved.unitId,
      residentId: resolved.residentId,
      workflowRunId: run.id,
      workflowTemplateId: "move_out",
    },
    eventType,
    eventSource: triggerToGraphSource(triggerType),
    message: "Move-out workflow started",
    payload: {
      move_out_classification: classification,
      move_out_date: params.moveOutDate ?? null,
      occupancy_id: params.occupancyId ?? null,
      unit_label: params.unitLabel ?? null,
      building: params.building ?? null,
    },
    legacyScope: graphScope,
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: run.id,
    eventType,
    step: "initiated",
    actorType: "system",
    message: "Move-out workflow started",
    metadata: {
      move_out_classification: classification,
      unit_id: params.unitId,
      resident_id: params.residentId ?? null,
    },
  })

  return { workflow_run_id: run.id }
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
}

/** Start an inspection workflow run and log inspection.started on the property operations graph. */
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
      return { workflow_run_id: String(data.id) }
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
      return { workflow_run_id: existingId }
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

  const graphScope: OperationsGraphScope = {
    landlordId: params.landlordId,
    workflowRunId: run.id,
    workflowTemplateId: "inspection",
    propertyId,
    unitId: params.unitId,
    residentId: params.residentId ?? null,
    occupancyId: params.occupancyId ?? null,
    inspectionId: params.inspectionId ?? null,
    unitLabel: params.unitLabel ?? null,
    building: params.building ?? null,
  }

  const resolved = await resolveOperationsGraphScope(supabase, graphScope)
  const eventType = `inspection.${LIFECYCLE_GRAPH_EVENTS.started}`

  await writeLifecycleGraphStartedEvent(supabase, {
    links: {
      landlordId: params.landlordId,
      propertyId: resolved.propertyId,
      unitId: resolved.unitId,
      residentId: resolved.residentId,
      workflowRunId: run.id,
      workflowTemplateId: "inspection",
    },
    eventType,
    eventSource: triggerToGraphSource(triggerType),
    message: `Inspection workflow started (${inspectionType})`,
    payload: {
      inspection_classification: inspectionType,
      inspection_type: inspectionType,
      inspection_id: params.inspectionId ?? null,
      scheduled_at: params.scheduledAt ?? null,
      occupancy_id: params.occupancyId ?? null,
      unit_label: params.unitLabel ?? null,
      building: params.building ?? null,
    },
    legacyScope: graphScope,
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: run.id,
    eventType,
    step: "scheduled",
    actorType: "system",
    message: "Inspection workflow started",
    metadata: {
      inspection_classification: inspectionType,
      inspection_type: inspectionType,
      unit_id: params.unitId,
      resident_id: params.residentId ?? null,
      scheduled_at: params.scheduledAt ?? null,
    },
  })

  return { workflow_run_id: run.id }
}
