import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isLeaseRenewalInquirySms } from "../sms/leaseRenewalInquiry.ts"
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
      const hasResident = Boolean(sms.identity.resident_id?.trim())
      const stuckMaintenanceWithoutResident =
        byConversation.template_id === "maintenance_intake" &&
        !hasResident &&
        (sms.identity.identity_type === "unknown" ||
          sms.selfHealingPhase === "awaiting_unit_number" ||
          sms.selfHealingPhase === "unresolved" ||
          !sms.continueIntake)

      // Don't pin a lease/renewal ask to a maintenance_intake run — route to lease_renewal.
      const leaseInquiryOnMaintenance =
        byConversation.template_id === "maintenance_intake" &&
        isLeaseRenewalInquirySms(sms.inbound.body)

      // Don't pin unknown / unlinked senders to a stuck maintenance_intake run —
      // that path only loops "need your unit number" without parsing unit replies.
      if (!stuckMaintenanceWithoutResident && !leaseInquiryOnMaintenance) {
        ctx.activeRun = byConversation
        ctx.runId = byConversation.id
        return {
          templateId: byConversation.template_id as WorkflowTemplateId,
          confidence: "high",
          reason: "active_workflow_run_on_conversation",
          runId: byConversation.id,
        }
      }

      if (leaseInquiryOnMaintenance) {
        console.info("[workflow-classify] lease inquiry overrides maintenance pin", {
          runId: byConversation.id,
          conversationId: sms.conversationId,
        })
      }

      console.info("[workflow-classify] skipping stuck maintenance_intake run", {
        runId: byConversation.id,
        conversationId: sms.conversationId,
        identityType: sms.identity.identity_type,
        selfHealingPhase: sms.selfHealingPhase,
      })
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
