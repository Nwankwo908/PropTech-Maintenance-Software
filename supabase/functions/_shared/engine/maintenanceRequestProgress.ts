import { stableRecordId } from "../stableRecordId.ts"
/**
 * Maintenance request workflow run progress — shared by template act and legacy callers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { WorkflowTriggerType } from "./types.ts"
import {
  backfillPipelineStageEvents,
  getWorkflowRunById,
  logPipelineStageEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"

export type StartMaintenanceRequestRunParams = {
  landlordId: string
  ticketId: string
  /** Owner-responsibility / HQS tickets may have no resident. */
  residentId?: string | null
  unitId?: string | null
  propertyId?: string | null
  triggerType: WorkflowTriggerType
  dueAt: string
  issueCategory: string
  severity: string
  unitLabel?: string | null
  source: "web_form" | "sms_intake" | "hqs_letter" | "backfill"
  intakeRunId?: string | null
  conversationId?: string | null
  vendorAssigned?: boolean
  /** True when submit found no matchable vendor — escalate to Needs Your Attention. */
  needsVendorEscalation?: boolean
}

export async function findMaintenanceRequestRunId(
  supabase: SupabaseClient,
  ticketId: string,
  options?: { landlordId?: string; failClosed?: boolean },
): Promise<string | null> {
  let query = supabase
    .from("workflow_runs")
    .select("id, landlord_id, metadata")
    .eq("template_id", "maintenance_request")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[maintenance-request] find run", error.message)
    if (options?.failClosed) throw Error("Maintenance workflow lookup failed")
    return null
  }

  if (data?.id && options?.landlordId) {
    const owner = typeof data.landlord_id === "string" ? data.landlord_id
      : typeof data.metadata?.landlord_id === "string" ? data.metadata.landlord_id : null
    if (!owner || owner.trim().toLowerCase() !== options.landlordId.trim().toLowerCase()) {
      throw Error("Maintenance workflow owner mismatch")
    }
  }
  return (data?.id as string | undefined) ?? null
}

/** Create or reuse a maintenance_request workflow run when a ticket is submitted. */
export async function startMaintenanceRequestRun(
  supabase: SupabaseClient,
  params: StartMaintenanceRequestRunParams,
): Promise<{ workflowRunId: string | null }> {
  const existingId = await findMaintenanceRequestRunId(supabase, params.ticketId, { landlordId: params.landlordId, failClosed: true })
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

  const residentId = params.residentId?.trim() || null

  // The primary key arbitrates concurrent first starts. Ignore a conflict rather
  // than overwriting the winner or falling back to an unrelated random run.
  const id = await stableRecordId("maintenance-request-run", [params.landlordId, params.ticketId])
  const { data: inserted, error: insertError } = await supabase.from("workflow_runs")
    .upsert({
      id,
      template_id: "maintenance_request",
      landlord_id: params.landlordId,
      trigger_type: params.triggerType,
      status: "active",
      entity_type: "maintenance_request",
      entity_id: params.ticketId,
      resident_id: residentId,
      unit_id: params.unitId ?? null,
      property_id: params.propertyId ?? null,
      current_stage: currentStep,
      current_step: currentStep,
      completed_at: null,
      metadata: {
        landlord_id: params.landlordId,
        trigger_type: params.triggerType,
        due_at: params.dueAt,
        issue_category: params.issueCategory,
        severity: params.severity,
        unit_label: params.unitLabel?.trim() || undefined,
        source: params.source,
        intake_run_id: params.intakeRunId ?? undefined,
        conversation_id: params.conversationId ?? undefined,
        vendor_assigned: Boolean(params.vendorAssigned),
      },
    }, { onConflict: "id", ignoreDuplicates: true })
    .select("id").maybeSingle()
  if (insertError) throw Error(`Maintenance workflow creation failed: ${insertError.message}`)
  const run = await getWorkflowRunById(supabase, id)
  if (!run || run.landlord_id?.toLowerCase() !== params.landlordId.trim().toLowerCase() || run.template_id !== "maintenance_request" ||
    run.entity_type !== "maintenance_request" || run.entity_id?.toLowerCase() !== params.ticketId.trim().toLowerCase()) {
    throw Error("Maintenance workflow identity verification failed")
  }
  if (!inserted?.id) return { workflowRunId: run.id }

  // Only the actual creator appends the initial pipeline events.
  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "trigger",
    step: currentStep,
    message: "Workflow run started",
    metadata: { trigger_type: params.triggerType, template_id: "maintenance_request" },
  })

  await backfillPipelineStageEvents(supabase, {
    runId: run.id,
    stages: ["classify", "route"],
    metadata: {
      issue_category: params.issueCategory,
      severity: params.severity,
      source: params.source,
    },
  })

  const submittedMessage =
    params.source === "sms_intake"
      ? "Ticket created from SMS intake"
      : params.source === "hqs_letter"
      ? "Ticket created from inspection letter"
      : params.source === "backfill"
      ? "Ticket workflow started from backfill remediation"
      : "Ticket submitted from web form"

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "act",
    step: "submitted",
    actorType: residentId ? "resident" : "system",
    actorId: residentId,
    message: submittedMessage,
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
    vendorId?: string | null
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

  await updateWorkflowRun(supabase, run.id, {
    status: run.status === "escalated" ? "active" : undefined,
    currentStep: params.step,
    metadata: {
      vendor_assigned: true,
      assigned_vendor_id: params.vendorId?.trim() || null,
      auto_reassigned_at: run.status === "escalated" || params.resumeFromEscalated
        ? new Date().toISOString()
        : undefined,
      escalation_reason: null,
    },
    pipelineStage: "act",
    eventMessage: params.eventMessage,
    eventStep: params.eventStep,
  })

  return run.id
}
