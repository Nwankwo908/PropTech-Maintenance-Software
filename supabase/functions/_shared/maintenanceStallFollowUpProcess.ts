/**
 * Cron processor: stall follow-up for unfinished maintenance tickets.
 *
 * Scope: vendor / resident maintenance only. Never selects or mutates
 * rent_collection / payment-reminder / invoice-paid workflow runs.
 *
 * Coordination locks (yield, do not compete):
 * - sticky needs_admin_vendor
 * - awaiting landlord choice / vendor probe
 * - pending_accept past PENDING_ACCEPT_STALE_MS (rematch owns)
 * - active vendor schedule FSM (schedule FSM TTL owns)
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE,
  buildResidentStallFollowUpSms,
  buildVendorStallFollowUpSms,
  classifyMaintenanceStallFollowUp,
  decideStallFollowUpDelivery,
  groupStallFollowUps,
  stallIssueLabel,
  type MaintenanceStallKind,
  type StallClassifyResult,
  type StallFollowUpAudience,
  type StallTicketSnapshot,
} from "../../../shared/ops/maintenanceStallFollowUp.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"
import { gateResidentAutomatedReminder } from "./gateResidentAutomatedReminder.ts"
import { localHourInTimeZone } from "./residentSendTiming.ts"
import { shouldSendAutomatedMessage } from "./shouldSendAutomatedMessage.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { AWAITING_SCHEDULE_CONFIRM_KEY } from "./sms/tenantScheduleConfirm.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import {
  readVendorScheduleFsm,
  type VendorScheduleStep,
} from "./vendor_schedule_fsm.ts"
import { resolveVendorProbeLocationLabel } from "./vendorAvailabilityProbe.ts"

const OPEN_STATUSES = [
  "pending_accept",
  "accepted",
  "scheduled",
  "in_progress",
] as const

const ACTIVE_SCHEDULE_FSM_STEPS: ReadonlySet<VendorScheduleStep> = new Set([
  "awaiting_availability",
  "awaiting_confirmation",
  "awaiting_tenant_confirmation",
])

export type StallFollowUpProcessSummary = {
  scanned: number
  followUpsSent: number
  escalated: number
  skipped: number
  deferredQuietHours: number
  suppressed: number
  dryRun: boolean
  wouldSend?: Array<{
    groupKey: string
    audience: StallFollowUpAudience
    kind: MaintenanceStallKind
    ticketIds: string[]
    body: string
  }>
}

type DbTicketRow = {
  id: string
  landlord_id: string | null
  vendor_work_status: string | null
  assigned_vendor_id: string | null
  assigned_at: string | null
  scheduled_at: string | null
  schedule_confirmed_at: string | null
  created_at: string | null
  reschedule_requested_at: string | null
  inspection_report_id: string | null
  description: string | null
  issue_headline: string | null
  auto_reassign_last_outcome: string | null
  awaiting_landlord_choice_at: string | null
  awaiting_vendor_availability_at: string | null
  vendor_notify_error: string | null
  stall_follow_up_sent_at: string | null
  stall_follow_up_kind: string | null
  stall_follow_up_episode_key: string | null
  resident_id: string | null
  resident_name: string | null
  resident_phone: string | null
  unit: string | null
  property_id: string | null
  unit_id: string | null
}

function firstName(name: string | null | undefined): string {
  const part = String(name ?? "").trim().split(/\s+/)[0]
  return part || "there"
}

function scheduleFsmActiveForTicket(
  intake: Record<string, unknown> | null | undefined,
  ticketId: string,
): boolean {
  const fsm = readVendorScheduleFsm(intake)
  if (!fsm) return false
  if (fsm.ticketId && fsm.ticketId !== ticketId) return false
  return ACTIVE_SCHEDULE_FSM_STEPS.has(fsm.step)
}

function awaitingTenantConfirmForTicket(
  intake: Record<string, unknown> | null | undefined,
  ticketId: string,
): { awaiting: boolean; windowText: string | null } {
  if (!intake || typeof intake !== "object") {
    return { awaiting: false, windowText: null }
  }
  const raw = intake[AWAITING_SCHEDULE_CONFIRM_KEY]
  if (!raw || typeof raw !== "object") {
    return { awaiting: false, windowText: null }
  }
  const row = raw as Record<string, unknown>
  const id =
    (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
    (typeof row.ticketId === "string" && row.ticketId.trim()) ||
    ""
  if (id !== ticketId) return { awaiting: false, windowText: null }
  const windowText =
    (typeof row.window_text === "string" && row.window_text.trim()) ||
    (typeof row.windowText === "string" && row.windowText.trim()) ||
    null
  return { awaiting: true, windowText }
}

async function loadLinkedTemplateIds(
  supabase: SupabaseClient,
  ticketIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (ticketIds.length === 0) return out

  // Direct entity link (maintenance_request runs only — never rent_collection entity).
  const { data: direct } = await supabase
    .from("workflow_runs")
    .select("entity_id, template_id, metadata")
    .eq("entity_type", "maintenance_request")
    .in("entity_id", ticketIds)
    .limit(500)

  for (const row of direct ?? []) {
    const id = typeof row.entity_id === "string" ? row.entity_id.trim() : ""
    const template =
      typeof row.template_id === "string" ? row.template_id.trim() : ""
    if (!id || !template) continue
    const list = out.get(id) ?? []
    list.push(template)
    out.set(id, list)
  }

  // Metadata-linked maintenance runs (intake often keys to conversation).
  // Intentionally omit rent_collection / payment templates — this system must
  // never select those runs as candidates; we only attach templates that prove
  // a ticket is rent-linked (fail-closed skip) via a narrow metadata match.
  const { data: metaRows } = await supabase
    .from("workflow_runs")
    .select("template_id, metadata")
    .in("template_id", ["maintenance_request", "maintenance_intake"])
    .limit(800)

  for (const row of metaRows ?? []) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {}
    const linked =
      (typeof meta.maintenance_request_id === "string" &&
        meta.maintenance_request_id.trim()) ||
      (typeof meta.draft_ticket_id === "string" &&
        meta.draft_ticket_id.trim()) ||
      ""
    if (!linked || !ticketIds.includes(linked)) continue
    const template =
      typeof row.template_id === "string" ? row.template_id.trim() : ""
    if (!template) continue
    const list = out.get(linked) ?? []
    list.push(template)
    out.set(linked, list)
  }

  // Fail-closed: if a ticket id appears on a rent/payment run (entity or meta),
  // mark it so classify skips — never mutate those runs.
  const { data: rentLinked } = await supabase
    .from("workflow_runs")
    .select("entity_id, template_id, metadata")
    .in("template_id", ["rent_collection"])
    .limit(200)

  for (const row of rentLinked ?? []) {
    const template =
      typeof row.template_id === "string" ? row.template_id.trim() : ""
    if (!template) continue
    const entityId =
      typeof row.entity_id === "string" ? row.entity_id.trim() : ""
    if (entityId && ticketIds.includes(entityId)) {
      const list = out.get(entityId) ?? []
      list.push(template)
      out.set(entityId, list)
    }
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {}
    const linked =
      (typeof meta.maintenance_request_id === "string" &&
        meta.maintenance_request_id.trim()) ||
      (typeof meta.draft_ticket_id === "string" &&
        meta.draft_ticket_id.trim()) ||
      ""
    if (linked && ticketIds.includes(linked)) {
      const list = out.get(linked) ?? []
      list.push(template)
      out.set(linked, list)
    }
  }

  return out
}

async function loadScheduleContext(
  supabase: SupabaseClient,
  tickets: DbTicketRow[],
): Promise<{
  scheduleFsmActive: Map<string, boolean>
  awaitingTenant: Map<string, { awaiting: boolean; windowText: string | null }>
}> {
  const scheduleFsmActive = new Map<string, boolean>()
  const awaitingTenant = new Map<
    string,
    { awaiting: boolean; windowText: string | null }
  >()
  const ticketIds = tickets.map((t) => t.id)
  if (ticketIds.length === 0) {
    return { scheduleFsmActive, awaitingTenant }
  }

  const vendorIds = [
    ...new Set(
      tickets
        .map((t) => t.assigned_vendor_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  if (vendorIds.length > 0) {
    const { data: vendorConvos } = await supabase
      .from("sms_conversations")
      .select("id, vendor_id, maintenance_request_id, intake_state")
      .eq("conversation_type", "vendor_alert")
      .in("vendor_id", vendorIds)
      .order("updated_at", { ascending: false })
      .limit(400)

    for (const ticket of tickets) {
      const vendorId = ticket.assigned_vendor_id?.trim()
      if (!vendorId) {
        scheduleFsmActive.set(ticket.id, false)
        continue
      }
      const match =
        (vendorConvos ?? []).find(
          (c) =>
            String(c.vendor_id ?? "") === vendorId &&
            String(c.maintenance_request_id ?? "") === ticket.id,
        ) ??
        (vendorConvos ?? []).find(
          (c) => String(c.vendor_id ?? "") === vendorId,
        )
      const intake =
        match?.intake_state && typeof match.intake_state === "object"
          ? (match.intake_state as Record<string, unknown>)
          : null
      scheduleFsmActive.set(
        ticket.id,
        scheduleFsmActiveForTicket(intake, ticket.id),
      )
    }
  }

  const residentIds = [
    ...new Set(
      tickets
        .map((t) => t.resident_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  if (residentIds.length > 0) {
    const { data: residentConvos } = await supabase
      .from("sms_conversations")
      .select("id, resident_id, maintenance_request_id, intake_state")
      .in("conversation_type", ["resident_intake", "landlord_update"])
      .in("resident_id", residentIds)
      .order("updated_at", { ascending: false })
      .limit(400)

    for (const ticket of tickets) {
      const residentId = ticket.resident_id?.trim()
      if (!residentId) {
        awaitingTenant.set(ticket.id, { awaiting: false, windowText: null })
        continue
      }
      const match =
        (residentConvos ?? []).find(
          (c) =>
            String(c.resident_id ?? "") === residentId &&
            String(c.maintenance_request_id ?? "") === ticket.id,
        ) ??
        (residentConvos ?? []).find(
          (c) => String(c.resident_id ?? "") === residentId,
        )
      const intake =
        match?.intake_state && typeof match.intake_state === "object"
          ? (match.intake_state as Record<string, unknown>)
          : null
      awaitingTenant.set(
        ticket.id,
        awaitingTenantConfirmForTicket(intake, ticket.id),
      )
    }
  }

  return { scheduleFsmActive, awaitingTenant }
}

function toSnapshot(
  row: DbTicketRow,
  ctx: {
    scheduleFsmActive: boolean
    awaitingTenantConfirm: boolean
    linkedWorkflowTemplateIds: string[]
  },
): StallTicketSnapshot {
  return {
    id: row.id,
    landlordId: String(row.landlord_id ?? "").trim(),
    vendorWorkStatus: row.vendor_work_status,
    assignedVendorId: row.assigned_vendor_id,
    assignedAt: row.assigned_at,
    scheduledAt: row.scheduled_at,
    scheduleConfirmedAt: row.schedule_confirmed_at,
    // maintenance_requests has no updated_at — use the freshest operational clock.
    updatedAt:
      row.reschedule_requested_at ||
      row.schedule_confirmed_at ||
      row.assigned_at ||
      row.created_at,
    createdAt: row.created_at,
    inspectionReportId: row.inspection_report_id,
    description: row.description,
    issueHeadline: row.issue_headline,
    autoReassignLastOutcome: row.auto_reassign_last_outcome,
    awaitingLandlordChoiceAt: row.awaiting_landlord_choice_at,
    awaitingVendorAvailabilityAt: row.awaiting_vendor_availability_at,
    vendorNotifyError: row.vendor_notify_error,
    stallFollowUpSentAt: row.stall_follow_up_sent_at,
    stallFollowUpKind: row.stall_follow_up_kind,
    stallFollowUpEpisodeKey: row.stall_follow_up_episode_key,
    awaitingTenantScheduleConfirm: ctx.awaitingTenantConfirm,
    scheduleFsmActive: ctx.scheduleFsmActive,
    linkedWorkflowTemplateIds: ctx.linkedWorkflowTemplateIds,
  }
}

async function stampFollowUpSent(
  supabase: SupabaseClient,
  ticketIds: string[],
  kind: MaintenanceStallKind,
  episodeKey: string,
  sentAtIso: string,
): Promise<void> {
  if (ticketIds.length === 0) return
  await supabase
    .from("maintenance_requests")
    .update({
      stall_follow_up_sent_at: sentAtIso,
      stall_follow_up_kind: kind,
      stall_follow_up_episode_key: episodeKey,
    })
    .in("id", ticketIds)
}

async function escalateToNeedsAdmin(
  supabase: SupabaseClient,
  ticket: StallTicketSnapshot,
  kind: MaintenanceStallKind,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return
  const nowIso = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      auto_reassign_last_outcome: STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE,
      auto_reassign_same_outcome_count: 1,
      auto_reassign_same_outcome_since: nowIso,
    })
    .eq("id", ticket.id)

  if (ticket.landlordId) {
    await recordActivityLog(supabase, {
      landlordId: ticket.landlordId,
      eventType: "maintenance.stall_follow_up_escalated",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: ticket.id,
      vendorId: ticket.assignedVendorId,
      metadata: {
        message:
          "Stall follow-up went unanswered — added to the needs-a-vendor digest for staff review.",
        stall_kind: kind,
        episode_key: ticket.stallFollowUpEpisodeKey,
        signature: STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE,
      },
    }).catch(() => {})
  }
}

async function sendVendorGroupFollowUp(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    kind: MaintenanceStallKind
    tickets: StallTicketSnapshot[]
    dryRun: boolean
  },
): Promise<
  | { ok: true; body: string; deferred?: false; suppressed?: false }
  | { ok: false; deferred: true }
  | { ok: false; suppressed: true; reason: string }
  | { ok: false; error: string }
> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()
  const phone =
    typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone) return { ok: false, error: "vendor_no_phone" }

  const primary = params.tickets[0]!
  const gate = await shouldSendAutomatedMessage(supabase, {
    landlordId: params.landlordId,
    ticketId: primary.id,
    messageType: "maintenance_stall_follow_up",
    audience: "vendor",
    recipientPhone: phone,
    currentVendorWorkStatus: primary.vendorWorkStatus,
  })
  const delivery = decideStallFollowUpDelivery({
    audience: "vendor",
    automatedGateAction:
      gate.action === "hold_quiet_hours"
        ? "hold_quiet_hours"
        : gate.action === "suppress"
        ? "suppress"
        : "send",
    automatedGateReason:
      gate.action === "suppress" || gate.action === "hold_quiet_hours"
        ? gate.reason
        : undefined,
  })
  if (delivery.action === "suppress") {
    return { ok: false, suppressed: true, reason: delivery.reason }
  }

  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: params.landlordId,
    ticketId: primary.id,
    unitFallback: null,
  }).catch(() => "")

  const body = buildVendorStallFollowUpSms({
    vendorName: typeof vendor?.name === "string" ? vendor.name : "there",
    kind: params.kind,
    locationLabel: locationLabel || null,
    items: params.tickets.map((t) => ({
      workOrderRef: formatWorkOrderRef(t.id),
      issueLabel: stallIssueLabel(t),
    })),
  })

  if (params.dryRun) {
    return { ok: true, body }
  }

  const sent = await sendVendorJobAlert(supabase, {
    ticketId: primary.id,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
    landlordId: params.landlordId,
    bindAssignment: false,
  })
  if (!sent.ok) return { ok: false, error: sent.error }
  return { ok: true, body }
}

async function sendResidentFollowUp(
  supabase: SupabaseClient,
  params: {
    ticket: StallTicketSnapshot
    row: DbTicketRow
    kind: MaintenanceStallKind
    windowText: string | null
    dryRun: boolean
    nowMs: number
  },
): Promise<
  | { ok: true; body: string }
  | { ok: false; deferred: true }
  | { ok: false; suppressed: true; reason: string }
  | { ok: false; error: string }
> {
  const landlordId = params.ticket.landlordId
  const residentId = params.row.resident_id?.trim() || ""
  if (!landlordId || !residentId) {
    return { ok: false, error: "missing_resident" }
  }

  let phone = normalizePhoneFlexible(params.row.resident_phone)
  if (!phone) {
    const { data: user } = await supabase
      .from("users")
      .select("phone, full_name")
      .eq("id", residentId)
      .maybeSingle()
    phone = normalizePhoneFlexible(
      typeof user?.phone === "string" ? user.phone : null,
    )
    if (!params.row.resident_name && typeof user?.full_name === "string") {
      params.row.resident_name = user.full_name
    }
  }
  if (!phone) return { ok: false, error: "resident_no_phone" }

  const gate = await gateResidentAutomatedReminder(supabase, {
    landlordId,
    residentId,
    propertyId: params.row.property_id,
    building: null,
    messageType: "maintenance_stall_follow_up",
    recipientPhone: phone,
    ticketId: params.ticket.id,
    nowMs: params.nowMs,
  })

  // Prefer the shared gate (property/resident TZ). Also mirror the pure
  // quiet-hours decision so unit tests / dry-runs stay consistent.
  if (gate.decision.action === "hold_quiet_hours") {
    return { ok: false, deferred: true }
  }
  if (gate.decision.action === "suppress") {
    return { ok: false, suppressed: true, reason: gate.decision.reason }
  }
  const localHour = localHourInTimeZone(params.nowMs, gate.timing.timeZone)
  const delivery = decideStallFollowUpDelivery({
    audience: "resident",
    residentLocalHour: localHour,
    quietHoursStart: gate.timing.quietHours.startHour,
    quietHoursEnd: gate.timing.quietHours.endHour,
  })
  if (delivery.action === "defer_quiet_hours") {
    return { ok: false, deferred: true }
  }

  const body = buildResidentStallFollowUpSms({
    residentFirstName: firstName(params.row.resident_name),
    kind: params.kind,
    issueLabel: stallIssueLabel(params.ticket),
    workOrderRef: formatWorkOrderRef(params.ticket.id),
    windowText: params.windowText,
  })

  if (params.dryRun) {
    return { ok: true, body }
  }

  const smsNumber = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!smsNumber?.phone_number) {
    return { ok: false, error: "no_landlord_main" }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone,
    landlordId,
    identityType: "resident",
    residentId,
  })
  if (!identity) return { ok: false, error: "identity_failed" }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId,
    smsNumberId: smsNumber.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: params.ticket.id,
    conversationStatus: "open",
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: phone,
    body,
    provider: "twilio",
    source: "maintenance_stall_follow_up",
  })
  if (!sent.ok) return { ok: false, error: sent.error ?? "send_failed" }
  return { ok: true, body }
}

/**
 * Scan open maintenance tickets, send at most one follow-up per stall episode
 * (grouped by inspection_report_id), and escalate unanswered episodes to the
 * needs_admin_vendor digest sticky.
 */
export async function processMaintenanceStallFollowUps(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    ticketIds?: string[] | null
    nowMs?: number
    limit?: number
    dryRun?: boolean
  },
): Promise<StallFollowUpProcessSummary> {
  const nowMs = options?.nowMs ?? Date.now()
  const dryRun = options?.dryRun === true
  const limit = options?.limit ?? 120
  const ticketFilter = (options?.ticketIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean)

  let query = supabase
    .from("maintenance_requests")
    .select(
      [
        "id",
        "landlord_id",
        "vendor_work_status",
        "assigned_vendor_id",
        "assigned_at",
        "scheduled_at",
        "schedule_confirmed_at",
        "created_at",
        "reschedule_requested_at",
        "inspection_report_id",
        "description",
        "issue_headline",
        "auto_reassign_last_outcome",
        "awaiting_landlord_choice_at",
        "awaiting_vendor_availability_at",
        "vendor_notify_error",
        "stall_follow_up_sent_at",
        "stall_follow_up_kind",
        "stall_follow_up_episode_key",
        "resident_id",
        "resident_name",
        "resident_phone",
        "unit",
        "property_id",
        "unit_id",
      ].join(", "),
    )
    .in("vendor_work_status", [...OPEN_STATUSES])
    .order("created_at", { ascending: true })
    .limit(limit)

  if (options?.landlordId?.trim()) {
    query = query.eq("landlord_id", options.landlordId.trim())
  }
  if (ticketFilter.length > 0) {
    query = query.in("id", ticketFilter)
  }

  const { data: rows, error } = await query
  if (error) {
    console.error("[stall-follow-up] list tickets", error.message)
    throw new Error(error.message)
  }

  const tickets = (rows ?? []) as DbTicketRow[]
  const summary: StallFollowUpProcessSummary = {
    scanned: tickets.length,
    followUpsSent: 0,
    escalated: 0,
    skipped: 0,
    deferredQuietHours: 0,
    suppressed: 0,
    dryRun,
    wouldSend: dryRun ? [] : undefined,
  }

  if (tickets.length === 0) return summary

  const ticketIds = tickets.map((t) => t.id)
  const [linkedTemplates, scheduleCtx] = await Promise.all([
    loadLinkedTemplateIds(supabase, ticketIds),
    loadScheduleContext(supabase, tickets),
  ])

  const rowById = new Map(tickets.map((t) => [t.id, t]))
  const followUpItems: Array<{
    ticket: StallTicketSnapshot
    kind: MaintenanceStallKind
    audience: StallFollowUpAudience
    episodeKey: string
  }> = []
  const escalateItems: Array<{
    ticket: StallTicketSnapshot
    kind: MaintenanceStallKind
  }> = []

  for (const row of tickets) {
    const tenantCtx = scheduleCtx.awaitingTenant.get(row.id) ?? {
      awaiting: false,
      windowText: null,
    }
    const snapshot = toSnapshot(row, {
      scheduleFsmActive: scheduleCtx.scheduleFsmActive.get(row.id) === true,
      awaitingTenantConfirm: tenantCtx.awaiting,
      linkedWorkflowTemplateIds: linkedTemplates.get(row.id) ?? [
        "maintenance_request",
      ],
    })
    const result: StallClassifyResult = classifyMaintenanceStallFollowUp(
      snapshot,
      nowMs,
    )
    if (result.action === "skip") {
      summary.skipped++
      continue
    }
    if (result.action === "escalate") {
      escalateItems.push({ ticket: snapshot, kind: result.kind })
      continue
    }
    followUpItems.push({
      ticket: snapshot,
      kind: result.kind,
      audience: result.audience,
      episodeKey: result.episodeKey,
    })
  }

  for (const item of escalateItems) {
    await escalateToNeedsAdmin(supabase, item.ticket, item.kind, dryRun)
    summary.escalated++
  }

  const groups = groupStallFollowUps(followUpItems)
  const sentAtIso = new Date(nowMs).toISOString()

  for (const group of groups) {
    const groupTickets = group.ticketIds
      .map((id) => followUpItems.find((i) => i.ticket.id === id)?.ticket)
      .filter((t): t is StallTicketSnapshot => Boolean(t))
    if (groupTickets.length === 0) continue

    if (group.audience === "vendor") {
      const vendorId = groupTickets[0]?.assignedVendorId?.trim()
      if (!vendorId) {
        summary.skipped += group.ticketIds.length
        continue
      }
      // All siblings in a group should share the same vendor; skip mismatches.
      const sameVendor = groupTickets.every(
        (t) => t.assignedVendorId?.trim() === vendorId,
      )
      if (!sameVendor) {
        // Fall back to one-per-ticket for mixed-vendor groups.
        for (const ticket of groupTickets) {
          const vid = ticket.assignedVendorId?.trim()
          if (!vid) {
            summary.skipped++
            continue
          }
          const result = await sendVendorGroupFollowUp(supabase, {
            landlordId: ticket.landlordId,
            vendorId: vid,
            kind: group.kind,
            tickets: [ticket],
            dryRun,
          })
          if ("deferred" in result && result.deferred) {
            summary.deferredQuietHours++
            continue
          }
          if ("suppressed" in result && result.suppressed) {
            summary.suppressed++
            continue
          }
          if (!result.ok) {
            summary.skipped++
            continue
          }
          if (dryRun) {
            summary.wouldSend?.push({
              groupKey: `ticket:${ticket.id}`,
              audience: "vendor",
              kind: group.kind,
              ticketIds: [ticket.id],
              body: result.body,
            })
          } else {
            await stampFollowUpSent(
              supabase,
              [ticket.id],
              group.kind,
              group.episodeKey,
              sentAtIso,
            )
            await recordActivityLog(supabase, {
              landlordId: ticket.landlordId,
              eventType: "maintenance.stall_follow_up_sent",
              source: "automation",
              actorType: "system",
              maintenanceRequestId: ticket.id,
              vendorId: vid,
              metadata: {
                message: "Sent a stall follow-up to the vendor.",
                stall_kind: group.kind,
                episode_key: group.episodeKey,
                audience: "vendor",
              },
            }).catch(() => {})
          }
          summary.followUpsSent++
        }
        continue
      }

      const result = await sendVendorGroupFollowUp(supabase, {
        landlordId: group.landlordId,
        vendorId,
        kind: group.kind,
        tickets: groupTickets,
        dryRun,
      })
      if ("deferred" in result && result.deferred) {
        summary.deferredQuietHours++
        continue
      }
      if ("suppressed" in result && result.suppressed) {
        summary.suppressed++
        continue
      }
      if (!result.ok) {
        summary.skipped += group.ticketIds.length
        continue
      }
      if (dryRun) {
        summary.wouldSend?.push({
          groupKey: group.groupKey,
          audience: "vendor",
          kind: group.kind,
          ticketIds: group.ticketIds,
          body: result.body,
        })
      } else {
        await stampFollowUpSent(
          supabase,
          group.ticketIds,
          group.kind,
          group.episodeKey,
          sentAtIso,
        )
        await recordActivityLog(supabase, {
          landlordId: group.landlordId,
          eventType: "maintenance.stall_follow_up_sent",
          source: "automation",
          actorType: "system",
          maintenanceRequestId: group.ticketIds[0]!,
          vendorId,
          metadata: {
            message:
              group.ticketIds.length > 1
                ? `Sent one stall follow-up covering ${group.ticketIds.length} inspection items.`
                : "Sent a stall follow-up to the vendor.",
            stall_kind: group.kind,
            episode_key: group.episodeKey,
            audience: "vendor",
            ticket_ids: group.ticketIds,
            inspection_report_id: group.inspectionReportId,
          },
        }).catch(() => {})
      }
      summary.followUpsSent++
      continue
    }

    // Resident audience — one message per ticket (not grouped across residents).
    for (const ticket of groupTickets) {
      const row = rowById.get(ticket.id)
      if (!row) {
        summary.skipped++
        continue
      }
      const windowText =
        scheduleCtx.awaitingTenant.get(ticket.id)?.windowText ?? null
      const result = await sendResidentFollowUp(supabase, {
        ticket,
        row,
        kind: group.kind,
        windowText,
        dryRun,
        nowMs,
      })
      if ("deferred" in result && result.deferred) {
        summary.deferredQuietHours++
        continue
      }
      if ("suppressed" in result && result.suppressed) {
        summary.suppressed++
        continue
      }
      if (!result.ok) {
        summary.skipped++
        continue
      }
      if (dryRun) {
        summary.wouldSend?.push({
          groupKey: `ticket:${ticket.id}`,
          audience: "resident",
          kind: group.kind,
          ticketIds: [ticket.id],
          body: result.body,
        })
      } else {
        await stampFollowUpSent(
          supabase,
          [ticket.id],
          group.kind,
          group.episodeKey,
          sentAtIso,
        )
        await recordActivityLog(supabase, {
          landlordId: ticket.landlordId,
          eventType: "maintenance.stall_follow_up_sent",
          source: "automation",
          actorType: "system",
          maintenanceRequestId: ticket.id,
          residentId: row.resident_id,
          metadata: {
            message: "Sent a stall follow-up to the resident.",
            stall_kind: group.kind,
            episode_key: group.episodeKey,
            audience: "resident",
          },
        }).catch(() => {})
      }
      summary.followUpsSent++
    }
  }

  return summary
}
