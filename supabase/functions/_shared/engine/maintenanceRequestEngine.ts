/**
 * Maintenance request lifecycle — programmatic entry through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  runWorkflowEngine,
  runWorkflowEngineForExistingRun,
} from "./runner.ts"
import { findMaintenanceRequestRunId } from "./maintenanceRequestProgress.ts"
import { getWorkflowRunById } from "./workflowRuns.ts"
import type {
  MaintenanceRequestEngineInput,
} from "./templates/maintenanceRequest.ts"
import type {
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowTriggerType,
} from "./types.ts"

type MaintenanceRequestEngineContext = WorkflowExecutionContext & {
  maintenanceRequest: MaintenanceRequestEngineInput
}

function buildEngineContext(params: {
  landlordId: string
  runId?: string | null
  trigger: WorkflowTriggerType
  maintenanceRequest: MaintenanceRequestEngineInput
  activeRun?: WorkflowExecutionContext["activeRun"]
}): MaintenanceRequestEngineContext {
  return {
    trigger: params.trigger,
    landlordId: params.landlordId,
    runId: params.runId ?? null,
    activeRun: params.activeRun ?? null,
    maintenanceRequest: params.maintenanceRequest,
  }
}

/**
 * Advance maintenance request lifecycle through trigger → classify → route → act → escalate → log.
 */
export async function runMaintenanceRequestViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId?: string | null
    trigger: WorkflowTriggerType
    maintenanceRequest: MaintenanceRequestEngineInput
  },
): Promise<WorkflowEngineResult | null> {
  let runId = params.runId?.trim() || null

  if (!runId && params.maintenanceRequest.action !== "ticket_submitted") {
    const ticketId = resolveTicketId(params.maintenanceRequest)
    if (ticketId) {
      runId = await findMaintenanceRequestRunId(supabase, ticketId)
    }
  }

  if (runId) {
    const run = await getWorkflowRunById(supabase, runId)
    if (!run) return null

    return runWorkflowEngineForExistingRun(supabase, {
      landlordId: params.landlordId,
      run,
      trigger: params.trigger,
      extras: {
        maintenanceRequest: params.maintenanceRequest,
      } as Partial<WorkflowExecutionContext>,
    })
  }

  return runWorkflowEngine(
    supabase,
    buildEngineContext(params),
  )
}

function resolveTicketId(input: MaintenanceRequestEngineInput): string | null {
  if (input.ticketSubmitted?.ticketId) {
    return input.ticketSubmitted.ticketId.trim()
  }
  if (input.autoReassign?.ticketId) {
    return input.autoReassign.ticketId.trim()
  }
  if (input.adminReassigned?.ticketId) {
    return input.adminReassigned.ticketId.trim()
  }
  if (input.vendorReassigned?.ticketId) {
    return input.vendorReassigned.ticketId.trim()
  }
  if (input.escalateNoVendor?.ticket.id) {
    return input.escalateNoVendor.ticket.id.trim()
  }
  return null
}
