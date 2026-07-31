import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runMaintenanceRequestViaEngine } from "./maintenanceRequestEngine.ts"
import type { StartMaintenanceRequestRunParams } from "./maintenanceRequestProgress.ts"

export type StartMaintenanceRequestWorkflowParams = StartMaintenanceRequestRunParams

/** Start (or reuse) a maintenance_request workflow run when a ticket is created. */
export async function startMaintenanceRequestWorkflow(
  supabase: SupabaseClient,
  params: StartMaintenanceRequestWorkflowParams,
): Promise<{ workflowRunId: string | null }> {
  const result = await runMaintenanceRequestViaEngine(supabase, {
    landlordId: params.landlordId,
    trigger: params.triggerType,
    maintenanceRequest: {
      action: "ticket_submitted",
      ticketSubmitted: params,
    },
  })

  const runId = result?.runId ?? null
  return { workflowRunId: runId }
}

export { findMaintenanceRequestRunId as findMaintenanceRequestRun } from "./maintenanceRequestProgress.ts"
