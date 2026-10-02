/**
 * Tenant PAID / PARTIAL / QUESTIONS on an active rent_collection reminder.
 * Writes unconfirmed ledger rows, asks landlord to confirm (invoice-paid style),
 * and collects missing partial amounts (landlord rent-amount pattern).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  logRentCollectionGraphEvent,
  rentCollectionGraphScopeFromRun,
  RENT_GRAPH_EVENTS,
} from "../engine/rentCollectionGraph.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { resolveLandlordOpsPhones } from "./tenantActivationAdminAlert.ts"
import { smsProviderNameForSend } from "./providerFactory.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import {
  findActiveWorkflowRun,
  getWorkflowRunById,
  runAmountDue,
  runBillingPeriod,
  runStepState,
  updateWorkflowRun,
} from "../engine/workflowRuns.ts"
import type { WorkflowRunRow } from "../engine/types.ts"
import {
  attachFollowUpToRentBillingInquiryTicket,
  createOrBumpRentBillingInquiryTicket,
  isPendingRentBillingInquiryOpen,
  readPendingRentBillingInquiry,
  RENT_QUESTION_FOLLOWUP_ATTACH_MS,
  writePendingRentBillingInquiry,
} from "./rentBillingInquiry.ts"
import {
  buildTenantRentAmountAskSms,
  buildTenantRentCorrectedBalanceSms,
  buildTenantRentQuestionsHandoffSms,
  buildTenantRentReportAckSms,
  checkPartialAmount,
  formatTenantRentAmount,
  parseMoneyAmountFromSms,
  parseTenantRentReply,
  roundRentCents,
  type TenantRentReplyParse,
} from "./tenantRentReplyParse.ts"
import {
  buildTenantRentReportConfirmAckSms,
  buildTenantRentReportConfirmAskSms,
  buildTenantRentReportRejectAckSms,
  canHandleTenantRentReportConfirmation,
  loadConversationIntake,
  parseTenantRentReportConfirmReply,
  persistTenantRentReportConfirmIntake,
  readAwaitingTenantRentReportConfirmation,
  readAwaitingTenantRentReportConfirmations,
  removeAwaitingTenantRentReportConfirmation,
  TENANT_RENT_REPORT_CONFIRM_TTL_MS,
  unclearTenantRentReportConfirmReply,
  upsertAwaitingTenantRentReportConfirmation,
  type AwaitingTenantRentReportConfirmation,
} from "./tenantRentReportConfirmation.ts"

export type AwaitingTenantRentAmount = {
  runId: string
  residentId: string
  amountDue: number
  unitLabel?: string | null
  billingPeriod?: string | null
  askedAt: string
}

const AWAITING_AMOUNT_KEY = "awaiting_tenant_rent_amount"

const ACTIVE_RENT_REPLY_STEPS = new Set([
  "payment_reminder_sent",
  "awaiting_payment",
  "payment_intent_recorded",
])

export function readAwaitingTenantRentAmount(
  intakeState: unknown,
): AwaitingTenantRentAmount | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>)[AWAITING_AMOUNT_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const runId =
    (typeof row.run_id === "string" && row.run_id.trim()) ||
    (typeof row.runId === "string" && row.runId.trim()) ||
    ""
  const residentId =
    (typeof row.resident_id === "string" && row.resident_id.trim()) ||
    (typeof row.residentId === "string" && row.residentId.trim()) ||
    ""
  if (!runId || !residentId) return null
  const amountDueRaw = row.amount_due ?? row.amountDue
  const amountDue =
    typeof amountDueRaw === "number" && Number.isFinite(amountDueRaw)
      ? amountDueRaw
      : typeof amountDueRaw === "string" && amountDueRaw.trim()
      ? Number(amountDueRaw)
      : 0
  return {
    runId,
    residentId,
    amountDue: Number.isFinite(amountDue) ? amountDue : 0,
    unitLabel:
      (typeof row.unit_label === "string" && row.unit_label) ||
      (typeof row.unitLabel === "string" && row.unitLabel) ||
      null,
    billingPeriod:
      (typeof row.billing_period === "string" && row.billing_period) ||
      (typeof row.billingPeriod === "string" && row.billingPeriod) ||
      null,
    askedAt:
      (typeof row.asked_at === "string" && row.asked_at) ||
      (typeof row.askedAt === "string" && row.askedAt) ||
      new Date().toISOString(),
  }
}

export function writeAwaitingTenantRentAmount(
  prior: Record<string, unknown>,
  ask: AwaitingTenantRentAmount | null,
): Record<string, unknown> {
  const next = { ...prior }
  if (!ask) {
    delete next[AWAITING_AMOUNT_KEY]
    return next
  }
  next[AWAITING_AMOUNT_KEY] = {
    run_id: ask.runId,
    resident_id: ask.residentId,
    amount_due: ask.amountDue,
    unit_label: ask.unitLabel ?? null,
    billing_period: ask.billingPeriod ?? null,
    asked_at: ask.askedAt,
  }
  return next
}

function rentRunStep(run: WorkflowRunRow): string {
  const state = runStepState<{ step?: string }>(run)
  const fromState = typeof state.step === "string" ? state.step.trim() : ""
  if (fromState) return fromState
  const fromMeta = typeof run.metadata?.step === "string"
    ? String(run.metadata.step).trim()
    : ""
  if (fromMeta) return fromMeta
  return String(run.current_step ?? "").trim()
}

export function isRentCollectionRunAwaitingTenantReply(run: WorkflowRunRow): boolean {
  if (run.status !== "active") return false
  if (run.template_id !== "rent_collection") return false
  const step = rentRunStep(run)
  if (!step) return true
  return ACTIVE_RENT_REPLY_STEPS.has(step)
}

export async function loadActiveRentCollectionForTenant(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    conversationId?: string | null
  },
): Promise<WorkflowRunRow | null> {
  if (params.conversationId) {
    const linked = await findActiveWorkflowRun(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      templateId: "rent_collection",
    })
    if (linked && isRentCollectionRunAwaitingTenantReply(linked)) return linked
  }
  const byResident = await findActiveWorkflowRun(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    templateId: "rent_collection",
  })
  if (byResident && isRentCollectionRunAwaitingTenantReply(byResident)) {
    return byResident
  }
  return null
}

export function canHandleTenantRentReply(input: {
  identityType: string
  residentId?: string | null
  intakeState: unknown
  hasActiveRentRun: boolean
}): boolean {
  if (input.identityType !== "resident") return false
  if (!input.residentId?.trim()) return false
  if (readAwaitingTenantRentAmount(input.intakeState)) return true
  return input.hasActiveRentRun
}

/**
 * QUESTIONS that are really a repair / emergency / move-out ask should fall
 * through to interpretation. Rent/lease billing questions stay on the
 * rent_billing_inquiry ticket path (including inline asks after QUESTIONS).
 */
export function questionsShouldFallThroughToInterpretation(body: string): boolean {
  const recognition = recognizeInboundIntentSync(body, { freshThread: false })
  if (
    recognition.intent === "repair" ||
    recognition.intent === "emergency" ||
    recognition.intent === "status_check" ||
    recognition.intent === "move_out"
  ) {
    // Bare keyword alone is still a handoff ("QUESTIONS"), not a disguised ask.
    const stripped = body
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/g, "")
      .replace(/\s+/g, " ")
    const bare =
      stripped === "questions" ||
      stripped === "question" ||
      stripped === "help" ||
      stripped === "talk" ||
      stripped === "call" ||
      stripped === "manager"
    return !bare
  }
  return false
}

async function persistResidentIntake(
  supabase: SupabaseClient,
  conversationId: string,
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

async function loadResidentLabel(
  supabase: SupabaseClient,
  residentId: string,
): Promise<{ name: string | null; unit: string | null }> {
  const { data } = await supabase
    .from("users")
    .select("full_name, name, unit")
    .eq("id", residentId)
    .maybeSingle()
  const name =
    (typeof data?.full_name === "string" && data.full_name.trim()) ||
    (typeof data?.name === "string" && data.name.trim()) ||
    null
  const unit = typeof data?.unit === "string" && data.unit.trim()
    ? data.unit.trim()
    : null
  return { name, unit }
}

async function askTenantForPartialAmount(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    prior: Record<string, unknown>
    run: WorkflowRunRow
    residentId: string
    amountDue: number
    reason?: "missing" | "ambiguous" | "not_positive" | "exceeds_balance"
  },
): Promise<string> {
  const unitLabel =
    (typeof params.run.metadata?.unit_label === "string" &&
      params.run.metadata.unit_label) ||
    null
  const ask: AwaitingTenantRentAmount = {
    runId: params.run.id,
    residentId: params.residentId,
    amountDue: params.amountDue,
    unitLabel,
    billingPeriod: runBillingPeriod(params.run),
    askedAt: new Date().toISOString(),
  }
  await persistResidentIntake(
    supabase,
    params.conversationId,
    params.prior,
    writeAwaitingTenantRentAmount(params.prior, ask),
  )
  return buildTenantRentAmountAskSms({
    amountDue: params.amountDue,
    reason: params.reason ?? "missing",
  })
}

async function writeUnconfirmedLedger(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    kind: "paid" | "partial"
    reportedAmount: number
    remainingDue: number
    amountDue: number
    conversationId: string
  },
): Promise<string | null> {
  const scope = rentCollectionGraphScopeFromRun(params.run, params.landlordId)
  const ledgerEventType = params.kind === "paid"
    ? "rent_payment_reported"
    : "rent_partial_payment_reported"

  // Unconfirmed: ledger row only. rent.ledger_updated fires on landlord confirm.
  const { logLedgerEvent } = await import("../engine/ledgerEvents.ts")
  const { resolveRentCollectionGraphScope } = await import(
    "../engine/rentCollectionGraph.ts"
  )
  const resolved = await resolveRentCollectionGraphScope(supabase, scope)
  return await logLedgerEvent(supabase, {
    landlordId: resolved.landlordId,
    workflowRunId: resolved.workflowRunId,
    workflowType: "rent_collection",
    residentId: resolved.residentId,
    unitId: resolved.unitId,
    propertyId: resolved.propertyId,
    eventType: ledgerEventType,
    direction: "credit",
    amount: params.reportedAmount,
    billingPeriod: runBillingPeriod(params.run),
    description: `Tenant-reported ${params.kind} payment (unconfirmed)`,
    metadata: {
      confirmation_status: "unconfirmed",
      source: "tenant_reported",
      payment_intent: params.kind,
      reported_amount: params.reportedAmount,
      amount_due: params.amountDue,
      remaining_due: params.remainingDue,
      conversation_id: params.conversationId,
      message:
        params.kind === "paid"
          ? `Resident reported paying ${formatTenantRentAmount(params.reportedAmount)} (awaiting confirmation).`
          : `Resident reported a partial payment of ${formatTenantRentAmount(params.reportedAmount)} (awaiting confirmation).`,
    },
  })
}

async function notifyLandlordToConfirmReport(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: AwaitingTenantRentReportConfirmation
  },
): Promise<{ sent: boolean; conversationId: string | null }> {
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  const phone = phones[0]
  if (!phone) {
    console.warn("[tenant-rent-reply] no landlord ops phone", params.landlordId)
    return { sent: false, conversationId: null }
  }

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id || !main.phone_number) {
    console.warn("[tenant-rent-reply] no landlord_main SMS number", params.landlordId)
    return { sent: false, conversationId: null }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone,
    identityType: "landlord",
  })
  if (!identity) return { sent: false, conversationId: null }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: null,
    conversationStatus: "open",
  })

  const body = buildTenantRentReportConfirmAskSms(params.ask)
  const providerName = smsProviderNameForSend({
    landlordId: params.landlordId,
    lineProvider: main.provider,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: main.phone_number,
    toNumber: phone,
    body,
    provider: providerName,
    source: "tenant_rent_report_confirmation_ask",
  })

  if (!sent.ok) {
    console.error("[tenant-rent-reply] landlord confirm SMS failed", sent.error)
    return { sent: false, conversationId }
  }

  const prior = await loadConversationIntake(supabase, conversationId)
  await persistTenantRentReportConfirmIntake(
    supabase,
    conversationId,
    upsertAwaitingTenantRentReportConfirmation(prior, params.ask),
  )

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.tenant_payment_report_asked",
    source: "sms",
    actorType: "system",
    residentId: params.ask.residentId,
    workflowRunId: params.ask.runId,
    workflowTemplateId: "rent_collection",
    conversationId,
    metadata: {
      message: `Asked the property team to confirm a tenant-reported rent payment of ${formatTenantRentAmount(params.ask.reportedAmount)}.`,
      reported_amount: params.ask.reportedAmount,
      amount_due: params.ask.amountDue,
      remaining_due: params.ask.remainingDue,
      ledger_event_id: params.ask.ledgerEventId,
      expires_at: params.ask.expiresAt,
    },
  })

  return { sent: true, conversationId }
}

async function applyReportToRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    kind: "paid" | "partial"
    reportedAmount: number
    remainingDue: number
    amountDue: number
  },
): Promise<void> {
  const state = runStepState<Record<string, unknown>>(params.run)
  await updateWorkflowRun(supabase, params.run.id, {
    status: "active",
    currentStep: "awaiting_payment",
    metadata: {
      payment_intent: params.kind,
      tenant_reported_amount: params.reportedAmount,
      tenant_reported_at: new Date().toISOString(),
      tenant_report_confirmation_status: "unconfirmed",
      amount_due: params.remainingDue,
      original_amount_due:
        params.run.metadata?.original_amount_due ?? params.amountDue,
      step_state: {
        ...state,
        step: "payment_intent_recorded",
        payment_intent: params.kind,
        amount_due: params.remainingDue,
      },
    },
    pipelineStage: "act",
    eventMessage: `Tenant reported ${params.kind} payment (unconfirmed)`,
    eventStep: "payment_intent_recorded",
  })
}

async function finalizeTenantReport(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    prior: Record<string, unknown>
    run: WorkflowRunRow
    residentId: string
    kind: "paid" | "partial"
    reportedAmount: number
  },
): Promise<string> {
  const amountDue = roundRentCents(
    runAmountDue(params.run) ??
      (typeof params.run.metadata?.amount_due === "number"
        ? params.run.metadata.amount_due
        : 0),
  )
  const checked = checkPartialAmount(params.reportedAmount, amountDue)
  if (!checked.ok) {
    return await askTenantForPartialAmount(supabase, {
      conversationId: params.conversationId,
      prior: params.prior,
      run: params.run,
      residentId: params.residentId,
      amountDue,
      reason: checked.reason,
    })
  }

  const remainingDue = params.kind === "paid" && params.reportedAmount >= amountDue - 0.001
    ? 0
    : checked.remaining

  await persistResidentIntake(
    supabase,
    params.conversationId,
    params.prior,
    writeAwaitingTenantRentAmount(params.prior, null),
  )

  await applyReportToRun(supabase, {
    run: params.run,
    kind: params.kind,
    reportedAmount: params.reportedAmount,
    remainingDue,
    amountDue,
  })

  const ledgerEventId = await writeUnconfirmedLedger(supabase, {
    landlordId: params.landlordId,
    run: params.run,
    kind: params.kind,
    reportedAmount: params.reportedAmount,
    remainingDue,
    amountDue,
    conversationId: params.conversationId,
  })

  const labels = await loadResidentLabel(supabase, params.residentId)
  const unitLabel =
    labels.unit ||
    (typeof params.run.metadata?.unit_label === "string"
      ? params.run.metadata.unit_label
      : null)
  const now = new Date()
  const ask: AwaitingTenantRentReportConfirmation = {
    runId: params.run.id,
    residentId: params.residentId,
    residentConversationId: params.conversationId,
    ledgerEventId,
    reportedAmount: params.reportedAmount,
    amountDue,
    remainingDue,
    unitLabel,
    residentName: labels.name,
    billingPeriod: runBillingPeriod(params.run),
    kind: params.kind,
    askedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TENANT_RENT_REPORT_CONFIRM_TTL_MS).toISOString(),
  }

  await notifyLandlordToConfirmReport(supabase, {
    landlordId: params.landlordId,
    ask,
  })

  return buildTenantRentReportAckSms({
    kind: params.kind,
    reportedAmount: params.reportedAmount,
    remainingDue,
  })
}

async function handleQuestionsHandoff(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string
    run: WorkflowRunRow | null
    body: string
    messageId?: string | null
    priorIntake: Record<string, unknown>
  },
): Promise<string> {
  const billingPeriod = params.run ? runBillingPeriod(params.run) : null
  const ticket = await createOrBumpRentBillingInquiryTicket(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    conversationId: params.conversationId,
    workflowRunId: params.run?.id ?? null,
    billingPeriod,
    body: params.body,
    messageId: params.messageId,
  })

  const ticketRef = ticket.ok ? ticket.ticketRef : null

  if (ticket.ok) {
    const now = new Date()
    const pending = ticket.awaitingTenantDetail
      ? {
          ticketId: ticket.ticketId,
          ticketRef: ticket.ticketRef,
          createdAt: now.toISOString(),
          attachUntil: new Date(
            now.getTime() + RENT_QUESTION_FOLLOWUP_ATTACH_MS,
          ).toISOString(),
        }
      : null
    await persistResidentIntake(
      supabase,
      params.conversationId,
      params.priorIntake,
      writePendingRentBillingInquiry(params.priorIntake, pending),
    )
  }

  if (params.run) {
    const state = runStepState<Record<string, unknown>>(params.run)
    await updateWorkflowRun(supabase, params.run.id, {
      status: "completed",
      currentStep: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        payment_intent: "questions",
        rent_billing_inquiry_ticket_id: ticket.ok ? ticket.ticketId : null,
        rent_billing_inquiry_ref: ticketRef,
        step_state: {
          ...state,
          step: "payment_intent_recorded",
          payment_intent: "questions",
          rent_billing_inquiry_ticket_id: ticket.ok ? ticket.ticketId : null,
        },
      },
      pipelineStage: "act",
      eventMessage: "Tenant asked questions about rent",
      eventStep: "questions",
    })
  }

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.tenant_questions",
    source: "sms",
    actorType: "resident",
    residentId: params.residentId,
    workflowRunId: params.run?.id ?? null,
    workflowTemplateId: "rent_collection",
    conversationId: params.conversationId,
    metadata: {
      message: ticket.ok
        ? `Resident asked a rent question (${ticket.ticketRef}); property team notified.`
        : "Resident asked a question about rent; property team notified.",
      ticket_id: ticket.ok ? ticket.ticketId : null,
      ticket_ref: ticketRef,
    },
  })

  return buildTenantRentQuestionsHandoffSms(ticketRef)
}

/**
 * Main tenant rent-reply act. Safe for Limited Alpha (payments off) —
 * landlord-confirm is the working path, not a silent drop.
 */
export async function handleTenantRentReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    residentId: string
    messageId?: string | null
  },
): Promise<{ handled: true; replyBody: string } | { handled: false }> {
  if (params.identityType !== "resident") return { handled: false }
  const residentId = params.residentId.trim()
  if (!residentId) return { handled: false }

  const prior = await loadConversationIntake(supabase, params.conversationId)

  // After bare QUESTIONS, attach the next short inbound to the same ticket.
  const pendingInquiry = readPendingRentBillingInquiry(prior)
  if (
    pendingInquiry &&
    isPendingRentBillingInquiryOpen(pendingInquiry) &&
    !parseTenantRentReply(params.body)
  ) {
    const attach = await attachFollowUpToRentBillingInquiryTicket(supabase, {
      ticketId: pendingInquiry.ticketId,
      landlordId: params.landlordId,
      residentId,
      conversationId: params.conversationId,
      body: params.body,
    })
    await persistResidentIntake(
      supabase,
      params.conversationId,
      prior,
      writePendingRentBillingInquiry(prior, null),
    )
    if (attach.ok) {
      return {
        handled: true,
        replyBody: buildTenantRentQuestionsHandoffSms(attach.ticketRef),
      }
    }
  } else if (pendingInquiry && !isPendingRentBillingInquiryOpen(pendingInquiry)) {
    await persistResidentIntake(
      supabase,
      params.conversationId,
      prior,
      writePendingRentBillingInquiry(prior, null),
    )
  }

  const amountAsk = readAwaitingTenantRentAmount(prior)

  // Follow-up: tenant was asked for the dollar amount.
  if (amountAsk) {
    const run = await getWorkflowRunById(supabase, amountAsk.runId)
    if (!run || run.status !== "active") {
      await persistResidentIntake(
        supabase,
        params.conversationId,
        prior,
        writeAwaitingTenantRentAmount(prior, null),
      )
      return { handled: false }
    }

    const money = parseMoneyAmountFromSms(params.body)
    if (money.status === "ambiguous") {
      return {
        handled: true,
        replyBody: await askTenantForPartialAmount(supabase, {
          conversationId: params.conversationId,
          prior,
          run,
          residentId,
          amountDue: amountAsk.amountDue,
          reason: "ambiguous",
        }),
      }
    }
    if (money.status === "none") {
      // Allow re-stating PARTIAL / PAID without amount → re-ask.
      const parsed = parseTenantRentReply(params.body)
      if (parsed?.kind === "questions") {
        if (questionsShouldFallThroughToInterpretation(params.body)) {
          return { handled: false }
        }
        return {
          handled: true,
          replyBody: await handleQuestionsHandoff(supabase, {
            landlordId: params.landlordId,
            conversationId: params.conversationId,
            residentId,
            run,
            body: params.body,
            messageId: params.messageId,
            priorIntake: prior,
          }),
        }
      }
      return {
        handled: true,
        replyBody: await askTenantForPartialAmount(supabase, {
          conversationId: params.conversationId,
          prior,
          run,
          residentId,
          amountDue: amountAsk.amountDue,
          reason: "missing",
        }),
      }
    }

    return {
      handled: true,
      replyBody: await finalizeTenantReport(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior,
        run,
        residentId,
        kind: "partial",
        reportedAmount: money.amount,
      }),
    }
  }

  const run = await loadActiveRentCollectionForTenant(supabase, {
    landlordId: params.landlordId,
    residentId,
    conversationId: params.conversationId,
  })
  if (!run) return { handled: false }

  const parsed = parseTenantRentReply(params.body)
  if (!parsed) return { handled: false }

  if (parsed.kind === "questions") {
    if (questionsShouldFallThroughToInterpretation(params.body)) {
      return { handled: false }
    }
    return {
      handled: true,
      replyBody: await handleQuestionsHandoff(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        residentId,
        run,
        body: params.body,
        messageId: params.messageId,
        priorIntake: prior,
      }),
    }
  }

  const amountDue = roundRentCents(
    runAmountDue(run) ??
      (typeof run.metadata?.amount_due === "number" ? run.metadata.amount_due : 0),
  )

  if (parsed.kind === "paid") {
    const reported = parsed.amountStatus === "ok" && parsed.amount != null
      ? parsed.amount
      : amountDue
    return {
      handled: true,
      replyBody: await finalizeTenantReport(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        prior,
        run,
        residentId,
        kind: "paid",
        reportedAmount: reported,
      }),
    }
  }

  // partial
  if (parsed.amountStatus === "ambiguous") {
    return {
      handled: true,
      replyBody: await askTenantForPartialAmount(supabase, {
        conversationId: params.conversationId,
        prior,
        run,
        residentId,
        amountDue,
        reason: "ambiguous",
      }),
    }
  }
  if (parsed.amountStatus === "missing" || parsed.amount == null) {
    return {
      handled: true,
      replyBody: await askTenantForPartialAmount(supabase, {
        conversationId: params.conversationId,
        prior,
        run,
        residentId,
        amountDue,
        reason: "missing",
      }),
    }
  }

  return {
    handled: true,
    replyBody: await finalizeTenantReport(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      prior,
      run,
      residentId,
      kind: "partial",
      reportedAmount: parsed.amount,
    }),
  }
}

async function markLedgerConfirmed(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: AwaitingTenantRentReportConfirmation
    confirmedAmount: number
    remainingDue: number
    rejected?: boolean
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.ask.runId)
  const scope = run
    ? rentCollectionGraphScopeFromRun(run, params.landlordId)
    : {
      landlordId: params.landlordId,
      workflowRunId: params.ask.runId,
      residentId: params.ask.residentId,
    }

  if (params.ask.ledgerEventId) {
    const { data: existing } = await supabase
      .from("ledger_events")
      .select("metadata")
      .eq("id", params.ask.ledgerEventId)
      .maybeSingle()
    const priorMeta =
      existing?.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {}
    await supabase
      .from("ledger_events")
      .update({
        amount: params.rejected ? 0 : params.confirmedAmount,
        description: params.rejected
          ? "Tenant-reported payment — landlord did not receive"
          : "Tenant-reported payment — landlord confirmed",
        metadata: {
          ...priorMeta,
          confirmation_status: params.rejected ? "rejected" : "confirmed",
          confirmed_amount: params.rejected ? 0 : params.confirmedAmount,
          remaining_due: params.remainingDue,
          confirmed_at: new Date().toISOString(),
          source: "tenant_reported",
          confirmed_by: "landlord",
        },
      })
      .eq("id", params.ask.ledgerEventId)
  }

  if (!params.rejected) {
    await logRentCollectionGraphEvent(supabase, scope, {
      eventType: RENT_GRAPH_EVENTS.ledgerUpdated,
      metadata: {
        ledger_event_id: params.ask.ledgerEventId,
        ledger_event_type: params.ask.kind === "paid"
          ? "rent_payment_reported"
          : "rent_partial_payment_reported",
        confirmation_status: "confirmed",
        amount: params.confirmedAmount,
        remaining_due: params.remainingDue,
        message: `Rent ledger updated: confirmed ${formatTenantRentAmount(params.confirmedAmount)} received.`,
      },
    })
  }

  if (run) {
    const state = runStepState<Record<string, unknown>>(run)
    const complete = params.remainingDue <= 0.001 && !params.rejected
    await updateWorkflowRun(supabase, run.id, {
      status: complete ? "completed" : "active",
      currentStep: complete ? "completed" : "awaiting_payment",
      completedAt: complete ? new Date().toISOString() : null,
      metadata: {
        amount_due: params.rejected
          ? params.ask.amountDue
          : params.remainingDue,
        paid_amount: params.rejected ? 0 : params.confirmedAmount,
        tenant_report_confirmation_status: params.rejected
          ? "rejected"
          : "confirmed",
        rent_status: complete ? "paid" : params.rejected ? "unpaid" : "partial",
        payment_source: "tenant_reported_landlord_confirmed",
        step_state: {
          ...state,
          step: complete ? "completed" : "awaiting_payment",
          amount_due: params.rejected
            ? params.ask.amountDue
            : params.remainingDue,
        },
      },
      pipelineStage: "act",
      eventMessage: params.rejected
        ? "Landlord rejected tenant rent report"
        : "Landlord confirmed tenant rent report",
      eventStep: complete ? "completed" : "awaiting_payment",
    })

    if (!params.rejected) {
      await supabase
        .from("users")
        .update({ balance_due: params.remainingDue })
        .eq("id", params.ask.residentId)
        .eq("landlord_id", params.landlordId)
    }
  }
}

async function notifyTenantOfConfirmedBalance(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ask: AwaitingTenantRentReportConfirmation
    confirmedAmount: number
    remainingDue: number
    corrected: boolean
  },
): Promise<void> {
  if (!params.corrected && params.confirmedAmount === params.ask.reportedAmount) {
    // Tenant already got the "leaves $X due" ack; only text again on correction.
    return
  }

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id || !main.phone_number) return

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("external_phone_number")
    .eq("id", params.ask.residentConversationId)
    .maybeSingle()
  const to = typeof conv?.external_phone_number === "string"
    ? conv.external_phone_number.trim()
    : ""
  if (!to) return

  const body = buildTenantRentCorrectedBalanceSms({
    confirmedAmount: params.confirmedAmount,
    remainingDue: params.remainingDue,
  })
  const providerName = smsProviderNameForSend({
    landlordId: params.landlordId,
    lineProvider: main.provider,
  })
  await sendInboundAutoReply(supabase, {
    conversationId: params.ask.residentConversationId,
    landlordId: params.landlordId,
    fromNumber: main.phone_number,
    toNumber: to,
    body,
    provider: providerName,
    source: "tenant_rent_report_corrected",
  })
}

export async function handleTenantRentReportConfirmationReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    messageId?: string | null
  },
): Promise<
  | { handled: true; replyBody: string; action: string }
  | { handled: false }
> {
  if (params.identityType === "vendor") return { handled: false }

  const prior = await loadConversationIntake(supabase, params.conversationId)
  const pending = readAwaitingTenantRentReportConfirmations(prior)
  if (pending.length === 0) return { handled: false }

  const ask = pending[0]!
  const parsed = parseTenantRentReportConfirmReply(params.body)

  if (parsed.action === "unclear" || parsed.action === "amount_ambiguous") {
    return {
      handled: true,
      replyBody: unclearTenantRentReportConfirmReply(),
      action: "unclear",
    }
  }

  if (parsed.action === "reject") {
    await markLedgerConfirmed(supabase, {
      landlordId: params.landlordId,
      ask,
      confirmedAmount: 0,
      remainingDue: ask.amountDue,
      rejected: true,
    })
    await persistTenantRentReportConfirmIntake(
      supabase,
      params.conversationId,
      removeAwaitingTenantRentReportConfirmation(prior, ask.runId),
    )
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "rent.tenant_payment_report_rejected",
      source: "sms",
      actorType: "landlord",
      residentId: ask.residentId,
      workflowRunId: ask.runId,
      workflowTemplateId: "rent_collection",
      conversationId: params.conversationId,
      metadata: {
        message: `Property team marked the reported ${formatTenantRentAmount(ask.reportedAmount)} as not received.`,
        reported_amount: ask.reportedAmount,
      },
    })
    return {
      handled: true,
      replyBody: buildTenantRentReportRejectAckSms({ unitLabel: ask.unitLabel }),
      action: "reject",
    }
  }

  const confirmedAmount = parsed.action === "confirm"
    ? ask.reportedAmount
    : parsed.amount
  const checked = checkPartialAmount(confirmedAmount, ask.amountDue)
  const remainingDue = checked.ok ? checked.remaining : Math.max(0, ask.amountDue - confirmedAmount)
  const corrected = Math.abs(confirmedAmount - ask.reportedAmount) > 0.001

  await markLedgerConfirmed(supabase, {
    landlordId: params.landlordId,
    ask,
    confirmedAmount,
    remainingDue,
  })

  await persistTenantRentReportConfirmIntake(
    supabase,
    params.conversationId,
    removeAwaitingTenantRentReportConfirmation(prior, ask.runId),
  )

  await notifyTenantOfConfirmedBalance(supabase, {
    landlordId: params.landlordId,
    ask,
    confirmedAmount,
    remainingDue,
    corrected,
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: corrected
      ? "rent.tenant_payment_report_corrected"
      : "rent.tenant_payment_report_confirmed",
    source: "sms",
    actorType: "landlord",
    residentId: ask.residentId,
    workflowRunId: ask.runId,
    workflowTemplateId: "rent_collection",
    conversationId: params.conversationId,
    metadata: {
      message: corrected
        ? `Property team corrected the reported payment to ${formatTenantRentAmount(confirmedAmount)}.`
        : `Property team confirmed ${formatTenantRentAmount(confirmedAmount)} received.`,
      reported_amount: ask.reportedAmount,
      confirmed_amount: confirmedAmount,
      remaining_due: remainingDue,
      ledger_event_id: ask.ledgerEventId,
    },
  })

  return {
    handled: true,
    replyBody: buildTenantRentReportConfirmAckSms({
      confirmedAmount,
      remainingDue,
      unitLabel: ask.unitLabel,
    }),
    action: corrected ? "correct" : "confirm",
  }
}

export {
  canHandleTenantRentReportConfirmation,
  parseTenantRentReply,
  readAwaitingTenantRentReportConfirmation,
  type TenantRentReplyParse,
}
