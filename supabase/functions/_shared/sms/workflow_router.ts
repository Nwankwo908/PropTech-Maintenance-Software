import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { InboundSMSMessage } from "./types.ts"
import type { SmsIdentityRow } from "./inbound_db.ts"
import type { IdentityResolutionSource, SelfHealingPhase } from "./resolveIdentity.ts"
import { applyVendorStatusTransition, parseVendorSmsReply } from "../vendor_workflow.ts"
import {
  recordVendorRepliedEvent,
  resolveVendorMaintenanceRequestId,
  type VendorStatusTransitionResultMeta,
} from "./vendorSmsRouting.ts"

export type SmsWorkflowRoute =
  | "resident_maintenance_intake"
  | "vendor_response"
  | "landlord_command"
  | "unknown_sender_onboarding"

export type WorkflowContext = {
  inbound: InboundSMSMessage
  landlordId: string
  identity: SmsIdentityRow
  conversationId: string
  messageId: string
  maintenanceRequestId: string | null
  selfHealed: boolean
  continueIntake: boolean
  resolutionSource: IdentityResolutionSource
  selfHealingPhase: SelfHealingPhase
  suggestedUnit: string | null
}

export type WorkflowResult = {
  route: SmsWorkflowRoute
  /** Optional auto-reply body (not sent in v1 — logged for workflow engine). */
  replyHint?: string
  metadata: Record<string, unknown>
}

export function resolveWorkflowRoute(
  identity: SmsIdentityRow,
  continueIntake: boolean,
): SmsWorkflowRoute {
  if (continueIntake) {
    return "resident_maintenance_intake"
  }

  const hasLinkedVendor =
    identity.identity_type === "vendor" && !!identity.vendor_id?.trim()

  switch (identity.identity_type) {
    case "resident":
      return "resident_maintenance_intake"
    case "vendor":
      return hasLinkedVendor ? "vendor_response" : "unknown_sender_onboarding"
    case "landlord":
      return "landlord_command"
    default:
      return "unknown_sender_onboarding"
  }
}

async function handleResidentMaintenanceIntake(
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  console.info("[sms-workflow] resident_maintenance_intake", {
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    maintenanceRequestId: ctx.maintenanceRequestId,
  })

  return {
    route: "resident_maintenance_intake",
    replyHint:
      "Thanks for your message. Ulo received your text and will guide you through maintenance intake.",
    metadata: {
      bodyLength: ctx.inbound.body.length,
      mediaCount: ctx.inbound.mediaUrls.length,
      maintenanceRequestId: ctx.maintenanceRequestId,
    },
  }
}

async function handleVendorResponse(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  if (!ctx.identity.vendor_id?.trim()) {
    console.warn("[sms-workflow] vendor_response blocked — missing vendor_id", {
      conversationId: ctx.conversationId,
      identity_type: ctx.identity.identity_type,
    })
    return handleUnknownSenderOnboarding(ctx)
  }

  const vendorId = ctx.identity.vendor_id.trim()
  const ticketId = await resolveVendorMaintenanceRequestId(supabase, {
    vendorId,
    conversationId: ctx.conversationId,
    conversationMaintenanceRequestId: ctx.maintenanceRequestId,
  })

  const parsedAction = parseVendorSmsReply(ctx.inbound.body)
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
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    maintenanceRequestId: ticketId,
    bodyPreview: ctx.inbound.body,
    parsedAction,
    transition,
  })

  if (ticketId && !ctx.maintenanceRequestId) {
    const { error } = await supabase
      .from("sms_conversations")
      .update({ maintenance_request_id: ticketId })
      .eq("id", ctx.conversationId)
    if (error) {
      console.error("[sms-workflow] link conversation ticket", error.message)
    }
  }

  console.info("[sms-workflow] vendor_response", {
    conversationId: ctx.conversationId,
    vendorId,
    maintenanceRequestId: ticketId,
    parsedAction,
    transition,
  })

  return {
    route: "vendor_response",
    replyHint:
      parsedAction === "accept"
        ? "Thanks — your acceptance was recorded."
        : parsedAction === "decline"
          ? "Thanks — your decline was recorded."
          : ticketId
            ? "Reply ACCEPT or DECLINE for your assigned job."
            : undefined,
    metadata: {
      vendorId,
      maintenanceRequestId: ticketId,
      parsedAction,
      transition,
      bodyPreview: ctx.inbound.body.slice(0, 160),
    },
  }
}

async function handleLandlordCommand(ctx: WorkflowContext): Promise<WorkflowResult> {
  console.info("[sms-workflow] landlord_command", {
    conversationId: ctx.conversationId,
    landlordId: ctx.landlordId,
  })

  return {
    route: "landlord_command",
    metadata: {
      bodyPreview: ctx.inbound.body.slice(0, 160),
    },
  }
}

async function handleUnknownSenderOnboarding(
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  console.info("[sms-workflow] unknown_sender_onboarding", {
    conversationId: ctx.conversationId,
    selfHealed: ctx.selfHealed,
    resolutionSource: ctx.resolutionSource,
    selfHealingPhase: ctx.selfHealingPhase,
    suggestedUnit: ctx.suggestedUnit,
  })

  return {
    route: "unknown_sender_onboarding",
    replyHint:
      ctx.selfHealingPhase === "unresolved"
        ? "We couldn't match your unit. A property manager has been notified."
        : "Hi — this is Ulo Home. Reply with your unit number and a brief description of the maintenance issue.",
    metadata: {
      selfHealed: ctx.selfHealed,
      onboarding: true,
      resolutionSource: ctx.resolutionSource,
      selfHealingPhase: ctx.selfHealingPhase,
      suggestedUnit: ctx.suggestedUnit,
    },
  }
}

/** Routes inbound SMS to the appropriate workflow handler. */
export async function routeInboundSmsWorkflow(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  const route = resolveWorkflowRoute(ctx.identity, ctx.continueIntake)

  console.info("[sms-workflow] route resolved", {
    route,
    identity_type: ctx.identity.identity_type,
    vendor_id: ctx.identity.vendor_id,
    resident_id: ctx.identity.resident_id,
    continue_intake: ctx.continueIntake,
    resolution_source: ctx.resolutionSource,
  })

  switch (route) {
    case "resident_maintenance_intake":
      return handleResidentMaintenanceIntake(ctx)
    case "vendor_response":
      return handleVendorResponse(supabase, ctx)
    case "landlord_command":
      return handleLandlordCommand(ctx)
    case "unknown_sender_onboarding":
      return handleUnknownSenderOnboarding(ctx)
  }
}

export function actorTypeForIdentity(
  identityType: string,
): "resident" | "vendor" | "landlord" | "system" | null {
  switch (identityType) {
    case "resident":
      return "resident"
    case "vendor":
      return "vendor"
    case "landlord":
      return "landlord"
    default:
      return null
  }
}

export function actorIdForIdentity(identity: SmsIdentityRow): string | null {
  if (identity.resident_id) return identity.resident_id
  if (identity.vendor_id) return identity.vendor_id
  return null
}
