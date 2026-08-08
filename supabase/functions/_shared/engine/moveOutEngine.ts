/**
 * Move-out — run advances through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEngineForExistingRun } from "./runner.ts"
import { getWorkflowRunById } from "./workflowRuns.ts"
import type {
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowTriggerType,
} from "./types.ts"
import type { MoveOutAdminEngineAction } from "./moveOutProgress.ts"

export type MoveOutEngineAction =
  | "send_outreach"
  | "schedule_inspection"
  | "mark_vacated"
  | "resident_replied"
  | "complete"
  | MoveOutAdminEngineAction

export type MoveOutEngineInput = {
  action: MoveOutEngineAction
  sourceWorkflowRunId?: string | null
  smsBody?: string
  scheduledAt?: string | null
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
}

export async function runMoveOutViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    trigger: WorkflowTriggerType
    moveOut: MoveOutEngineInput
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
      moveOut: params.moveOut,
      sms: params.sms,
    },
  })
}
