/**
 * Act on a resolved inbound SMS interpretation (lease, rent, status, …).
 * Explicit confirm is still required before mutating a work order or schedule.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { findActiveWorkflowRun } from "../engine/workflowRuns.ts"
import { resolveRentPaymentLink } from "../engine/rentCollectionPayment.ts"
import { startMoveOutWorkflow } from "../engine/startWorkflow.ts"
import { isRentChargePaidFromRun } from "../paymentSettlement.ts"
import { resolveUnitByIdOrLabel } from "../unitVacancy.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import { sendVendorJobAlert } from "./vendorSmsRouting.ts"
import { findResidentLeaseDocumentUrl } from "./residentLeaseDocument.ts"
import type {
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"
import {
  accessInstructionKind,
  extractWeekdayPreference,
  formatRentDueDayLabel,
  interpretInboundSms,
  parseResidentCalendarDate,
  pendingContextFromIntake,
  shouldHandleInterpretedIntent,
  shouldSkipInboundInterpretation,
  type InboundInterpretation,
  type TenantSmsIntent,
} from "./inboundInterpretation.ts"
import {
  dedupeTicketsByRequestLabel,
  isIdentifiableRequestLabel,
  looksLikeStatusInquiryTicketDescription,
  matchOpenRequests,
  resolveContextualFollowUp,
  ticketFirstLine,
  ticketsSharingRequestLabel,
} from "./inboundContextualFollowUp.ts"
import {
  isAffirmativeReply,
  isNegativeReply,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import { closeWorkOrderCancelledByResident } from "./cancelResidentWorkOrder.ts"
import { releaseMaintenanceIntakePin } from "./residentIntake.ts"
import {
  formatTicketClosedDate,
  historicalClosureLabel,
  isActiveMaintenanceTicketStatus,
  isClosedOrCancelledStatus,
  isHistoricalMaintenanceTicketStatus,
  looksLikeMaintenanceRelatedMessage,
} from "./maintenanceTicketContext.ts"
import { looksLikeBareRepairRequest } from "./resolveMaintenanceWorkIntent.ts"

const TICKET_LOOKUP_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
]

type OpenTicket = {
  id: string
  unit: string | null
  description: string | null
  vendor_work_status: string | null
  scheduled_at: string | null
  scheduled_window_text: string | null
  assigned_vendor_id: string | null
  access_instructions: string | null
  priority: string | null
  issue_category: string | null
  created_at: string | null
  updated_at: string | null
}

function firstName(name: string | null | undefined): string {
  const part = (name ?? "").trim().split(/\s+/)[0]
  return part || "there"
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

function formatLeaseDate(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  const parsed = new Date(`${iso.trim().slice(0, 10)}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function vendorStatusLabel(status: string | null): string {
  const v = (status ?? "").trim().toLowerCase()
  if (v === "pending_accept") return "waiting for the vendor to accept"
  if (v === "accepted") return "accepted by the vendor"
  if (v === "in_progress") return "in progress"
  if (v === "unassigned") return "waiting for a vendor assignment"
  if (v === "completed") return "completed"
  return v || "open"
}

async function loadVendorPhone(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<{ name: string; phone: string | null }> {
  const { data } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", vendorId)
    .maybeSingle()
  const name = typeof data?.name === "string" && data.name.trim()
    ? data.name.trim()
    : "the vendor"
  const phone = typeof data?.phone === "string" && data.phone.trim()
    ? data.phone.trim()
    : null
  return { name, phone }
}

async function notifyVendorOnTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    body: string
  },
): Promise<boolean> {
  const vendor = await loadVendorPhone(supabase, params.vendorId)
  if (!vendor.phone) return false
  const sent = await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: vendor.phone,
    body: params.body,
    landlordId: params.landlordId,
  })
  return sent.ok
}

async function loadIntakeRow(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<SmsIntakeState> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const raw = data?.intake_state
  if (raw && typeof raw === "object") return { ...(raw as SmsIntakeState) }
  return {}
}

async function patchIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
  patch: SmsIntakeState,
): Promise<void> {
  const current = await loadIntakeRow(supabase, conversationId)
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      intake_state: { ...current, ...patch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
  if (error) {
    console.warn("[sms-interpret] intake_state patch failed", error.message)
  }
}

async function loadResidentProfile(
  supabase: SupabaseClient,
  residentId: string,
): Promise<{
  full_name: string | null
  unit: string | null
  move_in_date: string | null
  lease_end_date: string | null
  balance_due: number
  phone: string | null
  monthly_rent: number
  rent_due_day: number
  building: string | null
} | null> {
  const { data } = await supabase
    .from("users")
    .select(
      "full_name, unit, building, move_in_date, lease_end_date, balance_due, phone, monthly_rent, rent_due_day",
    )
    .eq("id", residentId)
    .maybeSingle()
  if (!data) return null
  return {
    full_name: typeof data.full_name === "string" ? data.full_name : null,
    unit: typeof data.unit === "string" ? data.unit : null,
    building: typeof data.building === "string" ? data.building : null,
    move_in_date: typeof data.move_in_date === "string" ? data.move_in_date : null,
    lease_end_date: typeof data.lease_end_date === "string" ? data.lease_end_date : null,
    balance_due: Number(data.balance_due ?? 0) || 0,
    phone: typeof data.phone === "string" ? data.phone : null,
    monthly_rent: Number(data.monthly_rent ?? 0) || 0,
    rent_due_day: Number(data.rent_due_day ?? 0) || 0,
  }
}

async function loadOpenTickets(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationTicketId?: string | null
    draftTicketId?: string | null
    unit?: string | null
    phone?: string | null
  },
): Promise<OpenTicket[]> {
  const ids = [params.conversationTicketId, params.draftTicketId]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))

  const select =
    "id, unit, description, vendor_work_status, scheduled_at, scheduled_window_text, assigned_vendor_id, access_instructions, priority, issue_category, created_at"

  const rows: OpenTicket[] = []
  const seen = new Set<string>()

  const push = (row: Record<string, unknown> | null | undefined) => {
    const id = typeof row?.id === "string" ? row.id : ""
    if (!id || seen.has(id)) return
    seen.add(id)
    rows.push({
      id,
      unit: typeof row.unit === "string" ? row.unit : null,
      description: typeof row.description === "string" ? row.description : null,
      vendor_work_status: typeof row.vendor_work_status === "string"
        ? row.vendor_work_status
        : null,
      scheduled_at: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
      scheduled_window_text: typeof row.scheduled_window_text === "string"
        ? row.scheduled_window_text
        : null,
      assigned_vendor_id: typeof row.assigned_vendor_id === "string"
        ? row.assigned_vendor_id
        : null,
      access_instructions: typeof row.access_instructions === "string"
        ? row.access_instructions
        : null,
      priority: typeof row.priority === "string" ? row.priority : null,
      issue_category: typeof row.issue_category === "string" ? row.issue_category : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
      updated_at: null,
    })
  }

  for (const id of ids) {
    const { data } = await supabase
      .from("maintenance_requests")
      .select(select)
      .eq("id", id)
      .maybeSingle()
    if (data) push(data as Record<string, unknown>)
  }

  // Prefer open tickets by unit/phone even when a cancelled draft id was linked.
  let query = supabase
    .from("maintenance_requests")
    .select(select)
    .eq("landlord_id", params.landlordId)
    .in("vendor_work_status", [...TICKET_LOOKUP_STATUSES])
    .order("created_at", { ascending: false })
    .limit(8)

  if (params.unit?.trim()) {
    query = query.eq("unit", params.unit.trim())
  } else if (params.phone?.trim()) {
    query = query.eq("resident_phone", params.phone.trim())
  } else if (ids.length === 0) {
    return rows
  }

  if (params.unit?.trim() || params.phone?.trim()) {
    const { data } = await query
    for (const row of data ?? []) {
      push(row as Record<string, unknown>)
    }
  }
  return rows
}

async function maybeReleaseIntake(
  supabase: SupabaseClient,
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  intent: TenantSmsIntent,
  escalate: boolean,
): Promise<string | null> {
  if (!activeIntake) return null
  const { runId } = await releaseMaintenanceIntakePin(supabase, {
    landlordId: ctx.landlordId,
    conversationId: ctx.conversationId,
    state: intake,
    runStatus: escalate
      ? "escalated"
      : intent === "maintenance_cancel"
      ? "cancelled"
      : "completed",
    currentStep: escalate ? "handed_off" : `intent_${intent}`,
    reason: `intent_${intent}`,
    lastResidentMessage: ctx.inbound.body.trim().slice(0, 160),
    eventMessage: escalate
      ? "Intake handed off because this text was not a repair."
      : "Intake closed so this text could be handled as a separate request.",
  })
  return runId
}

async function logOutcome(
  ctx: InboundSmsHandlerContext,
  params: {
    eventType: string
    message: string
    workflowRunId?: string | null
    maintenanceRequestId?: string | null
    extra?: Record<string, unknown>
  },
): Promise<void> {
  await recordActivityLog(ctx.supabase, {
    landlordId: ctx.landlordId,
    eventType: params.eventType,
    source: "sms",
    actorType: "resident",
    actorId: ctx.identity.resident_id,
    unitId: ctx.identity.unit_id ?? null,
    residentId: ctx.identity.resident_id,
    maintenanceRequestId: params.maintenanceRequestId ??
      ctx.maintenanceRequestId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    workflowRunId: params.workflowRunId ?? null,
    metadata: {
      message: params.message,
      ...params.extra,
    },
  })
}

function handled(
  route: string,
  body: string,
  extra?: Record<string, unknown>,
): InboundSmsHandlerResult {
  return {
    handled: true,
    workflowRoute: route,
    workflowMetadata: extra,
    reply: {
      body,
      source: route,
      skipGenericFallback: true,
    },
  }
}

async function loadLatestRentRun(
  supabase: SupabaseClient,
  params: { landlordId: string; residentId: string },
) {
  const { data } = await supabase
    .from("workflow_runs")
    .select("id, template_id, status, metadata")
    .eq("landlord_id", params.landlordId)
    .eq("resident_id", params.residentId)
    .eq("template_id", "rent_collection")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.id) return null
  return {
    id: String(data.id),
    template_id: "rent_collection" as const,
    status: String(data.status ?? ""),
    metadata: data.metadata && typeof data.metadata === "object"
      ? data.metadata as Record<string, unknown>
      : {},
  }
}

function preferTicket(tickets: OpenTicket[], ticketId?: string | null): OpenTicket[] {
  const id = ticketId?.trim()
  if (!id) return tickets
  const hit = tickets.find((row) => row.id === id)
  if (!hit) return tickets
  return [hit, ...tickets.filter((row) => row.id !== id)]
}

function shortTicketLabel(ticket: OpenTicket): string {
  const raw = (ticket.description ?? ticket.issue_category ?? "open request").trim()
  const first = raw.split(/[.!\n]/)[0]?.trim() || raw
  return first.length > 48 ? `${first.slice(0, 45)}…` : first
}

function pickOpenTicket(tickets: OpenTicket[]): OpenTicket | null {
  return tickets.find((row) =>
    isActiveMaintenanceTicketStatus(row.vendor_work_status) &&
    isIdentifiableRequestLabel({
      id: row.id,
      description: row.description,
      vendor_work_status: row.vendor_work_status,
      issue_category: row.issue_category,
    })
  ) ?? tickets.find((row) => isActiveMaintenanceTicketStatus(row.vendor_work_status)) ??
    null
}

function pickCompletedTicket(tickets: OpenTicket[]): OpenTicket | null {
  return tickets.find((row) =>
    (row.vendor_work_status ?? "").toLowerCase() === "completed"
  ) ?? null
}

function pickHistoricalTicket(tickets: OpenTicket[]): OpenTicket | null {
  return tickets.find((row) =>
    isHistoricalMaintenanceTicketStatus(row.vendor_work_status) &&
    isIdentifiableRequestLabel({
      id: row.id,
      description: row.description,
      vendor_work_status: row.vendor_work_status,
      issue_category: row.issue_category,
    })
  ) ?? tickets.find((row) =>
    isHistoricalMaintenanceTicketStatus(row.vendor_work_status)
  ) ?? null
}

function pickCancellableTicket(tickets: OpenTicket[]): OpenTicket | null {
  return tickets.find((row) => {
    if (looksLikeStatusInquiryTicketDescription(row.description)) return false
    return isActiveMaintenanceTicketStatus(row.vendor_work_status)
  }) ?? null
}

function closedDateFromTicket(ticket: OpenTicket): string | null {
  const noteMatch = (ticket.description ?? "").match(
    /closed this request over text on (\d{4}-\d{2}-\d{2})/i,
  )
  if (noteMatch?.[1]) return formatTicketClosedDate(`${noteMatch[1]}T12:00:00Z`)
  return formatTicketClosedDate(ticket.updated_at ?? null)
}

function repairLabelForConfirm(ticket: OpenTicket): string {
  const label = shortTicketLabel(ticket)
  if (label && label.toLowerCase() !== "open request") return label
  return formatWorkOrderRef(ticket.id)
}

async function handleLeaseInfo(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  residentId: string,
  topic: string,
): Promise<InboundSmsHandlerResult> {
  const profile = await loadResidentProfile(ctx.supabase, residentId)
  const start = formatLeaseDate(profile?.move_in_date)
  const end = formatLeaseDate(profile?.lease_end_date)
  const monthly = profile?.monthly_rent ?? 0
  const dueLabel = profile?.rent_due_day
    ? formatRentDueDayLabel(profile.rent_due_day)
    : null
  const who = firstName(profile?.full_name)
  const askedCopy = topic === "lease_copy"
  // Never look up / attach a PDF for date-only asks — wrong-tenant risk.
  const documentUrl = askedCopy
    ? await findResidentLeaseDocumentUrl(ctx.supabase, {
      landlordId: ctx.landlordId,
      fullName: profile?.full_name ?? null,
      unit: profile?.unit ?? null,
    })
    : null
  const hasInfo = Boolean(start || end || monthly > 0)
  const attachedCopy = askedCopy && Boolean(documentUrl)
  const missing = !hasInfo && !attachedCopy
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "lease_info",
    missing,
  )

  const lines = [
    `Hi ${who},`,
    "",
    "This is the property management team.",
    "",
  ]
  if (start && end) {
    lines.push(`Your lease started ${start} and ends ${end}.`)
  } else if (end) {
    lines.push(`Your lease ends ${end}.`)
  } else if (start) {
    lines.push(`Your lease started ${start}.`)
  }
  if (monthly > 0) {
    lines.push(`Your current rent is ${formatMoney(monthly)} per month.`)
  }
  if (dueLabel) {
    lines.push(`Rent is due ${dueLabel}.`)
  }
  // Only attach a PDF when they asked for a copy, and only after a confident
  // identity match. Date questions stay dates-only — never guess another tenant's file.
  if (askedCopy && documentUrl) {
    lines.push("Here's a copy of your lease:")
    lines.push(documentUrl)
  } else if (askedCopy && hasInfo) {
    lines.push(
      "I don't have the lease file on this thread, but the details above are what's on file. Reply here if you need anything else.",
    )
  }

  if (missing) {
    lines.push(
      "I don't have your lease details on file yet. I've let the property team know so they can follow up here.",
    )
    void notifyLandlordNeedsAttention(ctx.supabase, {
      landlordId: ctx.landlordId,
      kind: "lease_info_missing",
      headline: "Leasing information is missing",
      detail: `${profile?.full_name ?? "A resident"} asked about their lease over text, and no lease dates or document were on file.`,
      idempotencyKey: `lease_info_missing:${residentId}`,
      residentId,
      unitId: ctx.identity.unit_id ?? null,
      workflowRunId: runId,
    })
  }

  await logOutcome(ctx, {
    eventType: missing ? "sms.lease_info_missing" : "lease.info_answered",
    message: missing
      ? "Resident asked about their lease; no lease information was on file, so the property team was notified."
      : attachedCopy
      ? "Shared lease details and a copy of the lease over text."
      : "Shared lease details with the resident over text.",
    workflowRunId: runId,
    extra: {
      topic,
      has_lease_dates: Boolean(start || end),
      has_monthly_rent: monthly > 0,
      document_link_included: attachedCopy,
    },
  })

  return handled("sms_lease_info", lines.join("\n"))
}

async function handleRentBalance(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  residentId: string,
  topic: string,
  interpretation?: InboundInterpretation,
): Promise<InboundSmsHandlerResult> {
  const profile = await loadResidentProfile(ctx.supabase, residentId)
  const who = firstName(profile?.full_name)

  if (intake.awaiting_rent_balance_clarify === true) {
    if (isAffirmativeReply(ctx.inbound.body) || interpretation?.pendingAnswer === "yes") {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_rent_balance_clarify: false,
      })
      intake.awaiting_rent_balance_clarify = false
      // Fall through to balance answer.
    } else if (isNegativeReply(ctx.inbound.body) || interpretation?.pendingAnswer === "no") {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_rent_balance_clarify: false,
      })
      return handled(
        "sms_rent_balance_clarify",
        `Hi ${who},\n\nThis is the property management team.\n\nGot it — I won't pull your rent balance. Reply here with what you need and the team can help.`,
      )
    } else {
      return handled(
        "sms_rent_balance_clarify",
        `Hi ${who},\n\nThis is the property management team.\n\nAre you asking about your rent balance?\n\nReply YES or NO.`,
      )
    }
  } else if (interpretation?.extractedSlots.needs_rent_clarify === "true") {
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_rent_balance_clarify: true,
    })
    await logOutcome(ctx, {
      eventType: "sms.rent_balance_clarify",
      message: "Asked whether the resident meant their rent balance.",
    })
    return handled(
      "sms_rent_balance_clarify",
      `Hi ${who},\n\nThis is the property management team.\n\nAre you asking about your rent balance?\n\nReply YES or NO.`,
    )
  }

  const balance = profile?.balance_due ?? 0
  const monthly = profile?.monthly_rent ?? 0
  const dueLabel = profile?.rent_due_day
    ? formatRentDueDayLabel(profile.rent_due_day)
    : null
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "rent_balance",
    false,
  )

  const rentRun = await findActiveWorkflowRun(ctx.supabase, {
    landlordId: ctx.landlordId,
    residentId,
    templateId: "rent_collection",
  })
  const latestRun = rentRun ?? await loadLatestRentRun(ctx.supabase, {
    landlordId: ctx.landlordId,
    residentId,
  })

  let payLink: string | null = null
  const amountDue = typeof rentRun?.metadata?.amount_due === "number"
    ? rentRun.metadata.amount_due
    : balance
  const billingPeriod = typeof rentRun?.metadata?.billing_period === "string"
    ? rentRun.metadata.billing_period
    : ""
  const wantsLink = topic !== "monthly_rent" && topic !== "due_date"
  if (wantsLink && rentRun?.id && billingPeriod && amountDue > 0) {
    const provider = await resolveRentPaymentLink(ctx.supabase, {
      landlordId: ctx.landlordId,
      residentId,
      runId: rentRun.id,
      billingPeriod,
      amountDue,
      residentName: profile?.full_name,
      unitLabel: profile?.unit,
    })
    payLink = provider?.paymentLink ?? null
  }

  const lines = [
    `Hi ${who},`,
    "",
    "This is the property management team.",
    "",
  ]

  if (topic === "payment_status") {
    const settlement = isRentChargePaidFromRun(latestRun)
    if (settlement.paid && settlement.source === "resident_reported") {
      lines.push(
        "You told us payment was sent, but we haven't confirmed it on our side yet. The property team will follow up here.",
      )
    } else if (settlement.paid) {
      lines.push("Yes — we have your rent payment on file.")
    } else if (balance > 0) {
      lines.push(
        `I don't see a confirmed payment yet. Your current balance is ${formatMoney(balance)}.`,
      )
      if (payLink) {
        lines.push("You can pay here:")
        lines.push(payLink)
      }
    } else {
      lines.push("I don't see a balance due on your account right now.")
    }
  } else if (topic === "monthly_rent") {
    if (monthly > 0) {
      lines.push(`Your current rent is ${formatMoney(monthly)} per month.`)
    } else {
      lines.push("I don't have your monthly rent amount on file yet.")
    }
    if (dueLabel) lines.push(`Rent is due ${dueLabel}.`)
  } else if (topic === "due_date") {
    if (dueLabel) lines.push(`Rent is due ${dueLabel}.`)
    else lines.push("I don't have a rent due date on file yet.")
    if (balance > 0) {
      lines.push(`Your current balance is ${formatMoney(balance)}.`)
    }
  } else if (topic === "payment_link") {
    if (payLink) {
      lines.push("Here's your rent payment link:")
      lines.push(payLink)
    } else if (balance > 0) {
      lines.push(
        `Your current balance is ${formatMoney(balance)}. I don't have an online pay link ready, so the property team can help you pay.`,
      )
    } else {
      lines.push("I don't see a balance due, so there's no payment link to send right now.")
    }
  } else if (balance > 0) {
    lines.push(`Your current balance is ${formatMoney(balance)}.`)
    if (dueLabel) lines.push(`Rent is due ${dueLabel}.`)
    if (payLink) {
      lines.push("You can pay here:")
      lines.push(payLink)
    } else {
      lines.push(
        "Your property team can help if you have questions about this balance.",
      )
    }
  } else {
    lines.push(
      "I don't see a balance due on your account right now. Reply here if that doesn't look right.",
    )
    if (dueLabel) lines.push(`Rent is due ${dueLabel}.`)
  }

  await logOutcome(ctx, {
    eventType: topic === "payment_status"
      ? "sms.rent_payment_status_answered"
      : "sms.rent_balance_answered",
    message: topic === "payment_status"
      ? "Checked actual rent payment status for the resident over text."
      : `Shared rent details (${topic || "balance"}) with the resident over text.`,
    workflowRunId: runId ?? latestRun?.id ?? null,
    extra: {
      topic,
      balance_due: balance,
      monthly_rent: monthly,
      payment_link_included: Boolean(payLink),
    },
  })

  return handled("sms_rent_balance", lines.join("\n"))
}

async function handleMaintenanceStatus(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  tickets: OpenTicket[],
  residentName: string | null,
  preferredTicketId?: string | null,
  interpretation?: InboundInterpretation,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "maintenance_status",
    false,
  )
  const ranked = preferTicket(tickets, preferredTicketId)
  const active = pickOpenTicket(ranked)
  const historicalPreferred =
    interpretation?.extractedSlots.historical === "true" ||
    (!active && isClosedOrCancelledStatus(ranked[0]?.vendor_work_status))
  const ticket = active ??
    (historicalPreferred
      ? (pickHistoricalTicket(ranked) ?? ranked[0] ?? null)
      : null)
  const vendor = ticket?.assigned_vendor_id &&
      isActiveMaintenanceTicketStatus(ticket.vendor_work_status)
    ? (await loadVendorPhone(ctx.supabase, ticket.assigned_vendor_id)).name
    : null
  const when = ticket && isActiveMaintenanceTicketStatus(ticket.vendor_work_status)
    ? (ticket.scheduled_window_text?.trim() ||
      (ticket.scheduled_at
        ? new Date(ticket.scheduled_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
        : null))
    : null

  const lines = [
    `Hi ${who},`,
    "",
    "This is the property management team.",
    "",
  ]
  if (!ticket) {
    lines.push(
      "I don't see an open repair for your unit right now. If something needs fixing, text a short description anytime.",
    )
  } else if (isClosedOrCancelledStatus(ticket.vendor_work_status)) {
    const label = repairLabelForConfirm(ticket)
    const closedOn = closedDateFromTicket(ticket)
    const closure = historicalClosureLabel(ticket.vendor_work_status)
    if (closedOn) {
      lines.push(
        `Your ${label} was marked ${closure} on ${closedOn}. Is the problem happening again?`,
      )
    } else {
      lines.push(
        `Your previous ${label} is already ${closure}. Is the problem happening again?`,
      )
    }
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_ticket_update_confirm: true,
      pending_ticket_update_id: ticket.id,
      pending_ticket_update_text: "Resident said the problem is happening again.",
      pending_ticket_update_kind: "reopen",
      pending_ticket_update_media: [],
    })
  } else {
    const wo = formatWorkOrderRef(ticket.id)
    if (when) {
      lines.push(`The visit for ${wo} is set for ${when}.`)
      if (vendor) lines.push(`${vendor} is assigned to this job.`)
    } else if (vendor) {
      lines.push(
        `Your repair (${wo}) is assigned to ${vendor}. A visit hasn't been scheduled yet — I'll text you when a time is confirmed.`,
      )
    } else {
      lines.push(`A visit time hasn't been set yet for ${wo}.`)
      lines.push("We're lining up a technician and will text you when a visit time is set.")
    }
  }

  await logOutcome(ctx, {
    eventType: "sms.maintenance_status_answered",
    message: ticket
      ? `Shared the status of ${formatWorkOrderRef(ticket.id)} with the resident.`
      : "Resident asked for a repair update; no open work order was on file.",
    workflowRunId: runId,
    maintenanceRequestId: ticket?.id ?? null,
  })

  return handled("sms_maintenance_status", lines.join("\n"), {
    maintenance_request_id: ticket?.id ?? null,
  })
}

async function handleMaintenanceUpdate(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  interpretation: InboundInterpretation,
  tickets: OpenTicket[],
  residentName: string | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const ranked = preferTicket(tickets, interpretation.extractedSlots.ticket_id)

  // RELATED vs SEPARATE — same-trade symptom that might be a new problem.
  if (intake.awaiting_related_confirm === true) {
    const pendingId = intake.pending_related_ticket_id?.trim()
    const ticket = (pendingId
      ? ranked.find((row) => row.id === pendingId)
      : null) ?? pickOpenTicket(ranked) ?? ranked[0] ?? null
    const relatedText = (intake.pending_related_text ?? ctx.inbound.body).trim()
    if (
      isAffirmativeReply(ctx.inbound.body) ||
      interpretation.pendingAnswer === "yes" ||
      /^(related|same|existing)\b/i.test(ctx.inbound.body.trim()) ||
      /\b(that one|the same)\b/i.test(ctx.inbound.body)
    ) {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_related_confirm: false,
        pending_related_ticket_id: undefined,
        pending_related_text: undefined,
      })
      if (!ticket) return { handled: false }
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        ticket_id: ticket.id,
        update: relatedText.slice(0, 240),
        kind: "update",
        needs_related_clarify: "false",
      }
      interpretation.intent = "maintenance_update"
      // Ask YES to attach — same path as an ordinary update.
      intake.awaiting_related_confirm = false
      intake.awaiting_ticket_update_confirm = false
    } else if (
      /^(n|no|nope|nah)([.!?\s]|$)/i.test(ctx.inbound.body.trim()) ||
      interpretation.pendingAnswer === "no" ||
      /^(separate|different|new)\b/i.test(ctx.inbound.body.trim()) ||
      /\b(separate problem|different (issue|problem)|new (issue|problem|request))\b/i
        .test(ctx.inbound.body)
    ) {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_related_confirm: false,
        pending_related_ticket_id: undefined,
        pending_related_text: undefined,
      })
      interpretation.intent = "maintenance_new"
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        contextual_action: "new_issue",
      }
      await logOutcome(ctx, {
        eventType: "sms.maintenance_related_clarified_separate",
        message: "Resident said the new symptom is a separate problem.",
        maintenanceRequestId: ticket?.id ?? null,
      })
      return { handled: false, interpretation }
    } else {
      // Tenant didn't answer RELATED/SEPARATE — if the new text is unrelated,
      // the breakout path above should have cleared this. Re-ask only when the
      // pending ticket is still a real active repair.
      const pendingTicket = ticket && isIdentifiableRequestLabel({
        id: ticket.id,
        description: ticket.description,
        vendor_work_status: ticket.vendor_work_status,
        issue_category: ticket.issue_category,
      }) && isActiveMaintenanceTicketStatus(ticket.vendor_work_status)
        ? ticket
        : null
      if (!pendingTicket) {
        await patchIntakeState(ctx.supabase, ctx.conversationId, {
          awaiting_related_confirm: false,
          pending_related_ticket_id: undefined,
          pending_related_text: undefined,
        })
        return { handled: false }
      }
      return handled(
        "sms_maintenance_related_clarify",
        [
          `Hi ${who},`,
          "",
          "This is the property management team.",
          "",
          `Is this related to your existing request (${shortTicketLabel(pendingTicket)}), or a separate problem?`,
          "",
          "Reply RELATED or SEPARATE.",
        ].join("\n"),
      )
    }
  }

  if (interpretation.extractedSlots.needs_related_clarify === "true") {
    const ticket = pickOpenTicket(ranked)
    if (!ticket) return { handled: false }
    const updateText = (
      interpretation.extractedSlots.update?.trim() ||
      ctx.inbound.body.trim()
    ).slice(0, 500)
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_related_confirm: true,
      pending_related_ticket_id: ticket.id,
      pending_related_text: updateText,
      awaiting_ticket_update_confirm: false,
      pending_ticket_update_id: undefined,
    })
    await logOutcome(ctx, {
      eventType: "sms.maintenance_related_clarify",
      message: `Asked whether a new symptom belongs with ${formatWorkOrderRef(ticket.id)}.`,
      maintenanceRequestId: ticket.id,
    })
    return handled(
      "sms_maintenance_related_clarify",
      [
        `Hi ${who},`,
        "",
        "This is the property management team.",
        "",
        `Is this related to your existing ${shortTicketLabel(ticket)}, or would you like to report it as a separate problem?`,
        "",
        "Reply RELATED or SEPARATE.",
      ].join("\n"),
    )
  }

  const slotKind = interpretation.extractedSlots.kind
  const kind = intake.pending_ticket_update_kind ??
    (slotKind === "reopen" || slotKind === "worse" || slotKind === "no_show" ||
        slotKind === "correction" || slotKind === "photo"
      ? slotKind
      : "update")
  const pendingId = intake.pending_ticket_update_id
  const ticket = intake.awaiting_ticket_update_confirm && pendingId
    ? ranked.find((row) => row.id === pendingId) ?? ranked[0] ?? null
    : kind === "reopen"
    ? (pickHistoricalTicket(ranked) ?? pickCompletedTicket(ranked) ??
      pickOpenTicket(ranked) ?? null)
    : (pickOpenTicket(ranked) ?? null)

  if (intake.awaiting_ticket_update_confirm && ticket) {
    if (isAffirmativeReply(ctx.inbound.body) || interpretation.pendingAnswer === "yes") {
      const note = (intake.pending_ticket_update_text ?? ctx.inbound.body).trim()
      const applyKind = intake.pending_ticket_update_kind ?? kind
      const nextDescription = [ticket.description?.trim(), note].filter(Boolean).join("\n\n")
      const patch: Record<string, unknown> = { description: nextDescription }
      if (applyKind === "worse") {
        const current = (ticket.priority ?? "").toLowerCase()
        if (current !== "emergency" && current !== "critical") {
          patch.priority = "urgent"
        }
      }
      if (applyKind === "reopen") {
        const status = (ticket.vendor_work_status ?? "").toLowerCase()
        if (status === "completed" || status === "cancelled") {
          patch.vendor_work_status = ticket.assigned_vendor_id ? "accepted" : "unassigned"
          patch.priority = "urgent"
        }
      }
      const pendingMedia = (intake.pending_ticket_update_media ?? []).filter((url) =>
        typeof url === "string" && url.trim()
      )
      if (pendingMedia.length > 0) {
        const { data: current } = await ctx.supabase
          .from("maintenance_requests")
          .select("photo_paths")
          .eq("id", ticket.id)
          .maybeSingle()
        const existing = Array.isArray(current?.photo_paths)
          ? (current.photo_paths as unknown[]).filter((item): item is string =>
            typeof item === "string" && item.trim().length > 0
          )
          : []
        const seen = new Set(existing)
        const next = [...existing]
        for (const url of pendingMedia) {
          const path = url.trim()
          if (!path || seen.has(path)) continue
          seen.add(path)
          next.push(path)
        }
        patch.photo_paths = next.slice(0, 24)
      }
      await ctx.supabase
        .from("maintenance_requests")
        .update(patch)
        .eq("id", ticket.id)
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_ticket_update_confirm: false,
        pending_ticket_update_id: undefined,
        pending_ticket_update_text: undefined,
        pending_ticket_update_kind: undefined,
        pending_ticket_update_media: undefined,
      })
      const notifyVendor = ticket.assigned_vendor_id &&
        (applyKind === "reopen" || applyKind === "worse" || applyKind === "no_show")
      if (notifyVendor && ticket.assigned_vendor_id) {
        const wo = formatWorkOrderRef(ticket.id)
        const vendorBody = applyKind === "reopen"
          ? `Hi, this is the property management team.\n\nUpdate for work order ${wo}.\n\nThe resident said the repair wasn't fixed. Please follow up on this job.\n\n${note.slice(0, 200)}`
          : applyKind === "no_show"
          ? `Hi, this is the property management team.\n\nUpdate for work order ${wo}.\n\nThe resident said nobody showed up for the visit. Please follow up.\n\n${note.slice(0, 200)}`
          : `Hi, this is the property management team.\n\nUpdate for work order ${wo}.\n\nThe resident said the issue is getting worse.\n\n${note.slice(0, 200)}`
        await notifyVendorOnTicket(ctx.supabase, {
          landlordId: ctx.landlordId,
          ticketId: ticket.id,
          vendorId: ticket.assigned_vendor_id,
          body: vendorBody,
        })
        void notifyLandlordNeedsAttention(ctx.supabase, {
          landlordId: ctx.landlordId,
          kind: "workflow_escalated",
          headline: applyKind === "reopen"
            ? "Resident said a repair wasn't fixed"
            : applyKind === "no_show"
            ? "Resident said the vendor never showed up"
            : "Resident said a repair is getting worse",
          detail: `${wo}: ${note.slice(0, 160)}`,
          idempotencyKey: `ticket-update:${ticket.id}:${ctx.messageId}`,
          maintenanceRequestId: ticket.id,
          residentId: ctx.identity.resident_id,
          unitId: ctx.identity.unit_id ?? null,
        })
      }
      await logOutcome(ctx, {
        eventType: applyKind === "reopen"
          ? "sms.maintenance_reopened"
          : "sms.maintenance_update_applied",
        message: applyKind === "reopen"
          ? `Reopened ${formatWorkOrderRef(ticket.id)} after the resident said it wasn't fixed.`
          : `Added the resident's update to ${formatWorkOrderRef(ticket.id)}.`,
        maintenanceRequestId: ticket.id,
        extra: { kind: applyKind },
      })
      return handled(
        "sms_maintenance_update",
        applyKind === "reopen"
          ? `Thanks — I reopened ${formatWorkOrderRef(ticket.id)} and let the team know it still isn't fixed.`
          : `Thanks — I added that to ${formatWorkOrderRef(ticket.id)}. We'll keep you posted.`,
      )
    }
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_ticket_update_confirm: false,
      pending_ticket_update_id: undefined,
      pending_ticket_update_text: undefined,
      pending_ticket_update_kind: undefined,
      pending_ticket_update_media: undefined,
    })
    await logOutcome(ctx, {
      eventType: "sms.maintenance_update_declined",
      message: "Resident chose not to add an update to the open work order.",
      maintenanceRequestId: ticket.id,
    })
    return handled(
      "sms_maintenance_update",
      "No problem — I didn't change the work order. Reply here if you need anything else.",
    )
  }

  if (!ticket) {
    return { handled: false }
  }

  const photoNote = ctx.inbound.mediaUrls?.length
    ? " (Photo attached)"
    : ""
  const updateText = (
    interpretation.extractedSlots.update?.trim() ||
    ctx.inbound.body.trim()
  ) + photoNote
  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_ticket_update_confirm: true,
    pending_ticket_update_id: ticket.id,
    pending_ticket_update_text: updateText.slice(0, 500),
    pending_ticket_update_kind: kind,
    pending_ticket_update_media: ctx.inbound.mediaUrls?.slice(0, 12) ?? [],
  })
  await logOutcome(ctx, {
    eventType: "sms.maintenance_update_noted",
    message: `Noted a possible ${kind} for ${formatWorkOrderRef(ticket.id)}; waiting for the resident to confirm.`,
    maintenanceRequestId: ticket.id,
    extra: { kind },
  })
  const ask = kind === "reopen"
    ? `I can reopen ${formatWorkOrderRef(ticket.id)} because this still isn't fixed.`
    : kind === "worse"
    ? `I can add this to ${formatWorkOrderRef(ticket.id)} and mark it more urgent.`
    : kind === "no_show"
    ? `I can add this to ${formatWorkOrderRef(ticket.id)} and let the team know nobody showed up.`
    : kind === "photo"
    ? `I can attach that photo to ${formatWorkOrderRef(ticket.id)}.`
    : kind === "correction"
    ? `I can correct ${formatWorkOrderRef(ticket.id)} with that detail.`
    : `I can add this to ${formatWorkOrderRef(ticket.id)}:`
  return handled(
    "sms_maintenance_update",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      ask,
      updateText.slice(0, 200),
      "",
      "Reply YES to confirm, or NO to leave the work order as-is.",
    ].join("\n"),
  )
}

async function handleScheduleChange(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  tickets: OpenTicket[],
  residentName: string | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const ticket = pickOpenTicket(tickets) ?? tickets[0] ?? null
  const preferredDay = extractWeekdayPreference(ctx.inbound.body)
  const detail = [
    preferredDay ? `Preferred day: ${preferredDay}.` : null,
    ctx.inbound.body.trim().slice(0, 160),
  ].filter(Boolean).join(" ")
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "schedule_change",
    false,
  )
  void notifyLandlordNeedsAttention(ctx.supabase, {
    landlordId: ctx.landlordId,
    kind: "workflow_escalated",
    headline: "Resident asked to change a visit time",
    detail,
    idempotencyKey: `schedule-change:${ctx.conversationId}:${ctx.messageId}`,
    maintenanceRequestId: ticket?.id ?? null,
    residentId: ctx.identity.resident_id,
    unitId: ctx.identity.unit_id ?? null,
    workflowRunId: runId,
  })
  await logOutcome(ctx, {
    eventType: "sms.schedule_change_requested",
    message: ticket
      ? `Resident asked to change the visit time for ${formatWorkOrderRef(ticket.id)}.`
      : "Resident asked to change a visit time. No open appointment was on file.",
    workflowRunId: runId,
    maintenanceRequestId: ticket?.id ?? null,
  })
  return handled(
    "sms_schedule_change",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      ticket
        ? `I've passed your request to change the visit for ${formatWorkOrderRef(ticket.id)} to the property team. They'll follow up here.`
        : "I've passed your request to the property team. They'll follow up here about scheduling.",
      preferredDay ? `I noted you'd prefer ${preferredDay}.` : "",
    ].filter(Boolean).join("\n"),
  )
}

async function handleAccessInstruction(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  tickets: OpenTicket[],
  residentName: string | null,
  note: string,
  accessKind: "allow" | "restrict" | "note",
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const ticket = pickOpenTicket(tickets) ?? tickets[0] ?? null
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "access_instruction",
    false,
  )
  if (ticket) {
    const merged = [ticket.access_instructions?.trim(), note.trim()]
      .filter(Boolean)
      .join("\n")
    const { error: accessErr } = await ctx.supabase
      .from("maintenance_requests")
      .update({ access_instructions: merged.slice(0, 1000) })
      .eq("id", ticket.id)
    if (accessErr) {
      console.error("[sms] access_instructions update failed", accessErr.message)
    }
  } else {
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      pending_ticket_update_text: note.slice(0, 500),
    })
  }

  if (ticket?.assigned_vendor_id) {
    const wo = formatWorkOrderRef(ticket.id)
    const kindLine = accessKind === "restrict"
      ? "The resident asked that you not enter unless they are home."
      : accessKind === "allow"
      ? "The resident said you can enter without them being home."
      : "Access note from the resident:"
    await notifyVendorOnTicket(ctx.supabase, {
      landlordId: ctx.landlordId,
      ticketId: ticket.id,
      vendorId: ticket.assigned_vendor_id,
      body: [
        "Hi, this is the property management team.",
        "",
        `Update for work order ${wo}.`,
        "",
        kindLine,
        note.trim().slice(0, 200),
      ].join("\n"),
    })
  }

  if (accessKind === "restrict") {
    void notifyLandlordNeedsAttention(ctx.supabase, {
      landlordId: ctx.landlordId,
      kind: "workflow_escalated",
      headline: "Resident asked to restrict vendor access",
      detail: note.trim().slice(0, 160),
      idempotencyKey: `access-restrict:${ctx.conversationId}:${ctx.messageId}`,
      maintenanceRequestId: ticket?.id ?? null,
      residentId: ctx.identity.resident_id,
      unitId: ctx.identity.unit_id ?? null,
      workflowRunId: runId,
    })
  }

  await logOutcome(ctx, {
    eventType: "sms.access_instruction_saved",
    message: ticket
      ? `Saved access notes on ${formatWorkOrderRef(ticket.id)}.`
      : "Saved the resident's access notes on this text thread.",
    workflowRunId: runId,
    maintenanceRequestId: ticket?.id ?? null,
    extra: { access_kind: accessKind, vendor_notified: Boolean(ticket?.assigned_vendor_id) },
  })
  return handled(
    "sms_access_instruction",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      ticket
        ? `Thanks — I saved that access note on ${formatWorkOrderRef(ticket.id)}${ticket.assigned_vendor_id ? " and let the vendor know" : ""}.`
        : "Thanks — I saved that access note for the property team.",
    ].join("\n"),
  )
}

async function executeResidentTicketCancel(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  ticket: OpenTicket,
  residentName: string | null,
  tickets: OpenTicket[] = [],
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const status = (ticket.vendor_work_status ?? "").toLowerCase()
  const label = repairLabelForConfirm(ticket)

  if (status === "cancelled" || status === "completed") {
    const closure = historicalClosureLabel(ticket.vendor_work_status)
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_ticket_cancel_confirm: false,
      pending_ticket_cancel_id: undefined,
      awaiting_which_request: false,
      pending_which_request_ids: undefined,
      pending_which_request_intent: undefined,
    })
    return handled(
      "sms_maintenance_cancel",
      `Hi ${who},\n\nThis is the property management team.\n\nThat ${label} is already ${closure}. If the problem comes back, just text me.`,
    )
  }

  const canAutoCancel = status === "unassigned" || status === "pending_accept"
  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_ticket_cancel_confirm: false,
    pending_ticket_cancel_id: undefined,
    awaiting_which_request: false,
    pending_which_request_ids: undefined,
    pending_which_request_intent: undefined,
  })

  if (!canAutoCancel) {
    void notifyLandlordNeedsAttention(ctx.supabase, {
      landlordId: ctx.landlordId,
      kind: "workflow_escalated",
      headline: "Resident asked to cancel a repair already in progress",
      detail: `${formatWorkOrderRef(ticket.id)} is ${vendorStatusLabel(ticket.vendor_work_status)}.`,
      idempotencyKey: `ticket-cancel-review:${ticket.id}:${ctx.messageId}`,
      maintenanceRequestId: ticket.id,
      residentId: ctx.identity.resident_id,
      unitId: ctx.identity.unit_id ?? null,
    })
    await logOutcome(ctx, {
      eventType: "sms.maintenance_cancel_needs_review",
      message: `Resident asked to cancel ${formatWorkOrderRef(ticket.id)}, but work is already in progress.`,
      maintenanceRequestId: ticket.id,
    })
    return handled(
      "sms_maintenance_cancel",
      `Hi ${who},\n\nThis is the property management team.\n\nThis repair is already in progress, so I can't cancel it from here. I've let the property team know — they'll follow up.`,
    )
  }

  const vendorId = ticket.assigned_vendor_id
  const closed = await closeWorkOrderCancelledByResident(ctx.supabase, {
    landlordId: ctx.landlordId,
    ticketId: ticket.id,
    conversationId: ctx.conversationId,
    residentId: ctx.identity.resident_id,
    intake,
    descriptionNote:
      `Resident closed this request over text on ${new Date().toISOString().slice(0, 10)}.`,
    lastResidentMessage: ctx.inbound.body.trim().slice(0, 160),
  })
  if (!closed.ok) {
    console.warn("[sms-interpret] cancel ticket update failed", closed.error)
    return handled(
      "sms_maintenance_cancel",
      `Hi ${who},\n\nThis is the property management team.\n\nI couldn't close that work order from here. I've left a note for the property team to follow up.`,
    )
  }
  if (closed.alreadyClosed) {
    return handled(
      "sms_maintenance_cancel",
      `Hi ${who},\n\nThis is the property management team.\n\nThat ${label} is already closed. If the problem comes back, just text me.`,
    )
  }
  if (vendorId) {
    const wo = formatWorkOrderRef(ticket.id)
    await notifyVendorOnTicket(ctx.supabase, {
      landlordId: ctx.landlordId,
      ticketId: ticket.id,
      vendorId,
      body: `Hi, this is the property management team.\n\nWork order ${wo} has been cancelled. You don't need to take this job.`,
    })
  }
  const siblings = ticketsSharingRequestLabel(tickets, ticket).filter((row) =>
    row.id !== ticket.id
  )
  for (const sibling of siblings) {
    const siblingStatus = (sibling.vendor_work_status ?? "").toLowerCase()
    if (siblingStatus !== "unassigned" && siblingStatus !== "pending_accept") continue
    await closeWorkOrderCancelledByResident(ctx.supabase, {
      landlordId: ctx.landlordId,
      ticketId: sibling.id,
      residentId: ctx.identity.resident_id,
      descriptionNote:
        `Resident closed this request over text on ${new Date().toISOString().slice(0, 10)}.`,
      lastResidentMessage: ctx.inbound.body.trim().slice(0, 160),
    })
  }
  await logOutcome(ctx, {
    eventType: "sms.maintenance_cancelled",
    message: `Closed ${formatWorkOrderRef(ticket.id)} after the resident confirmed over text.`,
    maintenanceRequestId: ticket.id,
    extra: {
      closure_source: "tenant_sms",
      closure_reason: "resident_resolved",
    },
  })
  return handled(
    "sms_maintenance_cancel",
    `Got it — I've marked your ${label} as closed. If the problem comes back, just text me.`,
  )
}

async function handleCancel(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  interpretation: InboundInterpretation,
  activeIntake: boolean,
  tickets: OpenTicket[],
  residentName: string | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const selectedId = interpretation.extractedSlots.ticket_id?.trim()
  const namedTicket = selectedId
    ? tickets.find((row) => row.id === selectedId) ?? null
    : null
  const pendingId = intake.pending_ticket_cancel_id
  const pendingTicket = pendingId
    ? tickets.find((row) => row.id === pendingId) ?? null
    : null
  const ticket = namedTicket ??
    (intake.awaiting_ticket_cancel_confirm ? pendingTicket ?? tickets[0] ?? null : null) ??
    (activeIntake && intake.draft_ticket_id
      ? tickets.find((row) => row.id === intake.draft_ticket_id) ?? null
      : null) ??
    pickCancellableTicket(tickets) ??
    (interpretation.extractedSlots.historical === "true"
      ? pickHistoricalTicket(tickets)
      : null)
  const answeredWhichRequest = interpretation.extractedSlots.which_request_resolved === "true"

  // Already-closed historical ticket — confirm without another mutation.
  if (
    ticket &&
    isClosedOrCancelledStatus(ticket.vendor_work_status) &&
    !intake.awaiting_ticket_cancel_confirm
  ) {
    return executeResidentTicketCancel(ctx, intake, ticket, residentName, tickets)
  }

  if (answeredWhichRequest && ticket) {
    return executeResidentTicketCancel(ctx, intake, ticket, residentName, tickets)
  }

  // One clear active ticket + clear close/cancel intent → close and confirm.
  if (
    ticket &&
    !intake.awaiting_ticket_cancel_confirm &&
    isActiveMaintenanceTicketStatus(ticket.vendor_work_status) &&
    interpretation.intent === "maintenance_cancel"
  ) {
    const activePool = tickets.filter((row) =>
      isActiveMaintenanceTicketStatus(row.vendor_work_status) &&
      isIdentifiableRequestLabel({
        id: row.id,
        description: row.description,
        vendor_work_status: row.vendor_work_status,
        issue_category: row.issue_category,
      })
    )
    const unique = dedupeTicketsByRequestLabel(activePool)
    if (unique.length <= 1 || namedTicket) {
      return executeResidentTicketCancel(ctx, intake, ticket, residentName, tickets)
    }
  }

  if (intake.awaiting_ticket_cancel_confirm && ticket) {
    if (isNegativeReply(ctx.inbound.body) || interpretation.pendingAnswer === "no") {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_ticket_cancel_confirm: false,
        pending_ticket_cancel_id: undefined,
      })
      await logOutcome(ctx, {
        eventType: "sms.maintenance_cancel_declined",
        message: "Resident chose not to cancel the work order.",
        maintenanceRequestId: ticket.id,
      })
      return handled(
        "sms_maintenance_cancel",
        "No problem — I left the work order as-is. Reply here if you need anything else.",
      )
    }

    if (
      isAffirmativeReply(ctx.inbound.body) ||
      interpretation.pendingAnswer === "yes" ||
      answeredWhichRequest ||
      interpretation.intent === "maintenance_cancel"
    ) {
      return executeResidentTicketCancel(ctx, intake, ticket, residentName, tickets)
    }

    await logOutcome(ctx, {
      eventType: "sms.maintenance_cancel_noted",
      message: `Asked the resident again to confirm cancel for ${formatWorkOrderRef(ticket.id)}.`,
      maintenanceRequestId: ticket.id,
    })
    return handled(
      "sms_maintenance_cancel",
      [
        `Hi ${who},`,
        "",
        "This is the property management team.",
        "",
        `I can still cancel ${formatWorkOrderRef(ticket.id)} if you no longer need this repair.`,
        "",
        "Reply YES to cancel it, or NO to leave it open.",
      ].join("\n"),
    )
  }

  if (!ticket) {
    const draftId = intake.draft_ticket_id?.trim()
    if (draftId) {
      const closed = await closeWorkOrderCancelledByResident(ctx.supabase, {
        landlordId: ctx.landlordId,
        ticketId: draftId,
        conversationId: ctx.conversationId,
        residentId: ctx.identity.resident_id,
        intake,
        descriptionNote: "Resident cancelled this request over text.",
        lastResidentMessage: ctx.inbound.body.trim().slice(0, 160),
      })
      if (!closed.ok) {
        console.warn("[sms-interpret] draft cancel failed", closed.error)
      }
      await logOutcome(ctx, {
        eventType: "sms.maintenance_cancelled",
        message: "Stopped the in-progress repair request after the resident said they no longer need it.",
        maintenanceRequestId: draftId,
      })
      return handled(
        "sms_maintenance_cancel",
        `Hi ${who},\n\nThis is the property management team.\n\nOkay — I've stopped that request. Reply here if you need anything else.`,
      )
    }
    const runId = await maybeReleaseIntake(
      ctx.supabase,
      ctx,
      intake,
      activeIntake,
      "maintenance_cancel",
      false,
    )
    if (activeIntake) {
      await logOutcome(ctx, {
        eventType: "sms.maintenance_cancelled",
        message: "Stopped the in-progress repair request after the resident said they no longer need it.",
        workflowRunId: runId,
      })
      return handled(
        "sms_maintenance_cancel",
        `Hi ${who},\n\nThis is the property management team.\n\nOkay — I've stopped that request. Reply here if you need anything else.`,
      )
    }
    await logOutcome(ctx, {
      eventType: "sms.maintenance_cancel_noted",
      message: "Resident asked to cancel a repair; no open work order was on file.",
      workflowRunId: runId,
    })
    return handled(
      "sms_maintenance_cancel",
      `Hi ${who},\n\nThis is the property management team.\n\nI don't see an open repair to cancel. If you meant something else, reply here and the team can help.`,
    )
  }

  await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "maintenance_cancel",
    false,
  )
  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_ticket_cancel_confirm: true,
    pending_ticket_cancel_id: ticket.id,
  })
  await logOutcome(ctx, {
    eventType: "sms.maintenance_cancel_noted",
    message: `Noted a cancel request for ${formatWorkOrderRef(ticket.id)}; waiting for the resident to confirm.`,
    maintenanceRequestId: ticket.id,
  })
  return handled(
    "sms_maintenance_cancel",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      `I can cancel ${formatWorkOrderRef(ticket.id)} if you no longer need this repair.`,
      "",
      "Reply YES to cancel it, or NO to leave it open.",
    ].join("\n"),
  )
}

async function handleRentLate(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  residentId: string,
  residentName: string | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "rent_late",
    false,
  )
  const latest = ctx.inbound.body.trim().slice(0, 160)
  void notifyLandlordNeedsAttention(ctx.supabase, {
    landlordId: ctx.landlordId,
    kind: "late_rent",
    headline: "Resident said rent will be late",
    detail: latest ? `Latest message: "${latest}"` : "They asked for more time on rent.",
    idempotencyKey: `rent-late:${ctx.conversationId}:${ctx.messageId}`,
    residentId,
    unitId: ctx.identity.unit_id ?? null,
    workflowRunId: runId,
  })
  await logOutcome(ctx, {
    eventType: "sms.rent_late_noted",
    message: "Resident said rent will be late. The property team was notified.",
    workflowRunId: runId,
  })
  return handled(
    "sms_rent_late",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      "Thanks for letting us know. I've passed this to the property team so they can follow up with you here.",
    ].join("\n"),
  )
}

async function handleMoveOut(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  interpretation: InboundInterpretation,
  activeIntake: boolean,
  residentId: string,
  profile: {
    full_name: string | null
    unit: string | null
    building: string | null
  } | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(profile?.full_name)
  const parsedDate = parseResidentCalendarDate(ctx.inbound.body) ??
    interpretation.extractedSlots.move_out_date ??
    null

  if (intake.awaiting_move_out_confirm) {
    if (isAffirmativeReply(ctx.inbound.body) || interpretation.pendingAnswer === "yes") {
      const moveOutDate = intake.pending_move_out_date ?? parsedDate ?? null
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_move_out_confirm: false,
        pending_move_out_date: undefined,
      })
      const unit = await resolveUnitByIdOrLabel(ctx.supabase, {
        landlordId: ctx.landlordId,
        unitId: ctx.identity.unit_id,
      }) ?? await resolveUnitByIdOrLabel(ctx.supabase, {
        landlordId: ctx.landlordId,
        unitLabel: profile?.unit ?? ctx.identity.unit_id,
        building: profile?.building,
      })

      let workflowRunId: string | null = null
      if (unit?.id) {
        try {
          const started = await startMoveOutWorkflow(ctx.supabase, {
            landlordId: ctx.landlordId,
            unitId: unit.id,
            residentId,
            unitLabel: unit.unit_label,
            building: unit.building,
            moveOutDate,
            triggerType: "sms_inbound",
            classification: "voluntary_move_out",
          })
          workflowRunId = started.workflow_run_id
        } catch (err) {
          console.warn(
            "[sms-interpret] move-out start failed",
            err instanceof Error ? err.message : String(err),
          )
        }
      }

      void notifyLandlordNeedsAttention(ctx.supabase, {
        landlordId: ctx.landlordId,
        kind: "workflow_escalated",
        headline: "Resident confirmed a move-out date",
        detail: moveOutDate
          ? `Move-out date: ${formatLeaseDate(moveOutDate)}.`
          : "They confirmed they are moving out (no date given).",
        idempotencyKey: `move-out:${ctx.conversationId}:${ctx.messageId}`,
        residentId,
        unitId: unit?.id ?? ctx.identity.unit_id ?? null,
        workflowRunId,
      })
      await logOutcome(ctx, {
        eventType: workflowRunId ? "sms.move_out_started" : "sms.move_out_noted",
        message: workflowRunId
          ? "Started a move-out workflow after the resident confirmed over text."
          : "Resident confirmed they are moving out; the property team was notified.",
        workflowRunId,
        extra: { move_out_date: moveOutDate },
      })
      const dateLine = formatLeaseDate(moveOutDate)
      return handled(
        "sms_move_out",
        [
          `Hi ${who},`,
          "",
          "This is the property management team.",
          "",
          dateLine
            ? `Thanks — I've noted that you're moving out on ${dateLine}. The property team will follow up here with next steps.`
            : "Thanks — I've noted that you're moving out. The property team will follow up here with next steps.",
        ].join("\n"),
      )
    }
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_move_out_confirm: false,
      pending_move_out_date: undefined,
    })
    await logOutcome(ctx, {
      eventType: "sms.move_out_declined",
      message: "Resident chose not to start a move-out from this text.",
    })
    return handled(
      "sms_move_out",
      "No problem — I didn't change anything. Reply here if you need anything else.",
    )
  }

  await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "move_out_intent",
    false,
  )
  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_move_out_confirm: true,
    pending_move_out_date: parsedDate ?? undefined,
  })
  await logOutcome(ctx, {
    eventType: "sms.move_out_noted",
    message: parsedDate
      ? `Noted a possible move-out on ${parsedDate}; waiting for the resident to confirm.`
      : "Noted a possible move-out; waiting for the resident to confirm.",
    extra: { move_out_date: parsedDate },
  })
  const dateLine = formatLeaseDate(parsedDate)
  return handled(
    "sms_move_out",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      dateLine
        ? `I can let the team know you're moving out on ${dateLine}.`
        : "I can let the team know you're moving out.",
      "",
      "Reply YES to confirm, or NO if that's not what you meant.",
    ].join("\n"),
  )
}

async function handleOther(
  ctx: InboundSmsHandlerContext,
  intake: SmsIntakeState,
  activeIntake: boolean,
  residentName: string | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const latest = ctx.inbound.body.trim().slice(0, 160)
  const runId = await maybeReleaseIntake(
    ctx.supabase,
    ctx,
    intake,
    activeIntake,
    "other",
    true,
  )
  void notifyLandlordNeedsAttention(ctx.supabase, {
    landlordId: ctx.landlordId,
    kind: "workflow_escalated",
    headline: "Resident needs help over text",
    detail: latest
      ? `Latest message: "${latest}"`
      : "They reached out with something that isn't a repair request.",
    idempotencyKey: `sms-other:${ctx.conversationId}:${ctx.messageId}`,
    maintenanceRequestId: intake.draft_ticket_id ?? ctx.maintenanceRequestId,
    residentId: ctx.identity.resident_id,
    unitId: ctx.identity.unit_id ?? null,
    workflowRunId: runId,
  })
  await logOutcome(ctx, {
    eventType: "sms.routed_to_landlord",
    message: "Passed the resident's text to the property team instead of starting a repair request.",
    workflowRunId: runId,
  })
  return handled(
    "sms_routed_to_landlord",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      "I've passed your message to the team so they can help with what you need. They'll follow up with you here.",
      "",
      "If something in your home needs a repair, just text a short description anytime.",
    ].join("\n"),
  )
}

function whichRequestPendingIntent(
  intent: TenantSmsIntent | null,
): "maintenance_cancel" | "maintenance_update" | "maintenance_status" {
  if (intent === "maintenance_cancel") return "maintenance_cancel"
  if (intent === "maintenance_status" || intent === "schedule_change") {
    return "maintenance_status"
  }
  return "maintenance_update"
}

async function handleWhichRequestClarify(
  ctx: InboundSmsHandlerContext,
  tickets: OpenTicket[],
  ticketIds: string[],
  residentName: string | null,
  intent: TenantSmsIntent | null,
): Promise<InboundSmsHandlerResult> {
  const who = firstName(residentName)
  const chosen = ticketIds
    .map((id) => tickets.find((row) => row.id === id))
    .filter((row): row is OpenTicket => Boolean(row))
  const source = chosen.length > 0 ? chosen : tickets
  let labels = dedupeTicketsByRequestLabel(
    source.filter(isIdentifiableRequestLabel),
  ).slice(0, 4)
  if (labels.length === 0) {
    labels = dedupeTicketsByRequestLabel(
      source.filter((row) => !looksLikeStatusInquiryTicketDescription(row.description)),
    ).slice(0, 4)
  }
  if (labels.length === 0) {
    labels = dedupeTicketsByRequestLabel(source).slice(0, 4)
  }
  const list = labels.map((row) => `• ${shortTicketLabel(row)}`).join("\n")
  const cancel = intent === "maintenance_cancel"
  const statusAsk = intent === "maintenance_status" || intent === "schedule_change"
  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_which_request: true,
    pending_which_request_ids: labels.map((row) => row.id),
    pending_which_request_intent: whichRequestPendingIntent(intent),
    awaiting_ticket_cancel_confirm: false,
    pending_ticket_cancel_id: undefined,
  })
  await logOutcome(ctx, {
    eventType: "sms.maintenance_followup_clarify",
    message: "Asked the resident which open request their text was about.",
    extra: { ticket_ids: labels.map((row) => row.id), intent: intent ?? null },
  })
  return handled(
    "sms_maintenance_clarify",
    [
      `Hi ${who},`,
      "",
      "This is the property management team.",
      "",
      cancel
        ? "You have more than one open request. Which one do you want to cancel?"
        : statusAsk
        ? "Which repair are you asking about?"
        : "You have more than one open request. Which one do you mean?",
      list,
      "",
      "Reply with a few words from the one you mean.",
    ].join("\n"),
  )
}

export async function tryHandleInterpretedInbound(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  if (ctx.identity.identity_type !== "resident") return { handled: false }
  if (!ctx.identity.resident_id?.trim()) return { handled: false }
  if (shouldSkipInboundInterpretation(ctx.inbound.body)) return { handled: false }

  const intake = await loadIntakeRow(ctx.supabase, ctx.conversationId)
  const pending = pendingContextFromIntake(intake)
  const interpretation = await interpretInboundSms({
    body: ctx.inbound.body,
    pending,
    hasMedia: (ctx.inbound.mediaUrls?.length ?? 0) > 0,
    skipLlm: pending.awaitingTicketUpdateConfirm ||
      pending.awaitingTicketCancelConfirm ||
      pending.awaitingMoveOutConfirm ||
      intake.awaiting_which_request === true ||
      intake.awaiting_related_confirm === true,
  })

  const residentId = ctx.identity.resident_id
  const profile = await loadResidentProfile(ctx.supabase, residentId)
  const loadedTickets = await loadOpenTickets(ctx.supabase, {
    landlordId: ctx.landlordId,
    conversationTicketId: ctx.maintenanceRequestId,
    draftTicketId: intake.draft_ticket_id ??
      intake.pending_ticket_update_id ??
      intake.pending_ticket_cancel_id ??
      intake.pending_related_ticket_id,
    unit: profile?.unit,
    phone: profile?.phone,
  })
  // Spurious tickets minted from status questions are not real repairs.
  const tickets = loadedTickets.filter(
    (row) => !looksLikeStatusInquiryTicketDescription(row.description),
  )
  const spuriousInquiryTickets = loadedTickets.filter((row) =>
    looksLikeStatusInquiryTicketDescription(row.description)
  )

  const relatedBreakoutIntent = interpretation.intent &&
      (interpretation.intent === "rent_balance" ||
        interpretation.intent === "rent_late" ||
        interpretation.intent === "lease_info" ||
        interpretation.intent === "move_out_intent" ||
        interpretation.intent === "other" ||
        interpretation.intent === "maintenance_cancel" ||
        interpretation.intent === "maintenance_status")
    ? interpretation.intent
    : null

  // Stuck RELATED/SEPARATE must not trap rent/lease/other clear intents.
  if (intake.awaiting_related_confirm === true) {
    if (relatedBreakoutIntent) {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_related_confirm: false,
        pending_related_ticket_id: undefined,
        pending_related_text: undefined,
      })
      intake.awaiting_related_confirm = false
      intake.pending_related_ticket_id = undefined
      intake.pending_related_text = undefined
    } else {
      interpretation.intent = "maintenance_update"
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        ticket_id: intake.pending_related_ticket_id ?? "",
        update: intake.pending_related_text ?? ctx.inbound.body.trim(),
      }
      interpretation.needsClarification = false
      return handleMaintenanceUpdate(
        ctx,
        intake,
        interpretation,
        tickets,
        profile?.full_name ?? null,
      )
    }
  }

  if (intake.awaiting_rent_balance_clarify === true) {
    interpretation.intent = "rent_balance"
    interpretation.extractedSlots = {
      ...interpretation.extractedSlots,
      topic: "balance",
    }
    interpretation.needsClarification = false
    return handleRentBalance(
      ctx,
      intake,
      pending.activeIntake,
      residentId,
      "balance",
      interpretation,
    )
  }

  if (intake.awaiting_which_request === true) {
    const poolIds = (intake.pending_which_request_ids ?? []).filter(Boolean)
    const pool = poolIds.length > 0
      ? tickets.filter((row) => poolIds.includes(row.id))
      : tickets
    const matched = matchOpenRequests(
      ctx.inbound.body,
      pool.map((row) => ({
        id: row.id,
        description: row.description,
        vendor_work_status: row.vendor_work_status,
        issue_category: row.issue_category,
      })),
    )
    const sameTitle = matched.length > 1 &&
      new Set(matched.map((row) => ticketFirstLine(row))).size === 1
    if (matched.length === 1 || sameTitle) {
      await patchIntakeState(ctx.supabase, ctx.conversationId, {
        awaiting_which_request: false,
        pending_which_request_ids: undefined,
        pending_which_request_intent: undefined,
        awaiting_ticket_cancel_confirm: false,
        pending_ticket_cancel_id: undefined,
      })
      interpretation.intent = intake.pending_which_request_intent ??
        interpretation.intent ??
        "maintenance_update"
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        ticket_id: matched[0].id,
        which_request_resolved: "true",
      }
      interpretation.needsClarification = false
      interpretation.addressesPending = false
    } else {
      const unique = dedupeTicketsByRequestLabel(
        (pool.length > 0 ? pool : tickets).filter(isIdentifiableRequestLabel),
      )
      if (
        unique.length === 1 &&
        !isNegativeReply(ctx.inbound.body)
      ) {
        await patchIntakeState(ctx.supabase, ctx.conversationId, {
          awaiting_which_request: false,
          pending_which_request_ids: undefined,
          pending_which_request_intent: undefined,
          awaiting_ticket_cancel_confirm: false,
          pending_ticket_cancel_id: undefined,
        })
        interpretation.intent = intake.pending_which_request_intent ??
          interpretation.intent ??
          "maintenance_update"
        interpretation.extractedSlots = {
          ...interpretation.extractedSlots,
          ticket_id: unique[0].id,
          which_request_resolved: "true",
        }
        interpretation.needsClarification = false
        interpretation.addressesPending = false
      } else {
        return handleWhichRequestClarify(
          ctx,
          pool.length > 0 ? pool : tickets,
          unique.map((row) => row.id),
          profile?.full_name ?? null,
          intake.pending_which_request_intent ?? interpretation.intent,
        )
      }
    }
  } else if (!interpretation.addressesPending) {
    const decision = resolveContextualFollowUp({
      body: ctx.inbound.body,
      hasMedia: (ctx.inbound.mediaUrls?.length ?? 0) > 0,
      intent: interpretation.intent,
      openTickets: tickets.map((row) => ({
        id: row.id,
        description: row.description,
        vendor_work_status: row.vendor_work_status,
        issue_category: row.issue_category,
      })),
      activeIntake: pending.activeIntake,
    })

    if (decision.action === "clarify") {
      return handleWhichRequestClarify(
        ctx,
        tickets,
        decision.ticketIds,
        profile?.full_name ?? null,
        interpretation.intent,
      )
    }

    if (decision.action === "continue_intake") {
      return { handled: false, interpretation }
    }

    if (decision.action === "switch_intent") {
      if (
        interpretation.intent === "maintenance_new" ||
        interpretation.intent == null
      ) {
        // Don't hand off clear repair asks to landlord — start/continue intake.
        if (
          looksLikeBareRepairRequest(ctx.inbound.body) ||
          looksLikeMaintenanceRelatedMessage(ctx.inbound.body)
        ) {
          interpretation.intent = "maintenance_new"
          interpretation.extractedSlots = {
            ...interpretation.extractedSlots,
            contextual_action: "new_issue",
          }
          interpretation.needsClarification = false
          return { handled: false, interpretation }
        }
        interpretation.intent = "other"
      }
      interpretation.needsClarification = false
    }

    if (decision.action === "new_issue") {
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        contextual_action: "new_issue",
      }
      if (pending.activeIntake) {
        await maybeReleaseIntake(
          ctx.supabase,
          ctx,
          intake,
          pending.activeIntake,
          interpretation.intent ?? "maintenance_new",
          false,
        )
      }
      return { handled: false, interpretation }
    }

    if (decision.action === "follow_up") {
      interpretation.intent = decision.intent
      interpretation.extractedSlots = {
        ...interpretation.extractedSlots,
        ...decision.slots,
        ...(decision.ticketId ? { ticket_id: decision.ticketId } : {}),
      }
      interpretation.needsClarification = false
    }
  }

  if (!shouldHandleInterpretedIntent(interpretation, ctx.inbound.body, pending)) {
    return { handled: false, interpretation }
  }

  // Close leftover tickets that were minted from status questions (not real repairs).
  if (
    interpretation.intent === "maintenance_cancel" &&
    spuriousInquiryTickets.length > 0
  ) {
    for (const junk of spuriousInquiryTickets) {
      const closed = await closeWorkOrderCancelledByResident(ctx.supabase, {
        landlordId: ctx.landlordId,
        ticketId: junk.id,
        conversationId: ctx.conversationId,
        residentId: ctx.identity.resident_id,
        intake,
        descriptionNote: "Closed a status-question ticket that was not a real repair request.",
        lastResidentMessage: ctx.inbound.body.trim().slice(0, 160),
      })
      if (!closed.ok) {
        console.warn("[sms-interpret] spurious inquiry ticket close failed", closed.error)
      }
    }
  }

  switch (interpretation.intent) {
    case "lease_info":
      return handleLeaseInfo(
        ctx,
        intake,
        pending.activeIntake,
        residentId,
        interpretation.extractedSlots.topic ?? "lease_info",
      )
    case "rent_balance":
      return handleRentBalance(
        ctx,
        intake,
        pending.activeIntake,
        residentId,
        interpretation.extractedSlots.topic ?? "balance",
        interpretation,
      )
    case "rent_late":
      return handleRentLate(
        ctx,
        intake,
        pending.activeIntake,
        residentId,
        profile?.full_name ?? null,
      )
    case "maintenance_status":
      return handleMaintenanceStatus(
        ctx,
        intake,
        pending.activeIntake,
        tickets,
        profile?.full_name ?? null,
        interpretation.extractedSlots.ticket_id,
        interpretation,
      )
    case "maintenance_update":
      return handleMaintenanceUpdate(
        ctx,
        intake,
        interpretation,
        tickets,
        profile?.full_name ?? null,
      )
    case "schedule_change":
      return handleScheduleChange(
        ctx,
        intake,
        pending.activeIntake,
        preferTicket(tickets, interpretation.extractedSlots.ticket_id),
        profile?.full_name ?? null,
      )
    case "access_instruction": {
      const kindRaw = interpretation.extractedSlots.access_kind
      const accessKind = kindRaw === "allow" || kindRaw === "restrict" || kindRaw === "note"
        ? kindRaw
        : accessInstructionKind(ctx.inbound.body)
      return handleAccessInstruction(
        ctx,
        intake,
        pending.activeIntake,
        tickets,
        profile?.full_name ?? null,
        interpretation.extractedSlots.access || ctx.inbound.body.trim(),
        accessKind,
      )
    }
    case "maintenance_cancel":
      return handleCancel(
        ctx,
        intake,
        interpretation,
        pending.activeIntake,
        preferTicket(tickets, interpretation.extractedSlots.ticket_id),
        profile?.full_name ?? null,
      )
    case "move_out_intent":
      return handleMoveOut(
        ctx,
        intake,
        interpretation,
        pending.activeIntake,
        residentId,
        profile,
      )
    case "other":
      return handleOther(ctx, intake, pending.activeIntake, profile?.full_name ?? null)
    default:
      return { handled: false, interpretation }
  }
}
