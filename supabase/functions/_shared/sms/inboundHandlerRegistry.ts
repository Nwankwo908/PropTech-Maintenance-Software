/**
 * Inbound SMS specialist registry — first match wins (lower priority runs first).
 *
 * ## Four rules (see `.cursor/rules/sms-handler-registry.mdc`)
 *
 * 1. **Atomic** — one inbound message → one domain mutation (+ optional ack).
 * 2. **Pending context** — `{ handled: true }` only when a stored pending ask exists
 *    (global STOP/START/HELP is the sole exception).
 * 3. **Single layer** — when handled, `inbound_processor` returns via `finishHandledInbound`;
 *    workflow engine must not run for the same message. No duplicate logic in templates.
 * 4. **Multi-turn → workflow** — reminders, escalation, and free-text conversations
 *    belong in `runWorkflowEngine()` templates, not here.
 *
 * Governing disambiguation: **STOP and START are global. YES is contextual.**
 *
 * Priority bands:
 *   1–9    Compliance (STOP / START / HELP)
 *  10–29   Active conversation replies (schedule, estimate, invoice, …)
 *  30–39   Tenant activation (YES/NO while waiting; other texts held until then)
 *  40–59   Vendor operations (vendor_reschedule = intent detect + workflow dispatch)
 *  60–79   Special relay (vendor ↔ tenant proxy)
 *  (fallback) tryHandleInterpretedInbound() then routeInboundSmsWorkflow()
 *             in inbound_processor.ts
 */
import { tryHandleInvoicePaymentInbound } from "../invoicePaymentSms.ts"
import { tryHandleVendorFeedbackInbound } from "../vendor_feedback.ts"
import { tryHandleVendorCapacityInbound } from "../vendor_capacity.ts"
import { tryHandleEstimateDecisionInbound } from "./estimateDecisionInbound.ts"
import { tryHandleLandlordRentReceiptInbound } from "./landlordRentReceiptInbound.ts"
import { tryHandleTenantScheduleConfirmInbound } from "./tenantScheduleConfirm.ts"
import {
  tryHandleTenantActivationReply,
  tryHandleTenantComplianceKeyword,
} from "./tenantMessaging.ts"
import { tryHandleTenantActivationHold } from "./tenantActivationPending.ts"
import { relayInboundProxiedMessage } from "./proxiedMessaging.ts"
import { tryHandleVendorRescheduleInbound } from "./vendorRescheduleInbound.ts"
import { tryHandleLandlordVendorChoiceInbound } from "../vendorLandlordChoice.ts"
import {
  canHandleVendorAvailabilityProbe,
  tryHandleVendorAvailabilityProbeInbound,
} from "../vendorAvailabilityProbe.ts"
import type {
  InboundSmsHandler,
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"

async function tryComplianceStopHelpHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleTenantComplianceKeyword(ctx.supabase, {
    body: ctx.inbound.body,
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    provider: ctx.inbound.provider,
    uloNumber: ctx.inbound.to,
    externalPhone: ctx.inbound.from,
    residentId: ctx.identity.resident_id,
    smsIdentityId: ctx.identity.id,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: `tenant_compliance_${result.keyword}`,
    reply: {
      alreadySent: true,
      outboundMessageId: result.outboundMessageId,
      source: `tenant_compliance_${result.keyword}`,
    },
  }
}

async function tryScheduleConfirmHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleTenantScheduleConfirmInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    body: ctx.inbound.body,
    identityType: ctx.identity.identity_type,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "tenant_schedule_confirm",
    maintenanceRequestId: result.ticketId,
    workflowMetadata: {
      action: result.action,
      ticket_id: result.ticketId,
    },
    reply: {
      body: result.replyBody,
      source: `tenant_schedule_${result.action}`,
    },
  }
}

async function tryEstimateDecisionHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleEstimateDecisionInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    body: ctx.inbound.body,
    identityType: ctx.identity.identity_type,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "landlord_estimate_decision",
    workflowMetadata: {
      estimate_id: result.estimateId,
      action: result.action,
      status: result.status,
      already: result.already ?? false,
    },
    reply: {
      body: result.replyBody,
      source: `estimate_decision_${result.action}`,
    },
  }
}

async function tryLandlordVendorChoiceHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleLandlordVendorChoiceInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    body: ctx.inbound.body,
    identityType: ctx.identity.identity_type,
    fromPhone: ctx.inbound.from,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "landlord_vendor_choice",
    maintenanceRequestId: result.ticketId,
    workflowMetadata: {
      vendor_id: result.vendorId,
    },
    reply: {
      body: result.replyBody,
      source: "landlord_vendor_choice",
      skipGenericFallback: true,
    },
  }
}

async function tryVendorAvailabilityProbeHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const { data: conv } = await ctx.supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", ctx.conversationId)
    .maybeSingle()
  if (
    !canHandleVendorAvailabilityProbe({
      identityType: ctx.identity.identity_type,
      intakeState: conv?.intake_state,
    })
  ) {
    return { handled: false }
  }

  const result = await tryHandleVendorAvailabilityProbeInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    body: ctx.inbound.body,
    identityType: ctx.identity.identity_type,
    vendorId: ctx.identity.vendor_id,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "vendor_availability_probe",
    reply: {
      body: result.replyBody,
      source: "vendor_availability_probe",
      skipGenericFallback: true,
    },
  }
}

async function tryLandlordRentReceiptHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleLandlordRentReceiptInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    body: ctx.inbound.body,
    identityType: ctx.identity.identity_type,
    messageId: ctx.messageId,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "landlord_rent_receipt",
    reply: {
      body: result.replyBody,
      source: "landlord_rent_receipt",
    },
  }
}

async function tryInvoicePaymentHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleInvoicePaymentInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    body: ctx.inbound.body,
    fromPhone: ctx.inbound.from,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "invoice_payment",
    workflowMetadata: { preference_reply: true },
    reply: {
      body: result.replyBody,
      source: "invoice_payment_preference",
    },
  }
}

async function tryTenantActivationReplyHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleTenantActivationReply(ctx.supabase, {
    body: ctx.inbound.body,
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    provider: ctx.inbound.provider,
    uloNumber: ctx.inbound.to,
    externalPhone: ctx.inbound.from,
    residentId: ctx.identity.resident_id,
    smsIdentityId: ctx.identity.id,
    identityType: ctx.identity.identity_type,
    conversationType: ctx.conversationType,
    activeMaintenanceIntake: ctx.activeMaintenanceIntake,
  })
  if (!result.handled) return { handled: false }

  const parked = result.resumeParkedRequest
  if (parked?.body) {
    ctx.inbound = {
      ...ctx.inbound,
      body: parked.body,
      mediaUrls: parked.mediaUrls.length > 0 ? parked.mediaUrls : ctx.inbound.mediaUrls,
    }
    ctx.resumeParkedOnboardingRequest = true
    return { handled: false }
  }

  return {
    handled: true,
    workflowRoute: "tenant_activation_reply",
    reply: {
      alreadySent: true,
      outboundMessageId: result.outboundMessageId,
      source: "tenant_activation_reply",
    },
  }
}

async function tryTenantActivationHoldHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleTenantActivationHold(ctx.supabase, {
    body: ctx.inbound.body,
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    provider: ctx.inbound.provider,
    uloNumber: ctx.inbound.to,
    externalPhone: ctx.inbound.from,
    residentId: ctx.identity.resident_id,
    identityType: ctx.identity.identity_type,
    conversationType: ctx.conversationType,
    mediaUrls: ctx.inbound.mediaUrls,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "tenant_activation_hold",
    reply: {
      alreadySent: true,
      outboundMessageId: result.outboundMessageId,
      source: "tenant_activation_hold",
    },
  }
}

async function tryVendorRescheduleHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  if (ctx.identity.identity_type !== "vendor" || !ctx.identity.vendor_id?.trim()) {
    return { handled: false }
  }

  const result = await tryHandleVendorRescheduleInbound(ctx.supabase, ctx)
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "vendor_reschedule",
    maintenanceRequestId: result.ticketId,
    workflowMetadata: result.metadata,
    reply: {
      body: result.replyBody,
      source: "vendor_reschedule",
      skipGenericFallback: true,
    },
  }
}

async function tryVendorCapacityHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleVendorCapacityInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    vendorId: ctx.identity.vendor_id,
    identityType: ctx.identity.identity_type,
    body: ctx.inbound.body,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "vendor_capacity",
    workflowMetadata: {
      capacity_command:
        result.command === "unknown" ? "unknown" : result.command.kind,
    },
    reply: {
      body: result.replyBody,
      source: `vendor_capacity_${result.command === "unknown" ? "unknown" : result.command.kind}`,
    },
  }
}

async function tryVendorFeedbackHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const result = await tryHandleVendorFeedbackInbound(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    body: ctx.inbound.body,
    residentId: ctx.identity.resident_id,
    identityType: ctx.identity.identity_type,
  })
  if (!result.handled) return { handled: false }

  return {
    handled: true,
    workflowRoute: "vendor_feedback",
    maintenanceRequestId: result.maintenanceRequestId,
    workflowMetadata: {
      vendor_feedback_event: result.eventType,
      rating: result.rating,
    },
    reply: {
      body: result.replyBody,
      source: `vendor_feedback_${result.eventType}`,
    },
  }
}

async function tryVendorTenantProxyHandler(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  if (ctx.conversationType !== "vendor_tenant_proxy") {
    return { handled: false }
  }

  const relay = await relayInboundProxiedMessage(ctx.supabase, {
    conversationId: ctx.conversationId,
    inboundMessageId: ctx.messageId,
    inboundFrom: ctx.inbound.from,
    body: ctx.inbound.body,
    mediaUrls: ctx.inbound.mediaUrls,
  })
  console.info("[sms-inbound] vendor_tenant_proxy relay", {
    conversationId: ctx.conversationId,
    inboundMessageId: ctx.messageId,
    relayOk: relay.ok,
    skipped: "skipped" in relay ? relay.skipped : false,
    reason: "reason" in relay ? relay.reason : undefined,
    eventType: relay.ok ? relay.eventType : undefined,
  })

  return {
    handled: true,
    workflowRoute: "vendor_tenant_proxy",
  }
}

/** Documented pending gates — contract tests require every registry id to be listed. */
export const INBOUND_SMS_HANDLER_PENDING_GATES: Readonly<
  Record<string, string>
> = {
  compliance_stop_help:
    "Global STOP/START/HELP keyword (sole exception to pending-context rule)",
  schedule_confirm: "intake_state.awaiting_schedule_confirmation",
  estimate_decision:
    "intake_state.awaiting_estimate_decision or pending estimate on conversation WO",
  landlord_vendor_choice:
    "intake_state.awaiting_vendor_choice on landlord ops thread (YES, or reply 1 / 2 / 3… — roster or nearby external vendors)",
  landlord_rent_receipt:
    "intake_state.awaiting_landlord_rent_receipt, awaiting_landlord_rent_amount, or awaiting_landlord_rent_method (YES/NO/PARTIAL then amount/method)",
  invoice_payment:
    "SMS_ADMIN_NOTIFY phone + recent maintenance.invoice_payment_options_sent event",
  tenant_activation_reply:
    "users.activation_status === waiting + YES or NO",
  tenant_activation_hold:
    "users.activation_status === waiting + any other inbound (park request, remind YES/NO)",
  vendor_availability_probe:
    "intake_state.awaiting_vendor_probe on vendor thread (slot / NO before landlord assigns)",
  vendor_reschedule:
    "Reschedule intent (shouldAttemptVendorRescheduleInbound) → dispatch vendor_job_response workflow",
  vendor_capacity: "Vendor identity + PAUSE / RESUME / JOBS MAX command",
  vendor_feedback:
    "Open vendor_feedback_requests row (two-phase rating/comment exception)",
  vendor_tenant_proxy: "conversation_type === vendor_tenant_proxy",
} as const

export const INBOUND_SMS_HANDLERS: readonly InboundSmsHandler[] = [
  { id: "compliance_stop_help", priority: 5, try: tryComplianceStopHelpHandler },
  { id: "schedule_confirm", priority: 10, try: tryScheduleConfirmHandler },
  { id: "estimate_decision", priority: 20, try: tryEstimateDecisionHandler },
  { id: "landlord_vendor_choice", priority: 21, try: tryLandlordVendorChoiceHandler },
  { id: "landlord_rent_receipt", priority: 22, try: tryLandlordRentReceiptHandler },
  { id: "invoice_payment", priority: 25, try: tryInvoicePaymentHandler },
  {
    id: "tenant_activation_reply",
    priority: 30,
    try: tryTenantActivationReplyHandler,
  },
  {
    id: "tenant_activation_hold",
    priority: 32,
    try: tryTenantActivationHoldHandler,
  },
  {
    id: "vendor_availability_probe",
    priority: 38,
    try: tryVendorAvailabilityProbeHandler,
  },
  { id: "vendor_reschedule", priority: 40, try: tryVendorRescheduleHandler },
  { id: "vendor_capacity", priority: 50, try: tryVendorCapacityHandler },
  { id: "vendor_feedback", priority: 60, try: tryVendorFeedbackHandler },
  { id: "vendor_tenant_proxy", priority: 70, try: tryVendorTenantProxyHandler },
].sort((a, b) => a.priority - b.priority)

export async function tryInboundSmsHandlers(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  for (const handler of INBOUND_SMS_HANDLERS) {
    const result = await handler.try(ctx)
    if (result.handled) return result
  }
  return { handled: false }
}
