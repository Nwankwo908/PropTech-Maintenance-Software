import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { applyVendorStatusTransition, parseVendorSmsReply } from "../../vendor_workflow.ts"
import {
  buildVendorSmsAcceptReply,
  buildVendorSmsDeclineReply,
  buildVendorSmsReplyPrompt,
} from "../../vendor_outreach_copy.ts"
import {
  recordVendorRepliedEvent,
  resolveVendorMaintenanceRequestId,
  type VendorStatusTransitionResultMeta,
} from "../../sms/vendorSmsRouting.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

async function handleUnknownSender(ctx: WorkflowExecutionContext): Promise<WorkflowActResult> {
  return {
    templateId: "identity_onboarding",
    route: workflowRouteForTemplate("identity_onboarding"),
    replyHint:
      ctx.sms?.selfHealingPhase === "unresolved"
        ? "I wasn't able to match that unit. I've let your property manager know — they'll follow up with you."
        : "Hi — this is Ulo. What's your unit number, and what's going on?",
    metadata: {
      selfHealed: ctx.sms?.selfHealed,
      onboarding: true,
      resolutionSource: ctx.sms?.resolutionSource,
      selfHealingPhase: ctx.sms?.selfHealingPhase,
      suggestedUnit: ctx.sms?.suggestedUnit,
    },
  }
}

export const vendorJobResponseTemplate: WorkflowTemplate = {
  id: "vendor_job_response",
  name: "Vendor job response",
  supportedTriggers: ["sms_inbound", "vendor_portal", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    const sms = ctx.sms
    if (!sms) return null

    const hasLinkedVendor =
      sms.identity.identity_type === "vendor" && !!sms.identity.vendor_id?.trim()

    if (hasLinkedVendor) {
      return {
        templateId: "vendor_job_response",
        confidence: "high",
        reason: "linked_vendor_sms",
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
  ): Promise<WorkflowActResult> {
    const sms = ctx.sms
    if (!sms) {
      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        metadata: { error: "missing_sms_context" },
      }
    }

    if (!sms.identity.vendor_id?.trim()) {
      return handleUnknownSender(ctx)
    }

    const vendorId = sms.identity.vendor_id.trim()
    const ticketId = await resolveVendorMaintenanceRequestId(supabase, {
      vendorId,
      conversationId: sms.conversationId,
      conversationMaintenanceRequestId: sms.maintenanceRequestId,
    })

    const parsedAction = parseVendorSmsReply(sms.inbound.body)
    let transition: VendorStatusTransitionResultMeta | undefined

    if (ticketId && parsedAction) {
      const result = await applyVendorStatusTransition(supabase, {
        ticketId,
        vendorId,
        action: parsedAction,
        source: "sms",
      })
      transition = result.ok
        ? {
            ok: true,
            fromStatus: result.fromStatus,
            toStatus: result.toStatus,
          }
        : {
            ok: false,
            fromStatus: result.currentStatus,
            reason: result.reason,
          }
    }

    await recordVendorRepliedEvent(supabase, {
      landlordId: ctx.landlordId,
      vendorId,
      conversationId: sms.conversationId,
      messageId: sms.messageId,
      maintenanceRequestId: ticketId,
      bodyPreview: sms.inbound.body,
      parsedAction,
      transition,
    })

    if (ticketId && !sms.maintenanceRequestId) {
      const { error } = await supabase
        .from("sms_conversations")
        .update({ maintenance_request_id: ticketId })
        .eq("id", sms.conversationId)
      if (error) {
        console.error("[workflow-engine] link conversation ticket", error.message)
      }
    }

    return {
      templateId: "vendor_job_response",
      route: workflowRouteForTemplate("vendor_job_response"),
      replyHint:
        parsedAction === "accept"
          ? buildVendorSmsAcceptReply()
          : parsedAction === "decline"
            ? buildVendorSmsDeclineReply()
            : ticketId
              ? buildVendorSmsReplyPrompt()
              : undefined,
      metadata: {
        vendorId,
        maintenanceRequestId: ticketId,
        parsedAction,
        transition,
        bodyPreview: sms.inbound.body.slice(0, 160),
      },
    }
  },
}
