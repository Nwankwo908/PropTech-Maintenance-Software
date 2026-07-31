import {
  processUnknownContactIntakeTurn,
} from "../../sms/unknownContactIntake.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowTemplate,
} from "../types.ts"

export const identityOnboardingTemplate: WorkflowTemplate = {
  id: "identity_onboarding",
  name: "Identity onboarding",
  supportedTriggers: ["sms_inbound"],

  classify(ctx): ClassifiedIntent | null {
    const sms = ctx.sms
    if (!sms) return null

    if (
      sms.identity.identity_type === "unknown" ||
      (sms.identity.identity_type === "vendor" && !sms.identity.vendor_id?.trim())
    ) {
      return {
        templateId: "identity_onboarding",
        confidence: "medium",
        reason: "unknown_or_unlinked_sender",
      }
    }

    return null
  },

  async act(supabase, ctx): Promise<WorkflowActResult> {
    const sms = ctx.sms
    if (!sms) {
      return {
        templateId: "identity_onboarding",
        route: workflowRouteForTemplate("identity_onboarding"),
        metadata: { error: "missing_sms_context" },
      }
    }

    // Unlinked vendor stub — keep a short prompt (not maintenance intake).
    if (
      sms.identity.identity_type === "vendor" &&
      !sms.identity.vendor_id?.trim()
    ) {
      return {
        templateId: "identity_onboarding",
        route: workflowRouteForTemplate("identity_onboarding"),
        replyHint:
          "Hi — this is Ulo. I couldn't match this number to a vendor profile yet. Please reply with your company name, or contact the property team.",
        metadata: {
          onboarding: true,
          vendorUnlinked: true,
        },
      }
    }

    const turn = await processUnknownContactIntakeTurn(supabase, {
      landlordId: ctx.landlordId,
      conversationId: sms.conversationId,
      senderPhone: sms.inbound.from,
      inboundBody: sms.inbound.body,
      identity: sms.identity,
      suggestedUnit: sms.suggestedUnit,
    })

    return {
      templateId: "identity_onboarding",
      route: workflowRouteForTemplate("identity_onboarding"),
      replyHint: turn.replyHint,
      metadata: {
        selfHealed: turn.selfHealingPhase === "resolved",
        onboarding: true,
        resolutionSource: sms.resolutionSource,
        selfHealingPhase: turn.selfHealingPhase,
        suggestedUnit: sms.suggestedUnit,
        continueIntake: turn.continueIntake,
        skipGenericAutoReply: true,
        ...turn.metadata,
      },
    }
  },
}

export const landlordCommandTemplate: WorkflowTemplate = {
  id: "landlord_command",
  name: "Landlord command",
  supportedTriggers: ["sms_inbound"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.sms?.identity.identity_type === "landlord") {
      return {
        templateId: "landlord_command",
        confidence: "high",
        reason: "landlord_identity",
      }
    }
    return null
  },

  async act(_supabase, ctx): Promise<WorkflowActResult> {
    return {
      templateId: "landlord_command",
      route: workflowRouteForTemplate("landlord_command"),
      metadata: {
        bodyPreview: ctx.sms?.inbound.body.slice(0, 160),
      },
    }
  },
}
