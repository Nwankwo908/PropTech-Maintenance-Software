import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import {
  logRentCollectionGraphEvent,
  logRentCollectionLedgerWithGraph,
  rentCollectionGraphScopeFromRun,
  RENT_GRAPH_EVENTS,
} from "./rentCollectionGraph.ts"
import { resolveRentPaymentLink } from "./rentCollectionPayment.ts"
import { escalationNotifyEmails } from "./runWorkflowEscalations.ts"
import {
  buildRentClassificationMetadata,
  classifyRentCollection,
  readRentClassification,
} from "./rentCollectionClassify.ts"
import type { WorkflowRunRow } from "./types.ts"
import {
  logPipelineStageEvent,
  logWorkflowEvent,
  runAmountDue,
  runBillingPeriod,
  runStepState,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { RentCollectionState } from "./templates/rentCollection.ts"

export type RentCollectionEscalationResult = {
  workflow_run_id: string
  resident_id: string | null
  notice_sms_sent: boolean
  notice_email_sent: boolean
  admin_notified: string[]
  admin_notify_errors: string[]
}

type ResidentContactRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  unit: string | null
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount)
}

function latePaymentNoticeSms(
  state: RentCollectionState,
  paymentLink?: string | null,
): string {
  const amount = state.amount_due != null
    ? formatCurrency(state.amount_due)
    : "your rent balance"
  const due = state.rent_due_date
    ? new Date(`${state.rent_due_date}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })
    : "the due date"
  const payLine = paymentLink ? ` You can pay here: ${paymentLink}.` : ""
  return (
    `Hi, this is your property management team. Our records show your rent of ` +
    `${amount} was due ${due} and is now past due.${payLine} ` +
    `Please pay as soon as you can. If you need help or would like to set up a ` +
    `payment plan, reply QUESTIONS and we'll work with you.`
  )
}

function latePaymentNoticeEmail(
  state: RentCollectionState,
  residentName: string,
  paymentLink?: string | null,
): { subject: string; text: string; html: string } {
  const amount = state.amount_due != null
    ? formatCurrency(state.amount_due)
    : "your rent balance"
  const due = state.rent_due_date
    ? new Date(`${state.rent_due_date}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })
    : "the due date"
  const subject = "Your rent payment is past due"
  const payText = paymentLink ? `\n\nYou can pay online here: ${paymentLink}` : ""
  const payHtml = paymentLink
    ? `<p><a href="${paymentLink}">Pay your rent online</a></p>`
    : ""
  const text =
    `Hi ${residentName},\n\nThis is your property management team. Our records show your ` +
    `rent of ${amount} was due ${due} and is now past due. Please submit your payment as ` +
    `soon as you can.${payText}\n\n` +
    `If you've already paid, thank you — you can ignore this message. If you need help or ` +
    `would like to set up a payment plan, reply QUESTIONS to your property text line or reach ` +
    `out anytime. We're here to help.\n\n` +
    `Thank you,\nYour property management team`
  const html =
    `<p>Hi ${residentName},</p>` +
    `<p>This is your property management team. Our records show your rent of <strong>${amount}</strong> was due ${due} and is now past due. Please submit your payment as soon as you can.</p>` +
    `${payHtml}` +
    `<p>If you've already paid, thank you — you can ignore this message. If you need help or would like to set up a payment plan, reply <strong>QUESTIONS</strong> to your property text line or reach out anytime. We're here to help.</p>` +
    `<p>Thank you,<br/>Your property management team</p>`
  return { subject, text, html }
}

async function loadResidentContact(
  supabase: SupabaseClient,
  residentId: string | null | undefined,
): Promise<ResidentContactRow | null> {
  if (!residentId) return null

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit")
    .eq("id", residentId)
    .maybeSingle()

  if (error) {
    console.error("[rent-collection-escalation] resident load", error.message)
    return null
  }

  if (!data) return null

  return {
    id: String(data.id),
    full_name: data.full_name == null ? null : String(data.full_name),
    email: data.email == null ? null : String(data.email),
    phone: data.phone == null ? null : String(data.phone),
    unit: data.unit == null ? null : String(data.unit),
  }
}

async function sendLatePaymentNotice(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    resident: ResidentContactRow
    state: RentCollectionState
    paymentLink?: string | null
    graphScope: ReturnType<typeof rentCollectionGraphScopeFromRun>
  },
): Promise<{ smsSent: boolean; emailSent: boolean }> {
  const { lookupLandlordMainNumber, sendRentCollectionSms } = await import(
    "./templates/rentCollection.ts"
  )

  let smsSent = false
  let emailSent = false

  const phone = String(params.resident.phone ?? "").trim()
  const email = String(params.resident.email ?? "").trim()
  const mainLine = phone
    ? await lookupLandlordMainNumber(supabase, params.landlordId)
    : null

  if (phone && mainLine) {
    smsSent = await sendRentCollectionSms(supabase, {
      landlordId: params.landlordId,
      residentId: params.resident.id,
      phone,
      uloNumber: mainLine.phone,
      smsNumberId: mainLine.id,
      provider: mainLine.provider,
      body: latePaymentNoticeSms(params.state, params.paymentLink),
      runId: params.runId,
    })
  }

  if (email) {
    const name = params.resident.full_name?.trim() || "Resident"
    const { subject, text, html } = latePaymentNoticeEmail(
      params.state,
      name,
      params.paymentLink,
    )
    const result = await sendResendEmail(email, subject, text, html)
    emailSent = !("error" in result)
    if ("error" in result) {
      console.error("[rent-collection-escalation] late notice email failed", result.error)
    }
  }

  if (smsSent || emailSent) {
    await logRentCollectionGraphEvent(supabase, params.graphScope, {
      eventType: RENT_GRAPH_EVENTS.reminderSent,
      metadata: {
        sms_sent: smsSent,
        email_sent: emailSent,
        amount_due: params.state.amount_due,
        billing_period: params.state.billing_period,
        payment_link: params.paymentLink ?? null,
        notice_type: "late_payment",
      },
    })
  }

  return { smsSent, emailSent }
}

async function notifyAdminDashboard(
  params: {
    run: WorkflowRunRow
    resident: ResidentContactRow | null
    amountDue: number | null
    billingPeriod: string | null
    reason: string
    noticeSmsSent: boolean
    noticeEmailSent: boolean
  },
): Promise<{ notified: string[]; errors: string[] }> {
  const residentLabel = params.resident?.full_name?.trim() ||
    (params.run.resident_id ? `Resident ${params.run.resident_id.slice(0, 8)}…` : "Unknown resident")
  const unitLabel = params.resident?.unit?.trim() ||
    (typeof params.run.metadata?.unit_label === "string"
      ? params.run.metadata.unit_label
      : "—")
  const amountLabel = params.amountDue != null
    ? formatCurrency(params.amountDue)
    : "—"

  const subject = "[Ulo] Late rent payment escalated"
  const text = [
    "A rent collection workflow was escalated for late payment.",
    "",
    `Workflow run: ${params.run.id}`,
    `Resident: ${residentLabel}`,
    `Unit: ${unitLabel}`,
    `Amount due: ${amountLabel}`,
    params.billingPeriod ? `Billing period: ${params.billingPeriod}` : null,
    `Reason: ${params.reason}`,
    `Late notice SMS: ${params.noticeSmsSent ? "sent" : "not sent"}`,
    `Late notice email: ${params.noticeEmailSent ? "sent" : "not sent"}`,
    "",
    "Review this escalation in the admin Workflows dashboard.",
  ].filter(Boolean).join("\n")

  const html = `<p>A rent collection workflow was escalated for late payment.</p>
<ul>
<li><strong>Workflow run:</strong> ${params.run.id}</li>
<li><strong>Resident:</strong> ${residentLabel}</li>
<li><strong>Unit:</strong> ${unitLabel}</li>
<li><strong>Amount due:</strong> ${amountLabel}</li>
${params.billingPeriod ? `<li><strong>Billing period:</strong> ${params.billingPeriod}</li>` : ""}
<li><strong>Reason:</strong> ${params.reason}</li>
<li><strong>Late notice SMS:</strong> ${params.noticeSmsSent ? "sent" : "not sent"}</li>
<li><strong>Late notice email:</strong> ${params.noticeEmailSent ? "sent" : "not sent"}</li>
</ul>
<p>Review this escalation in the admin <strong>Workflows</strong> dashboard.</p>`

  const notified: string[] = []
  const errors: string[] = []

  for (const email of escalationNotifyEmails()) {
    const result = await sendResendEmail(email, subject, text, html)
    if ("error" in result) {
      errors.push(`${email}: ${result.error}`)
    } else {
      notified.push(email)
    }
  }

  return { notified, errors }
}

/**
 * Escalate one overdue rent_collection run:
 * stage → escalate, late notice, rent.late_escalated, admin notify.
 */
export async function escalateRentCollectionRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    reason?: string
  },
): Promise<RentCollectionEscalationResult | null> {
  const state = runStepState<RentCollectionState>(params.run)
  if (state.payment_intent === "paid") return null
  if (params.run.status !== "active") return null

  const reason = params.reason ?? "unpaid_after_due_date_and_grace_period"
  const rentDueDate =
    state.rent_due_date ??
    (typeof params.run.metadata?.rent_due_date === "string"
      ? params.run.metadata.rent_due_date
      : "")
  const amountDue = runAmountDue(params.run)
  const billingPeriod = runBillingPeriod(params.run)

  const classification = classifyRentCollection({
    balanceDue: amountDue ?? 0,
    rentDueDate,
    priorClassification: readRentClassification(params.run.metadata),
    originalAmountDue: state.amount_due ?? amountDue,
  })
  const classificationMeta = buildRentClassificationMetadata(
    classification,
    "balance_and_due_date",
  )

  const nextState: RentCollectionState = {
    ...state,
    step: "late_payment",
    ...classificationMeta,
  }

  await updateWorkflowRun(supabase, params.run.id, {
    status: "escalated",
    currentStep: "late_payment",
    currentStage: "escalate",
    metadata: {
      escalated_at: new Date().toISOString(),
      escalation_reason: reason,
      ...classificationMeta,
      step_state: nextState,
    },
    pipelineStage: "escalate",
    eventMessage: "Late payment escalated",
    eventStep: "late_payment",
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: params.run.id,
    eventType: RENT_GRAPH_EVENTS.lateEscalated,
    step: "late_payment",
    stage: "escalate",
    message: "Late payment escalated — unpaid after due date and grace period",
    landlordId: params.landlordId,
    workflowType: "rent_collection",
    metadata: {
      reason,
      rent_classification: classification,
      amount_due: amountDue,
      billing_period: billingPeriod,
      rent_due_date: rentDueDate || null,
    },
  })

  const graphScope = rentCollectionGraphScopeFromRun(params.run, params.landlordId)

  await logRentCollectionGraphEvent(supabase, graphScope, {
    eventType: RENT_GRAPH_EVENTS.lateEscalated,
    metadata: {
      reason,
      rent_classification: classification,
      amount_due: amountDue,
      billing_period: billingPeriod,
      rent_due_date: rentDueDate || null,
    },
  })

  await logRentCollectionLedgerWithGraph(supabase, graphScope, {
    ledgerEventType: "rent_late",
    direction: "debit",
    amount: amountDue,
    billingPeriod,
    description: "Late payment escalated — unpaid after grace period",
    metadata: { reason, rent_due_date: rentDueDate || null },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.run.id,
    stage: "escalate",
    step: "late_payment",
    message: "Late payment escalated",
    metadata: {
      reason,
      rent_classification: classification,
    },
  })

  const resident = await loadResidentContact(supabase, params.run.resident_id)
  const paymentProvider = resident
    ? await resolveRentPaymentLink(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      runId: params.run.id,
      billingPeriod: billingPeriod ?? "",
      amountDue: amountDue ?? 0,
    })
    : null

  const notice = resident
    ? await sendLatePaymentNotice(supabase, {
      landlordId: params.landlordId,
      runId: params.run.id,
      resident,
      state: nextState,
      paymentLink: paymentProvider?.paymentLink ?? null,
      graphScope,
    })
    : { smsSent: false, emailSent: false }

  const adminNotify = await notifyAdminDashboard({
    run: params.run,
    resident,
    amountDue,
    billingPeriod,
    reason,
    noticeSmsSent: notice.smsSent,
    noticeEmailSent: notice.emailSent,
  })

  if (adminNotify.errors.length) {
    console.error("[rent-collection-escalation] admin notify failed", {
      workflowRunId: params.run.id,
      errors: adminNotify.errors,
    })
  }

  return {
    workflow_run_id: params.run.id,
    resident_id: params.run.resident_id,
    notice_sms_sent: notice.smsSent,
    notice_email_sent: notice.emailSent,
    admin_notified: adminNotify.notified,
    admin_notify_errors: adminNotify.errors,
  }
}

/** Escalate all overdue rent_collection runs for a landlord. */
export async function escalateLatePaymentRuns(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<number> {
  const { findOverdueRentCollectionRuns } = await import("./workflowRuns.ts")
  const overdue = await findOverdueRentCollectionRuns(supabase, landlordId)
  if (!overdue.length) return 0

  let count = 0
  for (const run of overdue) {
    const result = await escalateRentCollectionRun(supabase, {
      landlordId,
      run,
    })
    if (result) count++
  }

  return count
}
