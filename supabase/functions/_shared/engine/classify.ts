import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { listWorkflowTemplates } from "./registry.ts"
import { findActiveWorkflowRun } from "./workflowRuns.ts"
import type {
  ClassifiedIntent,
  WorkflowExecutionContext,
  WorkflowTemplateId,
} from "./types.ts"

/** Classify inbound context into a workflow template (highest-confidence wins). */
export async function classifyWorkflow(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
): Promise<ClassifiedIntent> {
  const sms = ctx.sms

  if (sms) {
    const byConversation = await findActiveWorkflowRun(supabase, {
      landlordId: ctx.landlordId,
      conversationId: sms.conversationId,
    })

    if (byConversation) {
      ctx.activeRun = byConversation
      ctx.runId = byConversation.id
      return {
        templateId: byConversation.template_id as WorkflowTemplateId,
        confidence: "high",
        reason: "active_workflow_run_on_conversation",
        runId: byConversation.id,
      }
    }

    const residentId = sms.identity.resident_id?.trim()
    if (residentId) {
      const leaseRun = await findActiveWorkflowRun(supabase, {
        landlordId: ctx.landlordId,
        residentId,
        templateId: "lease_renewal",
      })
      if (leaseRun) {
        ctx.activeRun = leaseRun
        ctx.runId = leaseRun.id
        return {
          templateId: "lease_renewal",
          confidence: "high",
          reason: "active_lease_renewal_run",
          runId: leaseRun.id,
        }
      }

      const rentRun = await findActiveWorkflowRun(supabase, {
        landlordId: ctx.landlordId,
        residentId,
        templateId: "rent_collection",
      })
      if (rentRun) {
        ctx.activeRun = rentRun
        ctx.runId = rentRun.id
        return {
          templateId: "rent_collection",
          confidence: "high",
          reason: "active_rent_collection_run",
          runId: rentRun.id,
        }
      }
    }
  }

  const candidates: ClassifiedIntent[] = []
  for (const template of listWorkflowTemplates()) {
    if (!template.supportedTriggers.includes(ctx.trigger)) continue
    const intent = template.classify(ctx)
    if (intent) candidates.push(intent)
  }

  const rank = { high: 3, medium: 2, low: 1 } as const
  candidates.sort((a, b) => rank[b.confidence] - rank[a.confidence])

  if (candidates[0]) return candidates[0]

  return {
    templateId: "identity_onboarding",
    confidence: "low",
    reason: "fallback",
  }
}
