import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../../delivery.ts"
import {
  logRentCollectionGraphEvent,
  logRentCollectionLedgerWithGraph,
  rentCollectionGraphScopeFromRun,
  RENT_GRAPH_EVENTS,
  type RentCollectionGraphScope,
} from "../rentCollectionGraph.ts"
import { sendInboundAutoReply } from "../../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../../sms/inbound_db.ts"
import type { SmsProviderName } from "../../sms/types.ts"
import {
  createWorkflowRun,
  findActiveWorkflowRun,
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  runAmountDue,
  runBillingPeriod,
  runConversationId,
  runStepState,
  updateWorkflowRun,
} from "../workflowRuns.ts"
import {
  fetchWorkflowTemplateConfig,
  rentCollectionEscalationDeadline,
  rentCollectionTimingFromConfig,
} from "../templateConfig.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import {
  actRentCollectionPaymentRequest,
  resolveRentPaymentLink,
} from "../rentCollectionPayment.ts"
import {
  buildRentClassificationMetadata,
  classifyRentCollection,
  readRentClassification,
  type RentCollectionClassification,
} from "../rentCollectionClassify.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export type RentCollectionStep =
  | "initiated"
  | "payment_reminder_sent"
  | "awaiting_payment"
  | "payment_intent_recorded"
  | "completed"
  | "late_payment"
  | "escalated"

export type PaymentIntent = "paid" | "partial" | "questions"

export type RentCollectionState = {
  step?: RentCollectionStep
  payment_intent?: PaymentIntent
  classified_intent?: "payment_reminder"
  amount_due?: number
  billing_period?: string
  rent_due_date?: string
  unit_label?: string
  outreach_sent_at?: string
  sms_sent?: boolean
  email_sent?: boolean
  route_channels?: string[]
  payment_link?: string
  payment_requested?: boolean
  payment_provider?: string
  rent_classification?: RentCollectionClassification
  classified_at?: string
  classification_source?: string
}

export function currentBillingPeriod(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export function rentDueDateIso(rentDueDay: number, date = new Date()): string {
  const clampedDay = Math.min(Math.max(rentDueDay, 1), 28)
  const y = date.getFullYear()
  const m = date.getMonth()
  return new Date(y, m, clampedDay).toISOString().slice(0, 10)
}

/** Trigger: rent due date has arrived (today is on or after the configured due day). */
export function isRentDueDateReached(
  rentDueDay: number,
  date = new Date(),
): boolean {
  const clampedDay = Math.min(Math.max(rentDueDay, 1), 28)
  const dueDate = new Date(date.getFullYear(), date.getMonth(), clampedDay)
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return today >= dueDate
}

/** @deprecated Use isRentDueDateReached — kept for callers during transition. */
export function shouldStartRentCollection(
  rentDueDay: number,
  _daysBeforeDue: number,
  date = new Date(),
): boolean {
  return isRentDueDateReached(rentDueDay, date)
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount)
}

function parsePaymentIntent(body: string): PaymentIntent | null {
  const t = body.trim().toLowerCase()
  if (/^(paid|sent|yes|y|payment sent|i paid)\b/.test(t)) return "paid"
  if (/^(partial|part|some)\b/.test(t)) return "partial"
  if (/question|help|talk|call|manager|plan|arrange/.test(t)) return "questions"
  return null
}

export function rentCollectionPrompt(
  state: RentCollectionState,
  paymentLink?: string | null,
): string {
  const amount = state.amount_due != null
    ? formatCurrency(state.amount_due)
    : "your balance"
  const due = state.rent_due_date
    ? new Date(`${state.rent_due_date}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })
    : "today"

  const payLine = paymentLink
    ? ` You can pay online here: ${paymentLink}.`
    : ""

  return (
    `Hi, this is a friendly reminder from your property management team. ` +
    `Your rent of ${amount} is due ${due}.${payLine} ` +
    `Once you've paid, reply PAID. If you paid part of it, reply PARTIAL. ` +
    `Have a question? Reply QUESTIONS and we'll help.`
  )
}

function rentCollectionEmailBody(
  state: RentCollectionState,
  residentName: string,
  paymentLink?: string | null,
): {
  subject: string
  text: string
  html: string
} {
  const amount = state.amount_due != null
    ? formatCurrency(state.amount_due)
    : "your balance"
  const due = state.rent_due_date
    ? new Date(`${state.rent_due_date}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })
    : "this month"
  const subject = `Friendly reminder: rent is due ${due}`
  const payText = paymentLink
    ? `\n\nYou can pay online here: ${paymentLink}`
    : ""
  const payHtml = paymentLink
    ? `<p><a href="${paymentLink}">Pay your rent online</a></p>`
    : ""
  const text =
    `Hi ${residentName},\n\nThis is a friendly reminder from your property management team. ` +
    `Your rent of ${amount} is due ${due}. Please submit your payment when you can.${payText}\n\n` +
    `If you've already paid, reply PAID to your property text line — or reach out anytime and we're happy to help.\n\n` +
    `Thank you,\nYour property management team`
  const html =
    `<p>Hi ${residentName},</p>` +
    `<p>This is a friendly reminder from your property management team. Your rent of <strong>${amount}</strong> is due ${due}. Please submit your payment when you can.</p>` +
    `${payHtml}` +
    `<p>If you've already paid, reply <strong>PAID</strong> to your property text line — or reach out anytime and we're happy to help.</p>` +
    `<p>Thank you,<br/>Your property management team</p>`
  return { subject, text, html }
}

async function logRentCollectionOutcome(
  supabase: SupabaseClient,
  params: {
    scope: RentCollectionGraphScope
    graphEventType: string
    ledgerEventType?: string | null
    ledgerDirection?: "debit" | "credit"
    amount?: number | null
    billingPeriod?: string | null
    description?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await logRentCollectionGraphEvent(supabase, params.scope, {
    eventType: params.graphEventType,
    metadata: params.metadata,
  })

  if (params.ledgerEventType) {
    await logRentCollectionLedgerWithGraph(supabase, params.scope, {
      ledgerEventType: params.ledgerEventType,
      direction: params.ledgerDirection ?? "debit",
      amount: params.amount ?? null,
      billingPeriod: params.billingPeriod ?? null,
      description: params.description ?? null,
      metadata: params.metadata,
    })
  }

  await logPipelineStageEvent(supabase, {
    runId: params.scope.workflowRunId,
    stage: "log",
    message: params.graphEventType,
    metadata: {
      graph_event_type: params.graphEventType,
      ledger_event_type: params.ledgerEventType ?? null,
      ...params.metadata,
    },
  })
}

export const rentCollectionTemplate: WorkflowTemplate = {
  id: "rent_collection",
  name: "Rent collection",
  supportedTriggers: ["cron", "sms_inbound", "dashboard"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.activeRun?.template_id === "rent_collection") {
      return {
        templateId: "rent_collection",
        confidence: "high",
        reason: "active_run",
        runId: ctx.activeRun.id,
      }
    }

    if (ctx.cron?.templateId === "rent_collection") {
      return {
        templateId: "rent_collection",
        confidence: "high",
        reason: "payment_reminder",
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult> {
    if (ctx.trigger === "cron") {
      return processRentDueTrigger(supabase, ctx, intent)
    }

    return processPaymentIntentReply(supabase, ctx, intent)
  },

  async escalate(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    result: WorkflowActResult,
  ): Promise<EscalationResult | null> {
    if (!result.shouldEscalate || !ctx.runId || !ctx.activeRun) return null

    const { escalateRentCollectionRun } = await import("../rentCollectionEscalation.ts")
    const escalation = await escalateRentCollectionRun(supabase, {
      landlordId: ctx.landlordId,
      run: ctx.activeRun,
      reason: result.escalationReason ?? "late_payment_unpaid",
    })

    if (!escalation) return null

    return {
      escalated: true,
      reason: result.escalationReason ?? "late_payment_unpaid",
      metadata: {
        notice_sms_sent: escalation.notice_sms_sent,
        notice_email_sent: escalation.notice_email_sent,
        admin_notified: escalation.admin_notified,
      },
    }
  },
}

type ResidentRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  unit: string | null
  building: string | null
  balance_due: number
}

export type RentCollectionResident = ResidentRow

/** Trigger + classify + route + act (start runs) on rent due date. */
async function processRentDueTrigger(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
): Promise<WorkflowActResult> {
  const templateConfig = await fetchWorkflowTemplateConfig(supabase, "rent_collection")
  const { rentDueDay, latePaymentGraceDays } = rentCollectionTimingFromConfig(
    templateConfig,
    {
      rentDueDay: ctx.cron?.rentDueDay,
      latePaymentGraceDays: ctx.cron?.noResponseDays,
    },
  )
  const landlordId = ctx.landlordId
  const billingPeriod = currentBillingPeriod()
  const rentDueDate = rentDueDateIso(rentDueDay)

  if (!isRentDueDateReached(rentDueDay)) {
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      metadata: {
        classified_intent: intent.reason,
        billing_period: billingPeriod,
        rent_due_day: rentDueDay,
        rent_due_date: rentDueDate,
        skipped: "rent_due_date_not_reached",
        candidates: 0,
        started: 0,
      },
    }
  }

  const { data: residents, error } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit, building, balance_due, status")
    .eq("status", "active")
    .gt("balance_due", 0)

  if (error) {
    console.error("[rent-collection] cron query", error.message)
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      metadata: { error: error.message },
    }
  }

  let started = 0
  let skipped = 0
  let remindersSent = 0

  for (const row of residents ?? []) {
    const resident = row as ResidentRow
    const residentId = String(resident.id)
    const amountDue = Number(resident.balance_due ?? 0)
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
      skipped++
      continue
    }

    const existing = await findActiveWorkflowRun(supabase, {
      landlordId,
      residentId,
      templateId: "rent_collection",
    })

    if (existing && runBillingPeriod(existing) === billingPeriod) {
      skipped++
      continue
    }

    const dueAt = rentCollectionEscalationDeadline(rentDueDate, latePaymentGraceDays)
    const classification = classifyRentCollection({
      balanceDue: amountDue,
      rentDueDate,
    })
    const classificationMeta = buildRentClassificationMetadata(
      classification,
      "balance_and_due_date",
    )
    const initialState: RentCollectionState = {
      step: "initiated",
      classified_intent: "payment_reminder",
      amount_due: amountDue,
      billing_period: billingPeriod,
      rent_due_date: rentDueDate,
      unit_label: resident.unit,
      ...classificationMeta,
    }

    const run = await createWorkflowRun(supabase, {
      templateId: "rent_collection",
      landlordId,
      triggerType: "cron",
      currentStep: "initiated",
      entityType: "user",
      entityId: residentId,
      residentId,
      metadata: {
        amount_due: amountDue,
        billing_period: billingPeriod,
        rent_due_date: rentDueDate,
        due_at: dueAt,
        unit_label: resident.unit,
        building: resident.building,
        classified_intent: "payment_reminder",
        ...classificationMeta,
        step_state: initialState,
      },
    })

    if (!run) continue
    started++

    await logPipelineStageEvent(supabase, {
      runId: run.id,
      stage: "classify",
      step: classification,
      message: `Classified as ${classification}`,
      metadata: {
        rent_classification: classification,
        amount_due: amountDue,
        billing_period: billingPeriod,
      },
    })

    await logRentCollectionOutcome(supabase, {
      scope: {
        landlordId,
        workflowRunId: run.id,
        residentId,
        unitLabel: resident.unit,
        building: resident.building,
      },
      graphEventType: RENT_GRAPH_EVENTS.dueDetected,
      ledgerEventType: "rent_due",
      ledgerDirection: "debit",
      amount: amountDue,
      billingPeriod,
      description: `Rent due for ${billingPeriod}`,
      metadata: {
        rent_due_date: rentDueDate,
        classified_intent: "payment_reminder",
        unit: resident.unit,
        building: resident.building,
      },
    })

    const routed = await executeRentCollectionRouteAndAct(supabase, {
      landlordId,
      resident,
      runId: run.id,
      state: {
        ...initialState,
        step: "awaiting_payment",
      },
    })

    const nextStep = routed.smsSent || routed.emailSent
      ? "payment_reminder_sent"
      : "awaiting_payment"

    await updateWorkflowRun(supabase, run.id, {
      currentStep: nextStep,
      currentStage: routed.smsSent || routed.emailSent ? "routed" : "awaiting_payment",
      metadata: {
        step_state: {
          ...initialState,
          step: nextStep,
          outreach_sent_at: routed.smsSent || routed.emailSent
            ? new Date().toISOString()
            : undefined,
          sms_sent: routed.smsSent,
          email_sent: routed.emailSent,
          route_channels: routed.channels,
          payment_link: routed.paymentLink,
          payment_requested: routed.paymentRequested,
          payment_provider: routed.provider,
        },
        route_channels: routed.channels,
        payment_link: routed.paymentLink,
        payment_requested: routed.paymentRequested,
        payment_provider: routed.provider,
      },
      pipelineStage: "act",
      eventMessage: routed.paymentLink
        ? "Payment reminder sent with payment link"
        : routed.paymentRequested
        ? "Payment requested (no payment provider)"
        : routed.smsSent || routed.emailSent
        ? "Payment reminder sent"
        : "Awaiting payment (no contact channel)",
      eventStep: nextStep,
    })

    if (routed.smsSent || routed.emailSent) remindersSent++
  }

  const { escalateLatePaymentRuns } = await import("../rentCollectionEscalation.ts")
  const escalated = await escalateLatePaymentRuns(supabase, landlordId)

  return {
    templateId: "rent_collection",
    route: workflowRouteForTemplate("rent_collection"),
    metadata: {
      classified_intent: intent.reason,
      billing_period: billingPeriod,
      rent_due_day: rentDueDay,
      rent_due_date: rentDueDate,
      late_payment_grace_days: latePaymentGraceDays,
      template_active: templateConfig?.active ?? true,
      candidates: residents?.length ?? 0,
      started,
      skipped,
      reminders_sent: remindersSent,
      late_payment_escalated: escalated,
    },
  }
}

export type RentCollectionRouteActResult = {
  smsSent: boolean
  emailSent: boolean
  channels: string[]
  paymentLink: string | null
  paymentRequested: boolean
  provider: string | null
}

function graphScopeForRouteAct(params: {
  landlordId: string
  resident: ResidentRow
  runId: string
}): RentCollectionGraphScope {
  return {
    landlordId: params.landlordId,
    workflowRunId: params.runId,
    residentId: String(params.resident.id),
    unitLabel: params.resident.unit,
    building: params.resident.building,
  }
}

/**
 * Route then act for rent collection outreach:
 * - Route: SMS if phone, email if email, both if both
 * - Act: payment link in messages when provider exists, else payment_requested only
 */
export async function executeRentCollectionRouteAndAct(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    resident: ResidentRow
    runId: string
    state: RentCollectionState
  },
): Promise<RentCollectionRouteActResult> {
  const paymentProvider = await resolveRentPaymentLink(supabase, {
    landlordId: params.landlordId,
    residentId: String(params.resident.id),
    runId: params.runId,
    billingPeriod: params.state.billing_period ?? currentBillingPeriod(),
    amountDue: params.state.amount_due ?? 0,
  })

  const graphScope = graphScopeForRouteAct(params)

  const routed = await routeRentCollectionOutreach(supabase, {
    ...params,
    paymentLink: paymentProvider?.paymentLink ?? null,
    graphScope,
  })

  const acted = await actRentCollectionPaymentRequest(supabase, {
    landlordId: params.landlordId,
    runId: params.runId,
    residentId: String(params.resident.id),
    billingPeriod: params.state.billing_period ?? currentBillingPeriod(),
    amountDue: params.state.amount_due ?? 0,
    paymentProvider,
    routeChannels: routed.channels,
    smsSent: routed.smsSent,
    emailSent: routed.emailSent,
    graphScope,
  })

  return {
    smsSent: routed.smsSent,
    emailSent: routed.emailSent,
    channels: routed.channels,
    paymentLink: acted.paymentLink,
    paymentRequested: acted.paymentRequested,
    provider: acted.provider,
  }
}

/** Route: SMS if phone, email if email, both if both. */
async function routeRentCollectionOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    resident: ResidentRow
    runId: string
    state: RentCollectionState
    paymentLink?: string | null
    graphScope: RentCollectionGraphScope
  },
): Promise<{ smsSent: boolean; emailSent: boolean; channels: string[] }> {
  const phone = String(params.resident.phone ?? "").trim()
  const email = String(params.resident.email ?? "").trim()
  const channels: string[] = []
  if (phone) channels.push("sms")
  if (email) channels.push("email")

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "route",
    step: channels.length ? channels.join("_and_") : "no_channels",
    message: channels.length
      ? `Routing via ${channels.join(" and ")}`
      : "No contact channels available",
    metadata: {
      channels,
      has_phone: Boolean(phone),
      has_email: Boolean(email),
      payment_link: params.paymentLink ?? null,
    },
  })

  let smsSent = false
  let emailSent = false

  const mainLine = phone
    ? await lookupLandlordMainNumber(supabase, params.landlordId)
    : null

  if (phone && mainLine) {
    const prompt = rentCollectionPrompt(params.state, params.paymentLink)
    smsSent = await sendRentCollectionSms(supabase, {
      landlordId: params.landlordId,
      residentId: String(params.resident.id),
      phone,
      uloNumber: mainLine.phone,
      smsNumberId: mainLine.id,
      provider: mainLine.provider,
      body: prompt,
      runId: params.runId,
    })
  }

  if (email) {
    const name = params.resident.full_name?.trim() || "Resident"
    const { subject, text, html } = rentCollectionEmailBody(
      params.state,
      name,
      params.paymentLink,
    )
    const result = await sendResendEmail(email, subject, text, html)
    emailSent = !("error" in result)
    if ("error" in result) {
      console.error("[rent-collection] email reminder failed", result.error)
    }
  }

  if (smsSent || emailSent) {
    await logRentCollectionGraphEvent(supabase, params.graphScope, {
      eventType: RENT_GRAPH_EVENTS.reminderSent,
      metadata: {
        sms_sent: smsSent,
        email_sent: emailSent,
        channels,
        amount_due: params.state.amount_due,
        billing_period: params.state.billing_period,
        payment_link: params.paymentLink ?? null,
        notice_type: "payment_reminder",
      },
    })
  }

  return { smsSent, emailSent, channels }
}

/** @deprecated Use executeRentCollectionRouteAndAct */
async function routePaymentReminder(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    resident: ResidentRow
    runId: string
    state: RentCollectionState
  },
): Promise<{ smsSent: boolean; emailSent: boolean }> {
  const result = await executeRentCollectionRouteAndAct(supabase, params)
  return { smsSent: result.smsSent, emailSent: result.emailSent }
}

/** Act: collect payment or record payment intent from resident SMS reply. */
async function processPaymentIntentReply(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
): Promise<WorkflowActResult> {
  const sms = ctx.sms
  if (!sms) {
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      metadata: { error: "missing_sms_context" },
    }
  }

  const residentId = sms.identity.resident_id?.trim()
  if (!residentId) {
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      replyHint:
        "Happy to help with rent — I'll just need your unit number first so I can pull up the right account.",
      metadata: { blocked: "missing_resident_id" },
    }
  }

  let run =
    ctx.activeRun ??
    (intent.runId
      ? null
      : await findActiveWorkflowRun(supabase, {
        landlordId: ctx.landlordId,
        residentId,
        templateId: "rent_collection",
      }))

  if (!run && intent.runId) {
    run = await getWorkflowRunById(supabase, intent.runId)
  }

  if (!run) {
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      metadata: { no_active_run: true },
    }
  }

  ctx.runId = run.id

  const linkedConversationId = runConversationId(run)
  if (linkedConversationId !== sms.conversationId) {
    await linkConversationToWorkflowRun(supabase, {
      conversationId: sms.conversationId,
      runId: run.id,
      templateId: "rent_collection",
    })
  }

  const state = runStepState<RentCollectionState>(run)
  const paymentIntent = parsePaymentIntent(sms.inbound.body)

  if (!paymentIntent) {
    return {
      templateId: "rent_collection",
      route: workflowRouteForTemplate("rent_collection"),
      runId: run.id,
      replyHint:
        "I didn't quite catch that — reply PAID if you've sent payment, PARTIAL for a partial payment, or QUESTIONS to talk with your property manager.",
      metadata: { step: state.step ?? "awaiting_payment", invalid_reply: true },
    }
  }

  const rentDueDate =
    state.rent_due_date ??
    (typeof run.metadata?.rent_due_date === "string" ? run.metadata.rent_due_date : "")
  const classification = classifyRentCollection({
    balanceDue: runAmountDue(run) ?? 0,
    rentDueDate,
    paymentIntent,
    priorClassification: readRentClassification(run.metadata),
    originalAmountDue: state.amount_due ?? runAmountDue(run),
  })
  const classificationMeta = buildRentClassificationMetadata(
    classification,
    "payment_intent",
  )

  const nextState: RentCollectionState = {
    ...state,
    step: "payment_intent_recorded",
    payment_intent: paymentIntent,
    ...classificationMeta,
  }

  const isResolved = paymentIntent === "paid" || paymentIntent === "questions"

  await updateWorkflowRun(supabase, run.id, {
    status: isResolved ? "completed" : "active",
    currentStep: isResolved ? "completed" : "awaiting_payment",
    completedAt: isResolved ? new Date().toISOString() : null,
    metadata: {
      step_state: nextState,
      payment_intent: paymentIntent,
      ...classificationMeta,
    },
    pipelineStage: "classify",
    eventMessage: `Rent classification: ${classification}`,
    eventStep: classification,
  })

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "act",
    step: "payment_intent_recorded",
    message: `Payment intent recorded: ${paymentIntent}`,
    metadata: {
      payment_intent: paymentIntent,
      rent_classification: classification,
    },
  })

  const graphEventType = paymentIntent === "paid" || paymentIntent === "partial"
    ? RENT_GRAPH_EVENTS.paymentReceived
    : null

  if (graphEventType) {
    await logRentCollectionOutcome(supabase, {
      scope: rentCollectionGraphScopeFromRun(run, ctx.landlordId),
      graphEventType,
      ledgerEventType: paymentIntent === "paid"
        ? "rent_payment_reported"
        : paymentIntent === "partial"
        ? "rent_partial_payment_reported"
        : null,
      ledgerDirection: "credit",
      amount: runAmountDue(run),
      billingPeriod: runBillingPeriod(run),
      description: `Resident payment intent: ${paymentIntent}`,
      metadata: {
        payment_intent: paymentIntent,
        rent_classification: classification,
        source: "sms",
        conversation_id: sms.conversationId,
      },
    })
  }

  const replyHint =
    paymentIntent === "paid"
      ? "Thanks — I've noted that you've sent payment. Your property manager will confirm once it's received."
      : paymentIntent === "partial"
      ? "Got it — I've noted a partial payment. Your property manager will follow up on the remaining balance."
      : "Got it — someone from your property team will reach out about your rent."

  return {
    templateId: "rent_collection",
    route: workflowRouteForTemplate("rent_collection"),
    runId: run.id,
    replyHint,
    metadata: { payment_intent: paymentIntent, rent_classification: classification, completed: isResolved },
  }
}

async function lookupLandlordMainNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phone: string; id: string; provider: SmsProviderName } | null> {
  const { data } = await supabase
    .from("sms_numbers")
    .select("id, phone_number, provider")
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (!data?.phone_number || !data?.id) return null

  const provider = (data.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
  return {
    phone: String(data.phone_number).trim(),
    id: String(data.id),
    provider,
  }
}

async function sendRentCollectionSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    uloNumber: string
    body: string
    runId: string
    provider: SmsProviderName
    smsNumberId: string
  },
): Promise<boolean> {
  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: params.phone,
    landlordId: params.landlordId,
    identityType: "resident",
    residentId: params.residentId,
  })

  if (!identity) return false

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: null,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.runId,
    templateId: "rent_collection",
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: params.uloNumber,
    toNumber: params.phone,
    body: params.body,
    provider: params.provider,
    source: "workflow_rent_collection_outreach",
  })

  return sent.ok
}


export {
  escalateLatePaymentRuns,
  escalateLatePaymentRuns as escalateOverdueRentCollections,
} from "../rentCollectionEscalation.ts"
export {
  lookupLandlordMainNumber,
  sendRentCollectionSms,
  routePaymentReminder as sendRentCollectionPaymentReminder,
}
