/**
 * Idempotent lifecycle workflow "started" logging — owned by the engine act stage.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  logOperationsGraphEvent,
  resolveOperationsGraphScope,
  type OperationsGraphScope,
} from "../graph/operationsGraph.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  getWorkflowRunById,
  logWorkflowEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { WorkflowRunRow, WorkflowTriggerType } from "./types.ts"

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

function startedEventForTemplate(
  templateId: string,
): { eventType: string; step: string; defaultMessage: string } | null {
  switch (templateId) {
    case "move_in":
      return {
        eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.started}`,
        step: "initiated",
        defaultMessage: "Move-in workflow started",
      }
    case "move_out":
      return {
        eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.started}`,
        step: "initiated",
        defaultMessage: "Move-out workflow started",
      }
    case "inspection":
      return {
        eventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.started}`,
        step: "scheduled",
        defaultMessage: "Inspection workflow started",
      }
    default:
      return null
  }
}

function startedMessage(run: WorkflowRunRow): string {
  const meta = run.metadata ?? {}
  if (run.template_id === "move_in") {
    if (meta.skip_tenant_registration === true) {
      return "Move-in workflow started (tenant registration skipped)"
    }
    return "Move-in workflow started for new occupancy"
  }
  if (run.template_id === "inspection") {
    const type = typeof meta.inspection_type === "string"
      ? meta.inspection_type
      : "periodic"
    return `Inspection workflow started (${type})`
  }
  return "Move-out workflow started"
}

/** Log move_in / move_out / inspection started events once per workflow run. */
export async function ensureLifecycleWorkflowStartedLogged(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    trigger: WorkflowTriggerType
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.landlord_id !== params.landlordId) return

  const meta = run.metadata ?? {}
  if (typeof meta.started_logged_at === "string" && meta.started_logged_at) {
    return
  }

  const spec = startedEventForTemplate(run.template_id)
  if (!spec) return

  const graphScope: OperationsGraphScope = {
    landlordId: params.landlordId,
    workflowRunId: run.id,
    workflowTemplateId: run.template_id,
    propertyId: run.property_id,
    unitId: run.unit_id,
    residentId: run.resident_id,
    occupancyId: typeof meta.occupancy_id === "string" ? meta.occupancy_id : null,
    inspectionId: typeof meta.inspection_id === "string" ? meta.inspection_id : null,
    unitLabel: typeof meta.unit_label === "string" ? meta.unit_label : null,
    building: typeof meta.building === "string" ? meta.building : null,
  }

  const resolved = await resolveOperationsGraphScope(supabase, graphScope)
  const message = startedMessage(run)
  const eventSource = triggerToGraphSource(params.trigger)

  const eventPayload = {
    message,
    workflow_template_id: run.template_id,
    move_in_classification: meta.move_in_classification ?? null,
    move_out_classification: meta.move_out_classification ?? null,
    inspection_classification: meta.inspection_classification ?? null,
    inspection_type: meta.inspection_type ?? null,
    move_in_date: meta.move_in_date ?? null,
    move_out_date: meta.move_out_date ?? null,
    scheduled_at: meta.scheduled_at ?? null,
    occupancy_id: meta.occupancy_id ?? null,
    inspection_id: meta.inspection_id ?? null,
    unit_label: meta.unit_label ?? null,
    building: meta.building ?? null,
    skip_tenant_registration: meta.skip_tenant_registration === true,
    source_workflow: meta.source_workflow_template_id ?? meta.source_workflow ?? null,
    source_workflow_run_id: meta.source_workflow_run_id ?? null,
    parent_workflow_run_id: meta.parent_workflow_run_id ?? null,
  }

  await logOperationsGraphEvent(supabase, {
    scope: graphScope,
    eventType: spec.eventType,
    source: eventSource,
    actorType: "system",
    metadata: eventPayload,
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: run.id,
    eventType: spec.eventType,
    step: spec.step,
    actorType: "system",
    message: spec.defaultMessage,
    metadata: {
      ...eventPayload,
      unit_id: run.unit_id,
      resident_id: run.resident_id,
    },
  })

  await updateWorkflowRun(supabase, run.id, {
    metadata: {
      started_logged_at: new Date().toISOString(),
    },
  })
}
