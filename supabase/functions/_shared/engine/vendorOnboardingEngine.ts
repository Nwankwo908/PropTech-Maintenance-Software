/**
 * Vendor onboarding — run advances through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  runWorkflowEngine,
  runWorkflowEngineForExistingRun,
} from "./runner.ts"
import { getWorkflowRunById } from "./workflowRuns.ts"
import type {
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowTriggerType,
} from "./types.ts"

export type VendorOnboardingEngineAction =
  | "start_invite"
  | "invite_delivered"
  | "portal_in_progress"
  | "submit"

export type VendorOnboardingEngineInput = {
  action: VendorOnboardingEngineAction
  verificationId?: string
  vendorId?: string | null
  vendorLabel?: string
  overall?: "verified" | "needs_review"
  completeCount?: number
  requiredCount?: number
  channel?: string
  businessName?: string | null
  contactName?: string | null
  inviteDelivered?: {
    verificationId: string
    vendorLabel: string
    channel: string
    delivery: Record<string, unknown>
    anyDelivered: boolean
    deliveredVia: string
    conversationId?: string | null
  }
}

type VendorOnboardingEngineContext = WorkflowExecutionContext & {
  vendorOnboarding: VendorOnboardingEngineInput
}

function buildEngineContext(
  params: {
    landlordId: string
    runId?: string | null
    trigger: WorkflowTriggerType
    vendorOnboarding: VendorOnboardingEngineInput
    activeRun?: WorkflowExecutionContext["activeRun"]
  },
): VendorOnboardingEngineContext {
  return {
    trigger: params.trigger,
    landlordId: params.landlordId,
    runId: params.runId ?? null,
    activeRun: params.activeRun ?? null,
    vendorOnboarding: params.vendorOnboarding,
  }
}

/**
 * Advance vendor onboarding through trigger → classify → route → act → escalate → log.
 */
export async function runVendorOnboardingViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId?: string | null
    trigger: WorkflowTriggerType
    vendorOnboarding: VendorOnboardingEngineInput
  },
): Promise<WorkflowEngineResult | null> {
  if (params.vendorOnboarding.action === "start_invite" && !params.runId?.trim()) {
    return runWorkflowEngine(
      supabase,
      buildEngineContext(params),
    )
  }

  const runId = params.runId?.trim()
  if (!runId) return null

  const run = await getWorkflowRunById(supabase, runId)
  if (!run) return null

  return runWorkflowEngineForExistingRun(supabase, {
    landlordId: params.landlordId,
    run,
    trigger: params.trigger,
    extras: { vendorOnboarding: params.vendorOnboarding },
  })
}
