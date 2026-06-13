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

  async act(_supabase, ctx): Promise<WorkflowActResult> {
    const sms = ctx.sms

    return {
      templateId: "identity_onboarding",
      route: workflowRouteForTemplate("identity_onboarding"),
      replyHint:
        sms?.selfHealingPhase === "unresolved"
          ? "I wasn't able to match that unit. I've let your property manager know — they'll follow up with you."
          : "Hi — this is Ulo. What's your unit number, and what's going on?",
      metadata: {
        selfHealed: sms?.selfHealed,
        onboarding: true,
        resolutionSource: sms?.resolutionSource,
        selfHealingPhase: sms?.selfHealingPhase,
        suggestedUnit: sms?.suggestedUnit,
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
