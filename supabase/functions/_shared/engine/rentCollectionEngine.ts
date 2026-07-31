/**
 * Rent collection — cron and programmatic entry through the official workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEngine } from "./runner.ts"
import type { WorkflowEngineResult } from "./types.ts"

export async function runRentCollectionCronViaEngine(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    rentDueDay?: number
    latePaymentGraceDays?: number
  },
): Promise<WorkflowEngineResult> {
  return runWorkflowEngine(supabase, {
    trigger: "cron",
    landlordId: params.landlordId,
    cron: {
      templateId: "rent_collection",
      rentDueDay: params.rentDueDay,
      noResponseDays: params.latePaymentGraceDays,
    },
  })
}
