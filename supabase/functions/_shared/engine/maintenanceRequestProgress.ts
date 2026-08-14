/**
 * Maintenance request workflow run progress — shared by template act and legacy callers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { WorkflowTriggerType } from "./types.ts"
import {
  backfillPipelineStageEvents,
  createWorkflowRun,
  getWorkflowRunById,
  logPipelineStageEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"

export type StartMaintenanceRequestRunParams = {
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
  vendorAssigned?: boolean
  /** True when submit found no matchable vendor — escalate to Needs Your Attention. */
  needsVendorEscalation?: boolean
}

export async function findMaintenanceRequestRunId(
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
    console.error("[maintenance-request] find run", error.message)
    return null
  }

  return (data?.id as string | undefined) ?? null
}

/** Create or reuse a maintenance_request workflow run when a ticket is submitted. */
export async function startMaintenanceRequestRun(
  supabase: SupabaseClient,
  params: StartMaintenanceRequestRunParams,
): Promise<{ workflowRunId: string | null }> {
  const existingId = await findMaintenanceRequestRunId(supabase, params.ticketId)
  if (existingId) {
    if (params.vendorAssigned) {
      await updateWorkflowRun(supabase, existingId, {
        currentStep: "pending_accept",
        metadata: { vendor_assigned: true },
      })
    }
    return { workflowRunId: existingId }
  }

  const currentStep = params.vendorAssigned ? "pending_accept" : "unassigned"

  const run = await createWorkflowRun(supabase, {
    templateId: "maintenance_request",
    landlordId: params.landlordId,
    triggerType: params.triggerType,
    currentStep,
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
      vendor_assigned: Boolean(params.vendorAssigned),
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

/** After vendor assignment or reassignment, advance the maintenance_request run. */
export async function advanceMaintenanceRequestVendorStep(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    step: "pending_accept" | "awaiting_vendor_accept"
    eventMessage: string
    eventStep: string
    resumeFromEscalated?: boolean
  },
): Promise<string | null> {
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, status")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", params.ticketId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run?.id) return null

  const resume = params.resumeFromEscalated && run.status === "escalated"

  await updateWorkflowRun(supabase, run.id, {
    status: resume ? "active" : undefined,
    currentStep: params.step,
    metadata: resume
      ? { auto_reassigned_at: new Date().toISOString() }
      : { vendor_assigned: true },
    pipelineStage: "act",
    eventMessage: params.eventMessage,
    eventStep: params.eventStep,
  })

  return run.id
}
