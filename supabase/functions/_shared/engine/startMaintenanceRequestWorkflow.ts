import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { WorkflowTriggerType } from "./types.ts"
import {
  backfillPipelineStageEvents,
  createWorkflowRun,
  getWorkflowRunById,
  logPipelineStageEvent,
} from "./workflowRuns.ts"

export type StartMaintenanceRequestWorkflowParams = {
  landlordId: string
  ticketId: string
  residentId: string
  unitId?: string | null
  triggerType: WorkflowTriggerType
  dueAt: string
  issueCategory: string
  severity: string
  unitLabel?: string | null
  source: "web_form" | "sms_intake"
  intakeRunId?: string | null
  conversationId?: string | null
}

async function findMaintenanceRequestRun(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("template_id", "maintenance_request")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[workflow] find maintenance_request run", error.message)
    return null
  }

  return (data?.id as string | undefined) ?? null
}

/** Start (or reuse) a maintenance_request workflow run when a ticket is created. */
export async function startMaintenanceRequestWorkflow(
  supabase: SupabaseClient,
  params: StartMaintenanceRequestWorkflowParams,
): Promise<{ workflowRunId: string | null }> {
  const existingId = await findMaintenanceRequestRun(supabase, params.ticketId)
  if (existingId) {
    return { workflowRunId: existingId }
  }

  const run = await createWorkflowRun(supabase, {
    templateId: "maintenance_request",
    landlordId: params.landlordId,
    triggerType: params.triggerType,
    currentStep: "pending_accept",
    entityType: "maintenance_request",
    entityId: params.ticketId,
    residentId: params.residentId,
    unitId: params.unitId ?? null,
    metadata: {
      due_at: params.dueAt,
      issue_category: params.issueCategory,
      severity: params.severity,
      unit_label: params.unitLabel?.trim() || undefined,
      source: params.source,
      intake_run_id: params.intakeRunId ?? undefined,
      conversation_id: params.conversationId ?? undefined,
    },
  })

  if (!run) {
    return { workflowRunId: null }
  }

  await backfillPipelineStageEvents(supabase, {
    runId: run.id,
    stages: ["classify", "route"],
    metadata: {
      issue_category: params.issueCategory,
      severity: params.severity,
      source: params.source,
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "act",
    step: "submitted",
    actorType: "resident",
    actorId: params.residentId,
    message: params.source === "sms_intake"
      ? "Ticket created from SMS intake"
      : "Ticket submitted from web form",
    metadata: {
      maintenance_request_id: params.ticketId,
    },
  })

  const verified = await getWorkflowRunById(supabase, run.id)
  return { workflowRunId: verified?.id ?? run.id }
}
