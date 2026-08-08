/**
 * Move-in — run advances through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  runWorkflowEngineForExistingRun,
} from "./runner.ts"
import { getWorkflowRunById } from "./workflowRuns.ts"
import type {
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowTriggerType,
} from "./types.ts"
import type { MoveInRegisterOccupancyInput } from "./moveInProgress.ts"

export type MoveInEngineAction =
  | "register_occupancy"
  | "send_outreach"
  | "register_and_outreach"
  | "resident_replied"
  | "complete"

export type MoveInEngineInput = {
  action: MoveInEngineAction
  register?: MoveInRegisterOccupancyInput
  smsBody?: string
}

type MoveInEngineContext = WorkflowExecutionContext & {
  moveIn: MoveInEngineInput
}

function buildEngineContext(
  params: {
    landlordId: string
    runId?: string | null
    trigger: WorkflowTriggerType
    moveIn: MoveInEngineInput
    activeRun?: WorkflowExecutionContext["activeRun"]
    sms?: WorkflowExecutionContext["sms"]
  },
): MoveInEngineContext {
  return {
    trigger: params.trigger,
    landlordId: params.landlordId,
    runId: params.runId ?? null,
    activeRun: params.activeRun ?? null,
    sms: params.sms ?? null,
    moveIn: params.moveIn,
  }
}

export async function runMoveInViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    trigger: WorkflowTriggerType
    moveIn: MoveInEngineInput
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
      moveIn: params.moveIn,
      sms: params.sms,
    },
  })
}
