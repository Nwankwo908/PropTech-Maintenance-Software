/**
 * Inspection — run advances through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEngineForExistingRun } from "./runner.ts"
import { getWorkflowRunById } from "./workflowRuns.ts"
import type {
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowTriggerType,
} from "./types.ts"
import type { InspectionAdminEngineAction } from "./inspectionProgress.ts"

export type InspectionEngineAction =
  | "send_outreach"
  | "register_and_outreach"
  | "resident_replied"
  | "record_outcome"
  | "complete"
  | "mark_missed_window"
  | InspectionAdminEngineAction

export type InspectionEngineInput = {
  action: InspectionEngineAction
  smsBody?: string
  outcome?: string | null
  notes?: string | null
}

export async function runInspectionViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    trigger: WorkflowTriggerType
    inspection: InspectionEngineInput
    sms?: WorkflowExecutionContext["sms"]
  },
): Promise<WorkflowEngineResult | null> {
  const runId = params.runId.trim()
  if (!runId) return null

  const run = await getWorkflowRunById(supabase, runId)
  if (!run) return null

  return runWorkflowEngineForExistingRun(supabase, {
    landlordId: params.landlordId,
    run,
    trigger: params.trigger,
    extras: {
      inspection: params.inspection,
      sms: params.sms,
    },
  })
}
