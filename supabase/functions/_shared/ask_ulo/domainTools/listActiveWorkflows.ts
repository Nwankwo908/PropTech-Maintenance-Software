/**
 * listActiveWorkflows — domain tool wrapping activeWorkflowsLookup.
 * Answers “what tasks is Ulo handling right now?” without portfolio briefing.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  activeWorkflowsLookup,
  isUloActiveTasksQuestion,
  type ActiveWorkflowsResult,
} from "../activeWorkflowsLookup.ts"

export { isUloActiveTasksQuestion }

export type ListActiveWorkflowsParams = {
  organizationId: string
  limit?: number
}

export type ListActiveWorkflowsResult = ActiveWorkflowsResult & {
  toolId: "list_active_workflows"
  params: Record<string, unknown>
}

export async function listActiveWorkflows(
  supabase: SupabaseClient,
  params: ListActiveWorkflowsParams,
): Promise<ListActiveWorkflowsResult> {
  const base = await activeWorkflowsLookup(supabase, {
    landlordId: params.organizationId,
    limit: params.limit,
  })
  return {
    ...base,
    toolId: "list_active_workflows",
    params: {
      organizationId: params.organizationId,
      limit: params.limit ?? null,
      resultCount: base.facts.activeCount,
    },
  }
}
