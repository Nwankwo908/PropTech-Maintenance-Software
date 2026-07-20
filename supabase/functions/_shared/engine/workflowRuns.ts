import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type {
  WorkflowEntityType,
  WorkflowRunMetadata,
  WorkflowRunRow,
  WorkflowRunStatus,
  WorkflowStage,
  WorkflowTemplateId,
  WorkflowTriggerType,
} from "./types.ts"

export type { WorkflowEntityType } from "./types.ts"

const runSelect =
  "id, template_id, status, landlord_id, trigger_type, entity_type, entity_id, property_id, unit_id, resident_id, current_stage, current_step, started_at, completed_at, created_at, updated_at, metadata"

export function runLandlordId(run: WorkflowRunRow): string | null {
  if (run.landlord_id?.trim()) return run.landlord_id.trim()
  const id = run.metadata?.landlord_id
  return typeof id === "string" && id.trim() ? id.trim() : null
}

export function runConversationId(run: WorkflowRunRow): string | null {
  if (run.entity_type === "sms_conversation" && run.entity_id) {
    return run.entity_id
  }
  return null
}

export function runMaintenanceRequestId(run: WorkflowRunRow): string | null {
  if (run.entity_type === "maintenance_request" && run.entity_id) {
    return run.entity_id
  }
  return null
}

export function runLeaseEndDate(run: WorkflowRunRow): string | null {
  const value = run.metadata?.lease_end_date
  return typeof value === "string" ? value : null
}

export function runAmountDue(run: WorkflowRunRow): number | null {
  const value = run.metadata?.amount_due
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function runBillingPeriod(run: WorkflowRunRow): string | null {
  const value = run.metadata?.billing_period
  return typeof value === "string" ? value : null
}

export function runRentClassification(
  run: WorkflowRunRow,
): string | null {
  const value = run.metadata?.rent_classification
  return typeof value === "string" ? value : null
}

export function runDueAt(run: WorkflowRunRow): string | null {
  const value = run.metadata?.due_at
  return typeof value === "string" ? value : null
}

export function runStepState<T extends Record<string, unknown>>(
  run: WorkflowRunRow,
): T {
  const step = run.metadata?.step_state
  const base =
    step && typeof step === "object" && !Array.isArray(step)
      ? (step as Record<string, unknown>)
      : {}
  const leaseEnd = run.metadata?.lease_end_date
  return {
    ...base,
    ...(typeof leaseEnd === "string" ? { lease_end_date: leaseEnd } : {}),
  } as T
}

export function runIntakeState<T extends Record<string, unknown>>(
  run: WorkflowRunRow,
): T {
  const intake = run.metadata?.intake_state
  return (intake && typeof intake === "object" && !Array.isArray(intake)
    ? intake
    : {}) as T
}

function mergeMetadata(
  base: WorkflowRunMetadata & Record<string, unknown>,
  patch?: WorkflowRunMetadata & Record<string, unknown>,
): WorkflowRunMetadata & Record<string, unknown> {
  if (!patch || Object.keys(patch).length === 0) return base
  return { ...base, ...patch }
}

export async function logPipelineStageEvent(
  supabase: SupabaseClient,
  params: {
    runId: string
    stage: WorkflowStage
    step?: string | null
    actorType?: "resident" | "vendor" | "landlord" | "system" | null
    actorId?: string | null
    message?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  return logWorkflowEvent(supabase, {
    workflowRunId: params.runId,
    eventType: `workflow.${params.stage}`,
    step: params.step ?? undefined,
    actorType: params.actorType ?? "system",
    actorId: params.actorId ?? null,
    message: params.message ?? null,
    metadata: params.metadata,
  })
}

/** Backfill pipeline stage events when the run is created after trigger/classify/route. */
export async function backfillPipelineStageEvents(
  supabase: SupabaseClient,
  params: {
    runId: string
    stages: WorkflowStage[]
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  for (const stage of params.stages) {
    await logPipelineStageEvent(supabase, {
      runId: params.runId,
      stage,
      metadata: params.metadata,
    })
  }
}

export async function getWorkflowRunById(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow | null> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select(runSelect)
    .eq("id", runId)
    .maybeSingle()

  if (error) {
    console.error("[workflow-runs] get by id", error.message)
    return null
  }

  return normalizeRunRow(data)
}

export async function findActiveWorkflowRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId?: string | null
    residentId?: string | null
    templateId?: WorkflowTemplateId
  },
): Promise<WorkflowRunRow | null> {
  const templateId = params.templateId

  // Prefer the run currently linked on the SMS conversation (survives entity
  // upgrades from sms_conversation → maintenance_request during early ticket mint).
  if (params.conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("workflow_run_id, maintenance_request_id")
      .eq("id", params.conversationId)
      .maybeSingle()

    const linkedRunId =
      typeof convo?.workflow_run_id === "string" ? convo.workflow_run_id.trim() : ""
    if (linkedRunId) {
      const linked = await getWorkflowRunById(supabase, linkedRunId)
      if (
        linked &&
        linked.status === "active" &&
        (!templateId || linked.template_id === templateId) &&
        (!params.landlordId || linked.landlord_id === params.landlordId)
      ) {
        return linked
      }
    }

    const ticketId =
      typeof convo?.maintenance_request_id === "string"
        ? convo.maintenance_request_id.trim()
        : ""
    if (ticketId && templateId === "maintenance_intake") {
      const { data: byTicket, error: byTicketErr } = await supabase
        .from("workflow_runs")
        .select(runSelect)
        .eq("status", "active")
        .eq("landlord_id", params.landlordId)
        .eq("template_id", "maintenance_intake")
        .eq("entity_type", "maintenance_request")
        .eq("entity_id", ticketId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (byTicketErr) {
        console.error("[workflow-runs] find active by ticket", byTicketErr.message)
      } else {
        const run = normalizeRunRow(byTicket)
        if (run) return run
      }
    }
  }

  let query = supabase
    .from("workflow_runs")
    .select(runSelect)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)

  if (params.landlordId) {
    query = query.eq("landlord_id", params.landlordId)
  }

  if (templateId) {
    query = query.eq("template_id", templateId)
  }

  if (params.conversationId) {
    query = query
      .eq("entity_type", "sms_conversation")
      .eq("entity_id", params.conversationId)
  } else if (params.residentId) {
    query = query.eq("resident_id", params.residentId)
  } else {
    return null
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error("[workflow-runs] find active", error.message)
    return null
  }

  return normalizeRunRow(data)
}

export async function createWorkflowRun(
  supabase: SupabaseClient,
  params: {
    id?: string
    templateId: WorkflowTemplateId | string
    landlordId: string
    triggerType: WorkflowTriggerType
    currentStep?: string | null
    entityType?: WorkflowEntityType | null
    entityId?: string | null
    propertyId?: string | null
    residentId?: string | null
    unitId?: string | null
    metadata?: WorkflowRunMetadata & Record<string, unknown>
    logTriggerEvent?: boolean
  },
): Promise<WorkflowRunRow | null> {
  const metadata = mergeMetadata(
    {
      landlord_id: params.landlordId,
      trigger_type: params.triggerType,
      ...(params.metadata ?? {}),
    },
    undefined,
  )

  const row = {
    template_id: params.templateId,
    landlord_id: params.landlordId,
    trigger_type: params.triggerType,
    status: "active",
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    property_id: params.propertyId ?? null,
    resident_id: params.residentId ?? null,
    unit_id: params.unitId ?? null,
    current_stage: params.currentStep ?? null,
    current_step: params.currentStep ?? null,
    completed_at: null,
    metadata,
    ...(params.id ? { id: params.id } : {}),
  }

  const writeQuery = params.id
    ? supabase.from("workflow_runs").upsert(row, { onConflict: "id" })
    : supabase.from("workflow_runs").insert(row)

  const { data, error } = await writeQuery.select(runSelect).single()

  if (error) {
    console.error("[workflow-runs] create", error.message)
    return null
  }

  const run = normalizeRunRow(data)
  if (run && params.logTriggerEvent !== false) {
    await logPipelineStageEvent(supabase, {
      runId: run.id,
      stage: "trigger",
      step: params.currentStep ?? undefined,
      message: "Workflow run started",
      metadata: {
        trigger_type: params.triggerType,
        template_id: params.templateId,
      },
    })
  }

  return run
}

export async function updateWorkflowRun(
  supabase: SupabaseClient,
  runId: string,
  patch: {
    status?: WorkflowRunStatus
    currentStep?: string | null
    currentStage?: string | null
    entityType?: WorkflowEntityType | null
    entityId?: string | null
    propertyId?: string | null
    metadata?: WorkflowRunMetadata & Record<string, unknown>
    completedAt?: string | null
    pipelineStage?: WorkflowStage
    eventMessage?: string
    eventStep?: string
    eventType?: string
  },
): Promise<WorkflowRunRow | null> {
  const existing = await getWorkflowRunById(supabase, runId)
  if (!existing) return null

  const update: Record<string, unknown> = {}

  if (patch.status) update.status = patch.status
  if (patch.currentStep !== undefined) {
    update.current_step = patch.currentStep
    update.current_stage = patch.currentStep
  }
  if (patch.entityType !== undefined) update.entity_type = patch.entityType
  if (patch.entityId !== undefined) update.entity_id = patch.entityId
  if (patch.propertyId !== undefined) update.property_id = patch.propertyId
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
  if (patch.metadata) {
    update.metadata = mergeMetadata(existing.metadata ?? {}, patch.metadata)
  }
  if (patch.pipelineStage) {
    update.current_stage = patch.pipelineStage
  }
  if (patch.currentStage !== undefined) {
    update.current_stage = patch.currentStage
  }

  const { data, error } = await supabase
    .from("workflow_runs")
    .update(update)
    .eq("id", runId)
    .select(runSelect)
    .single()

  if (error) {
    console.error("[workflow-runs] update", runId, error.message)
    return null
  }

  const run = normalizeRunRow(data)
  if (run && patch.pipelineStage) {
    await logPipelineStageEvent(supabase, {
      runId,
      stage: patch.pipelineStage,
      step: patch.eventStep ?? patch.currentStep ?? run.current_step ?? undefined,
      message: patch.eventMessage,
      metadata: patch.metadata,
    })
  } else if (run && patch.eventType) {
    await logWorkflowEvent(supabase, {
      workflowRunId: runId,
      eventType: patch.eventType,
      step: patch.eventStep ?? patch.currentStep ?? run.current_step ?? undefined,
      message: patch.eventMessage,
      metadata: patch.metadata,
    })
  }

  return run
}

export async function syncWorkflowRunIntakeState(
  supabase: SupabaseClient,
  params: {
    runId: string
    intakeState: Record<string, unknown>
    currentStep?: string | null
  },
): Promise<WorkflowRunRow | null> {
  return updateWorkflowRun(supabase, params.runId, {
    currentStep: params.currentStep ?? undefined,
    metadata: { intake_state: params.intakeState },
  })
}

export async function findOverdueLeaseRenewalRuns(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<WorkflowRunRow[]> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("workflow_runs")
    .select(runSelect)
    .eq("template_id", "lease_renewal")
    .eq("status", "active")
    .eq("landlord_id", landlordId)
    .filter("metadata->>due_at", "lt", now)

  if (error) {
    console.error("[workflow-runs] find overdue lease renewals", error.message)
    return []
  }

  return (data ?? [])
    .map((row) => normalizeRunRow(row))
    .filter((row): row is WorkflowRunRow => row !== null)
}

export async function findOverdueRentCollectionRuns(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<WorkflowRunRow[]> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("workflow_runs")
    .select(runSelect)
    .eq("template_id", "rent_collection")
    .eq("status", "active")
    .eq("landlord_id", landlordId)
    .filter("metadata->>due_at", "lt", now)

  if (error) {
    console.error("[workflow-runs] find overdue rent collections", error.message)
    return []
  }

  return (data ?? [])
    .map((row) => normalizeRunRow(row))
    .filter((row): row is WorkflowRunRow => row !== null)
}

/** Active workflow runs scoped to a landlord (metadata.landlord_id). */
export async function findActiveWorkflowRunsForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<WorkflowRunRow[]> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select(runSelect)
    .eq("status", "active")
    .eq("landlord_id", landlordId)
    .order("started_at", { ascending: true })

  if (error) {
    console.error("[workflow-runs] find active for landlord", error.message)
    return []
  }

  return (data ?? [])
    .map((row) => normalizeRunRow(row))
    .filter((row): row is WorkflowRunRow => row !== null)
}

export async function logWorkflowEvent(
  supabase: SupabaseClient,
  params: {
    workflowRunId: string
    eventType: string
    step?: string | null
    stage?: string | null
    actorType?: "resident" | "vendor" | "landlord" | "system" | null
    actorId?: string | null
    message?: string | null
    metadata?: Record<string, unknown>
    landlordId?: string | null
    workflowType?: string | null
  },
): Promise<string | null> {
  const stage = params.stage ??
    (params.eventType.startsWith("workflow.")
      ? params.eventType.slice("workflow.".length)
      : null)

  let landlordId = params.landlordId ?? null
  let workflowType = params.workflowType ?? null
  if (!landlordId || !workflowType) {
    const run = await getWorkflowRunById(supabase, params.workflowRunId)
    if (run) {
      landlordId = landlordId ?? runLandlordId(run)
      workflowType = workflowType ?? run.workflow_type ?? run.template_id
    }
  }

  const { data, error } = await supabase
    .from("workflow_events")
    .insert({
      workflow_run_id: params.workflowRunId,
      event_type: params.eventType,
      step: params.step ?? null,
      stage,
      actor_type: params.actorType ?? null,
      actor_id: params.actorId ?? null,
      message: params.message ?? null,
      landlord_id: params.landlordId ?? null,
      workflow_type: params.workflowType ?? null,
      metadata: params.metadata ?? {},
    })
    .select("id")
    .single()

  if (error) {
    console.error("[workflow-events] insert", params.eventType, error.message)
    return null
  }

  return (data?.id as string | undefined) ?? null
}

export async function linkConversationToWorkflowRun(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    runId: string
    templateId: WorkflowTemplateId | string
    /** When set, keep the run bound to the durable ticket (not the conversation id). */
    maintenanceRequestId?: string | null
  },
): Promise<void> {
  const ticketId = params.maintenanceRequestId?.trim() || null
  if (ticketId) {
    await updateWorkflowRun(supabase, params.runId, {
      entityType: "maintenance_request",
      entityId: ticketId,
      metadata: { conversation_id: params.conversationId },
    })
  } else {
    await updateWorkflowRun(supabase, params.runId, {
      entityType: "sms_conversation",
      entityId: params.conversationId,
    })
  }

  const { error } = await supabase
    .from("sms_conversations")
    .update({
      workflow_run_id: params.runId,
      workflow_template_id: params.templateId,
      ...(ticketId ? { maintenance_request_id: ticketId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  if (error) {
    console.error("[workflow-runs] link conversation", error.message)
  }
}

function normalizeRunRow(raw: unknown): WorkflowRunRow | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const startedAt = String(row.started_at ?? row.created_at ?? new Date().toISOString())
  return {
    id: String(row.id),
    template_id: String(row.template_id) as WorkflowTemplateId,
    workflow_type: row.workflow_type == null
      ? String(row.template_id)
      : String(row.workflow_type),
    status: String(row.status) as WorkflowRunStatus,
    landlord_id: row.landlord_id == null ? null : String(row.landlord_id),
    trigger_type: row.trigger_type == null
      ? null
      : String(row.trigger_type) as WorkflowTriggerType,
    entity_type: row.entity_type == null ? null : String(row.entity_type),
    entity_id: row.entity_id == null ? null : String(row.entity_id),
    property_id: row.property_id == null ? null : String(row.property_id),
    unit_id: row.unit_id == null ? null : String(row.unit_id),
    resident_id: row.resident_id == null ? null : String(row.resident_id),
    current_stage: row.current_stage == null
      ? (row.current_step == null ? null : String(row.current_step))
      : String(row.current_stage),
    current_step: row.current_step == null
      ? (row.current_stage == null ? null : String(row.current_stage))
      : String(row.current_step),
    started_at: startedAt,
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    created_at: String(row.created_at ?? startedAt),
    updated_at: String(row.updated_at ?? startedAt),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as WorkflowRunMetadata & Record<string, unknown>)
        : {},
  }
}
