import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isLeaseRenewalInquirySms } from "../sms/leaseRenewalInquiry.ts"
import {
  shouldRejectMaintenanceTemplateForInterpretation,
  shouldUnpinMaintenanceForInterpretation,
} from "../sms/inboundInterpretation.ts"
import { classifyTenantComplianceKeyword } from "../sms/tenantMessaging.ts"
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

  // STOP / START / HELP are global consent commands. Handlers consume them first;
  // if they reach the engine, do not continue maintenance, rent, or inspection.
  if (sms && classifyTenantComplianceKeyword(sms.inbound.body)) {
    return {
      templateId: "landlord_command",
      confidence: "low",
      reason: "sms_consent_command",
    }
  }

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

      // Don't pin a lease/renewal ask — or any other non-repair intent — to
      // a maintenance_intake run. Same thread can carry more than one outcome.
      const leaseInquiryOnMaintenance =
        byConversation.template_id === "maintenance_intake" &&
        isLeaseRenewalInquirySms(sms.inbound.body)
      const interpretedNonMaintenance =
        byConversation.template_id === "maintenance_intake" &&
        shouldUnpinMaintenanceForInterpretation(
          sms.interpretation,
          sms.inbound.body,
        )

      // Don't pin unknown / unlinked senders to a stuck maintenance_intake run —
      // that path only loops "need your unit number" without parsing unit replies.
      if (
        !stuckMaintenanceWithoutResident &&
        !leaseInquiryOnMaintenance &&
        !interpretedNonMaintenance
      ) {
        ctx.activeRun = byConversation
        ctx.runId = byConversation.id
        return {
          templateId: byConversation.template_id as WorkflowTemplateId,
          confidence: "high",
          reason: "active_workflow_run_on_conversation",
          runId: byConversation.id,
        }
      }

      if (leaseInquiryOnMaintenance || interpretedNonMaintenance) {
        console.info("[workflow-classify] non-maintenance intent overrides maintenance pin", {
          runId: byConversation.id,
          conversationId: sms.conversationId,
          intent: sms.interpretation?.intent ?? null,
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

  if (sms?.identity.resident_id?.trim()) {
    // Do not invent maintenance_intake for status / lease / other non-repair intents.
    if (
      shouldRejectMaintenanceTemplateForInterpretation(
        sms.interpretation,
        sms.inbound.body,
      )
    ) {
      return {
        templateId: "landlord_command",
        confidence: "low",
        reason: "non_maintenance_intent_no_template",
      }
    }
    // Fresh repair only when interpretation explicitly approved a new issue
    // (or interpretation never ran — compliance skip / legacy paths).
    const approvedNewIssue =
      !sms.interpretation ||
      sms.interpretation.extractedSlots.contextual_action === "new_issue"
    if (!approvedNewIssue) {
      return {
        templateId: "landlord_command",
        confidence: "low",
        reason: "existing_work_context_blocks_new_ticket",
      }
    }
    return {
      templateId: "maintenance_intake",
      confidence: "low",
      reason: "known_resident_fallback",
    }
  }

  return {
    templateId: "identity_onboarding",
    confidence: "low",
    reason: "fallback",
  }
}
