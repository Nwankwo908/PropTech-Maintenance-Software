/**
 * Pre-assignment availability probe.
 *
 * Before the landlord picks a vendor, Ulo texts matchable roster vendors the
 * work-order summary and asks for an arrival window (optional estimate).
 * When vendors reply with a slot, the landlord chooses among responders —
 * then the existing assign → accept → schedule → complete path continues.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  markAwaitingLandlordVendorChoice,
  notifyLandlordVendorChoice,
} from "./vendorLandlordChoice.ts"
import type {
  VendorAssignmentOption,
  VendorAssignmentRow,
} from "./vendor_assignment.ts"
import {
  extractWorkOrderRefFromSms,
  formatWorkOrderRef,
  stripWorkOrderRefFromSms,
  titleCaseCompanyName,
  vendorCompanyName,
  workOrderRefMatchesTicket,
} from "./vendor_outreach_copy.ts"
import { loadLandlordDisplayName } from "./landlordDisplayName.ts"
import { sanitizeResidentAvailabilityForVendor } from "./sms/residentAvailabilityExtract.ts"
import { loadPropertyLocationFromTable } from "./properties/propertyLocation.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { applyVendorStatusTransition } from "./vendor_workflow.ts"
import {
  resolveVendorAvailability,
  type ResolvedAvailability,
} from "./vendor_availability_parse.ts"

export const AWAITING_VENDOR_AVAILABILITY_PROBE =
  "Awaiting vendor availability before landlord choice"

/**
 * After the first multi-vendor offer, hold before the landlord decision SMS so
 * a second responder does not reframe YES → 1/2 mid-flight. Aligns with typical
 * soft-offer reply windows (insight inspector uses 30m); 20m is the middle of
 * the 15–30m product band.
 */
export const VENDOR_PROBE_HOLD_MS = 20 * 60 * 1000

export type VendorProbeOffer = {
  vendorId: string
  name: string
  role: "specialist" | "generalist"
  windowLabel: string
  scheduledAt: string | null
  endAt: string | null
  estimateNote: string | null
  receivedAt: string
}

export type VendorAvailabilityProbe = {
  ticketId: string
  landlordId: string
  unit: string
  issueCategory: string | null
  description: string
  /** Clean issue line for vendor SMS — never the Q&A-stuffed description. */
  issueHeadline: string | null
  /** True/false when known; omitted from SMS when null. */
  entryOkIfAbsent: boolean | null
  urgent: boolean
  residentAvailabilityText: string | null
  candidates: Array<{
    vendorId: string
    name: string
    role: "specialist" | "generalist"
    phone: string | null
  }>
  offers: VendorProbeOffer[]
  declinedVendorIds: string[]
  /**
   * probing — soft-offers out, no landlord status/decision yet
   * holding — status SMS sent; collecting more offers (not replyable as YES)
   * awaiting_landlord — one decision SMS sent (YES or 1/2)
   */
  status: "probing" | "holding" | "awaiting_landlord"
  startedAt: string
  /** When the first offer arrived (hold clock). */
  firstOfferAt: string | null
  /** When the non-actionable "Checking availability…" SMS was sent. */
  statusSmsSentAt: string | null
  /** Absolute deadline to finalize the hold (ISO). */
  holdUntil: string | null
  /** When the decision (YES / 1/2) SMS was sent. */
  landlordNotifiedAt: string | null
  /** Insight inspector path: assign on first offer (no landlord YES/1/2). */
  insightAutoAssign?: boolean
  insightSchedulingRequestId?: string | null
  /** Shared HQS / inspection letter — visit-level probe when multiple tickets. */
  inspectionReportId?: string | null
  /** All ticket ids covered by one visit probe SMS (includes ticketId). */
  visitTicketIds?: string[]
}

export type AwaitingVendorProbe = {
  ticketId: string
  vendorId: string
  sentAt: string
  /** Optional display fields for multi-ticket disambiguation SMS. */
  workOrderRef?: string
  issueHeadline?: string | null
  /** When set, bare day/window replies apply to the whole inspection visit group. */
  inspectionReportId?: string | null
}

export type AwaitingVendorProbeClarify = {
  options: Array<{
    ticketId: string
    workOrderRef: string
    label: string
  }>
  askedAt: string
}

function parseAwaitingProbeRow(raw: unknown): AwaitingVendorProbe | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  const vendorId = typeof row.vendor_id === "string" ? row.vendor_id.trim() : ""
  if (!ticketId || !vendorId) return null
  return {
    ticketId,
    vendorId,
    sentAt: typeof row.sent_at === "string" ? row.sent_at : "",
    workOrderRef:
      typeof row.work_order_ref === "string" && row.work_order_ref.trim()
        ? row.work_order_ref.trim()
        : formatWorkOrderRef(ticketId),
    issueHeadline:
      typeof row.issue_headline === "string" ? row.issue_headline.trim() : null,
    inspectionReportId:
      typeof row.inspection_report_id === "string" && row.inspection_report_id.trim()
        ? row.inspection_report_id.trim()
        : null,
  }
}

function serializeAwaitingProbe(probe: AwaitingVendorProbe): Record<string, unknown> {
  return {
    ticket_id: probe.ticketId,
    vendor_id: probe.vendorId,
    sent_at: probe.sentAt,
    work_order_ref: probe.workOrderRef ?? formatWorkOrderRef(probe.ticketId),
    issue_headline: probe.issueHeadline ?? null,
    inspection_report_id: probe.inspectionReportId ?? null,
  }
}

/**
 * Pending vendor soft-offers on a conversation.
 *
 * Historically a single `awaiting_vendor_probe` object (last-write-wins).
 * Now also stored as `awaiting_vendor_probes` (list keyed by ticket_id).
 * Readers merge both so older threads still resolve.
 */
export function readAwaitingVendorProbes(
  intakeState: unknown,
): AwaitingVendorProbe[] {
  if (!intakeState || typeof intakeState !== "object") return []
  const state = intakeState as Record<string, unknown>
  const byTicket = new Map<string, AwaitingVendorProbe>()

  const listRaw = state.awaiting_vendor_probes
  if (Array.isArray(listRaw)) {
    for (const item of listRaw) {
      const parsed = parseAwaitingProbeRow(item)
      if (parsed) byTicket.set(parsed.ticketId, parsed)
    }
  }

  const legacy = parseAwaitingProbeRow(state.awaiting_vendor_probe)
  if (legacy && !byTicket.has(legacy.ticketId)) {
    byTicket.set(legacy.ticketId, legacy)
  }

  return [...byTicket.values()].sort((a, b) =>
    (a.sentAt || "").localeCompare(b.sentAt || "")
  )
}

/** Single pending probe (legacy + multi). Prefer explicit WO match via resolve helpers. */
export function readAwaitingVendorProbe(
  intakeState: unknown,
): AwaitingVendorProbe | null {
  const all = readAwaitingVendorProbes(intakeState)
  return all.length === 1 ? all[0]! : all.length > 0 ? all[all.length - 1]! : null
}

export function readAwaitingVendorProbeClarify(
  intakeState: unknown,
): AwaitingVendorProbeClarify | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_vendor_probe_clarify
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const optionsRaw = Array.isArray(row.options) ? row.options : []
  const options: AwaitingVendorProbeClarify["options"] = []
  for (const opt of optionsRaw) {
    if (!opt || typeof opt !== "object") continue
    const o = opt as Record<string, unknown>
    const ticketId = typeof o.ticket_id === "string" ? o.ticket_id.trim() : ""
    const workOrderRef =
      typeof o.work_order_ref === "string" ? o.work_order_ref.trim() : ""
    const label = typeof o.label === "string" ? o.label.trim() : workOrderRef
    if (!ticketId || !workOrderRef) continue
    options.push({ ticketId, workOrderRef, label })
  }
  if (options.length === 0) return null
  return {
    options,
    askedAt: typeof row.asked_at === "string" ? row.asked_at : "",
  }
}

/** Upsert one ticket into the pending-probe list (no last-write-wins wipe). */
export function upsertAwaitingVendorProbeOnIntake(
  intakeState: Record<string, unknown>,
  probe: AwaitingVendorProbe,
): Record<string, unknown> {
  const existing = readAwaitingVendorProbes(intakeState).filter(
    (p) => p.ticketId !== probe.ticketId,
  )
  const next = [...existing, probe]
  const serialized = next.map(serializeAwaitingProbe)
  return {
    ...intakeState,
    awaiting_vendor_probes: serialized,
    // Keep legacy single as the most recent for older readers.
    awaiting_vendor_probe: serializeAwaitingProbe(probe),
  }
}

export function removeAwaitingVendorProbeFromIntake(
  intakeState: Record<string, unknown>,
  ticketId: string,
): Record<string, unknown> {
  const remaining = readAwaitingVendorProbes(intakeState).filter(
    (p) => p.ticketId !== ticketId,
  )
  const next = { ...intakeState }
  delete next.awaiting_vendor_probe_clarify
  if (remaining.length === 0) {
    delete next.awaiting_vendor_probe
    delete next.awaiting_vendor_probes
  } else {
    next.awaiting_vendor_probes = remaining.map(serializeAwaitingProbe)
    next.awaiting_vendor_probe = serializeAwaitingProbe(
      remaining[remaining.length - 1]!,
    )
  }
  return next
}

export function setAwaitingVendorProbeClarifyOnIntake(
  intakeState: Record<string, unknown>,
  clarify: AwaitingVendorProbeClarify,
): Record<string, unknown> {
  return {
    ...intakeState,
    awaiting_vendor_probe_clarify: {
      asked_at: clarify.askedAt,
      options: clarify.options.map((o) => ({
        ticket_id: o.ticketId,
        work_order_ref: o.workOrderRef,
        label: o.label,
      })),
    },
  }
}

/**
 * Pick which pending probe an inbound vendor SMS applies to.
 * Explicit WO-XXXX wins; numbered reply works after a clarify ask;
 * a single pending probe resolves without a WO; multiple sharing one
 * inspection_report_id resolve as one visit; otherwise → ambiguous.
 */
export function resolveVendorProbeTicketFromReply(input: {
  body: string
  probes: AwaitingVendorProbe[]
  clarify?: AwaitingVendorProbeClarify | null
}):
  | { kind: "matched"; probe: AwaitingVendorProbe; bodyForParse: string }
  | {
    kind: "visit_group"
    probes: AwaitingVendorProbe[]
    inspectionReportId: string
    bodyForParse: string
  }
  | { kind: "ambiguous"; probes: AwaitingVendorProbe[] }
  | { kind: "none" } {
  const probes = input.probes
  if (probes.length === 0) return { kind: "none" }

  const body = input.body.trim()
  const woRef = extractWorkOrderRefFromSms(body)
  if (woRef) {
    const hit = probes.find((p) => workOrderRefMatchesTicket(woRef, p.ticketId))
    if (hit) {
      return {
        kind: "matched",
        probe: hit,
        bodyForParse: stripWorkOrderRefFromSms(body),
      }
    }
  }

  const clarify = input.clarify
  if (clarify && clarify.options.length > 0) {
    const normalized = body.toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ")
    const numbered = normalized.match(/^(?:option |reply |job )?(\d+)$/)
    if (numbered) {
      const index = Number(numbered[1]) - 1
      const opt = clarify.options[index]
      if (opt) {
        const hit = probes.find((p) => p.ticketId === opt.ticketId)
        if (hit) {
          return { kind: "matched", probe: hit, bodyForParse: body }
        }
      }
    }
    if (woRef) {
      const opt = clarify.options.find((o) =>
        o.workOrderRef.toUpperCase() === woRef.toUpperCase()
      )
      if (opt) {
        const hit = probes.find((p) => p.ticketId === opt.ticketId)
        if (hit) {
          return {
            kind: "matched",
            probe: hit,
            bodyForParse: stripWorkOrderRefFromSms(body),
          }
        }
      }
    }
    return { kind: "ambiguous", probes }
  }

  if (probes.length === 1) {
    return {
      kind: "matched",
      probe: probes[0]!,
      bodyForParse: woRef ? stripWorkOrderRefFromSms(body) : body,
    }
  }

  const reportIds = [
    ...new Set(
      probes
        .map((p) => p.inspectionReportId?.trim() || "")
        .filter((id) => id.length > 0),
    ),
  ]
  if (reportIds.length === 1 && probes.every((p) => p.inspectionReportId === reportIds[0])) {
    return {
      kind: "visit_group",
      probes,
      inspectionReportId: reportIds[0]!,
      bodyForParse: body,
    }
  }

  return { kind: "ambiguous", probes }
}

/** Landlord-facing / vendor checklist line from a ticket description. */
export function checklistLabelFromTicketDescription(
  description: string | null | undefined,
): string {
  const first = String(description ?? "").split("\n")[0]?.trim() || ""
  const hqs = first.match(/^HQS fail:\s*(.+)$/i)
  if (hqs?.[1]) {
    return hqs[1].replace(/\s+-\s+/g, " — ").trim() || "Inspection item"
  }
  return first || "Repair item"
}

export function buildVendorInspectionVisitProbeSms(input: {
  vendorName: string
  companyName?: string | null
  location?: string | null
  urgent?: boolean
  items: Array<{ label: string; workOrderRef: string }>
  inspectionRef?: string | null
}): string {
  const vendor = vendorCompanyName(input.vendorName)
  const company = titleCaseCompanyName(input.companyName) || "Ulo"
  const loc = (input.location ?? "").trim()
  const where = loc ? ` at ${loc}` : ""
  const urgentMark = input.urgent ? " — URGENT" : ""
  const lines = [
    `Hi ${vendor} — inspection visit${where}${urgentMark}`,
    company,
    "",
  ]
  const ref = (input.inspectionRef ?? "").trim()
  if (ref) {
    lines.push(`Inspection ${ref}`)
    lines.push("")
  }
  lines.push("Here's what needs doing on this visit:")
  for (const item of input.items) {
    const label = item.label.trim() || "Repair item"
    const wo = item.workOrderRef.trim()
    lines.push(wo ? `• ${label} (${wo})` : `• ${label}`)
  }
  lines.push(
    "",
    "Reply with one day + window for the whole visit (ex: Wed 9am–12pm).",
    "Can't take a specific item? Reply NO + that WO code (ex: NO WO-D154).",
    "Can't take the visit? Reply NO.",
  )
  return lines.join("\n")
}

export function buildVendorInspectionVisitAckSms(input: {
  windowLabel: string
  itemCount: number
}): string {
  const when = input.windowLabel.trim() || "that window"
  const n = Math.max(1, input.itemCount)
  return [
    `Thanks — we have you down for ${when} for the inspection visit (${n} item${n === 1 ? "" : "s"}).`,
    "",
    "We'll text you if the property team confirms.",
  ].join("\n")
}

export function buildLandlordInspectionVisitChoiceSms(input: {
  landlordFirstName?: string | null
  vendorName: string
  locationLabel?: string | null
  windowLabel?: string | null
  estimateNote?: string | null
  items: Array<{ label: string; workOrderRef?: string }>
  adminUrl?: string | null
}): string {
  const first = input.landlordFirstName?.trim()
  const greeting = first ? `Hi ${first}` : "Hi"
  const vendor = vendorCompanyName(input.vendorName)
  const loc = (input.locationLabel ?? "").trim()
  const where = loc ? ` at ${loc}` : ""
  const lines = [
    `${greeting} — ${vendor} is available for the inspection visit${where}.`,
  ]
  const window = (input.windowLabel ?? "").trim()
  const estimate = (input.estimateNote ?? "").trim()
  if (window || estimate) {
    lines.push("")
    if (window) lines.push(window)
    if (estimate) lines.push(estimate)
  }
  if (input.items.length > 0) {
    lines.push("", "Items on this visit:")
    for (const item of input.items) {
      const label = item.label.trim() || "Repair item"
      const wo = (item.workOrderRef ?? "").trim()
      lines.push(wo ? `• ${label} (${wo})` : `• ${label}`)
    }
  }
  lines.push("", `Reply YES to send the visit to ${vendor}.`)
  const adminUrl = input.adminUrl?.trim() ?? ""
  if (adminUrl) {
    lines.push("", "View details:", adminUrl)
  }
  return lines.join("\n")
}

export function buildVendorProbeWhichJobSms(
  probes: AwaitingVendorProbe[],
): string {
  const lines = [
    "Thanks — which job is this for?",
    "",
  ]
  probes.forEach((p, i) => {
    const wo = p.workOrderRef ?? formatWorkOrderRef(p.ticketId)
    const issue = (p.issueHeadline ?? "").trim()
    lines.push(
      issue
        ? `${i + 1} — ${wo} · ${issue}`
        : `${i + 1} — ${wo}`,
    )
  })
  lines.push(
    "",
    "Reply with the number or the WO code (e.g. WO-D154), then your day/window or NO.",
  )
  return lines.join("\n")
}

export function buildVendorOpenProbesReminderSms(input: {
  vendorName: string
  probes: Array<{ workOrderRef: string; issueHeadline?: string | null }>
}): string {
  const vendor = vendorCompanyName(input.vendorName)
  const lines = [
    `Hi ${vendor} — quick follow-up.`,
    "",
    `We still need availability on ${input.probes.length} open jobs:`,
    "",
  ]
  input.probes.forEach((p, i) => {
    const issue = (p.issueHeadline ?? "").trim()
    lines.push(
      issue
        ? `${i + 1} — ${p.workOrderRef} · ${issue}`
        : `${i + 1} — ${p.workOrderRef}`,
    )
  })
  lines.push(
    "",
    "Reply with the WO code + earliest day/window (e.g. WO-D154 Wed 9am–12pm), or NO + WO code if you can't take that one.",
  )
  return lines.join("\n")
}

export function ticketIsAwaitingVendorAvailabilityProbe(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_VENDOR_AVAILABILITY_PROBE)
}

export function canHandleVendorAvailabilityProbe(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType !== "vendor") return false
  return (
    readAwaitingVendorProbes(input.intakeState).length > 0 ||
    readAwaitingVendorProbeClarify(input.intakeState) != null
  )
}

/** @deprecated Prefer titleCaseCompanyName from vendor_outreach_copy.ts */
export { titleCaseCompanyName } from "./vendor_outreach_copy.ts"

export function formatVendorProbeLocationLine(input: {
  streetAddress?: string | null
  building?: string | null
  unit?: string | null
}): string {
  const street = (input.streetAddress ?? "").trim()
  const building = (input.building ?? "").trim()
  const place = street || building
  const unitRaw = (input.unit ?? "").trim()
  // If callers already passed "14 Maple · Unit 1", keep it.
  if (
    unitRaw &&
    !place &&
    (/\d/.test(unitRaw) && /[a-z]/i.test(unitRaw) || unitRaw.includes("·"))
  ) {
    return unitRaw
  }
  const unitBit = unitRaw
    ? (/^unit\b/i.test(unitRaw) ? unitRaw : `Unit ${unitRaw}`)
    : ""
  if (place && unitBit) return `${place} · ${unitBit}`
  if (place) return place
  return unitBit
}

/** Resolve property street address (+ unit) for vendor probe SMS. */
export async function resolveVendorProbeLocationLabel(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unitFallback?: string | null
  },
): Promise<string> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("unit, property_id, unit_id")
    .eq("id", params.ticketId)
    .maybeSingle()

  const unitLabel =
    (typeof ticket?.unit === "string" && ticket.unit.trim()
      ? ticket.unit.trim()
      : null) ||
    (params.unitFallback?.trim() || null)

  let propertyId =
    typeof ticket?.property_id === "string" && ticket.property_id.trim()
      ? ticket.property_id.trim()
      : null
  let building: string | null = null

  if (
    typeof ticket?.unit_id === "string" && ticket.unit_id.trim()
  ) {
    const { data: unitRow } = await supabase
      .from("units")
      .select("property_id, building, unit_label")
      .eq("id", ticket.unit_id.trim())
      .maybeSingle()
    if (!propertyId && typeof unitRow?.property_id === "string") {
      propertyId = unitRow.property_id.trim() || null
    }
    if (typeof unitRow?.building === "string" && unitRow.building.trim()) {
      building = unitRow.building.trim()
    }
  }

  const location = await loadPropertyLocationFromTable(supabase, params.landlordId, {
    propertyId,
    building,
  })

  return formatVendorProbeLocationLine({
    streetAddress: location?.streetAddress ?? null,
    building,
    unit: unitLabel,
  })
}

/**
 * Compact availability probe. Issue line comes from the clean ticket headline,
 * never the raw description that accumulates intake Q&A.
 */

export function ticketIsUrgentForVendorProbe(input: {
  priority?: string | null
  urgency?: string | null
  severity?: string | null
}): boolean {
  const hay = [input.priority, input.urgency, input.severity]
    .map((s) => (s ?? "").toLowerCase())
    .join(" ")
  return /\b(emergency|urgent)\b/.test(hay)
}

/**
 * Compact availability probe. Issue line comes from the clean ticket headline,
 * never the raw description that accumulates intake Q&A.
 */
export function buildVendorAvailabilityProbeSms(input: {
  vendorName: string
  companyName?: string | null
  workOrderRef: string
  /**
   * Property location for the first line — street address (· Unit N).
   * Prefer `location` over bare `unit`.
   */
  location?: string | null
  unit?: string | null
  /** @deprecated Prefer issueHeadline — kept so older callers still compile. */
  description?: string | null
  issueHeadline?: string | null
  entryOkIfAbsent?: boolean | null
  urgent?: boolean
  residentAvailabilityText?: string | null
  jobDetailUrl?: string | null
}): string {
  const vendor = vendorCompanyName(input.vendorName)
  const company = titleCaseCompanyName(input.companyName) || "Ulo"
  const wo = input.workOrderRef.trim() || "this work order"
  const loc = (input.location ?? "").trim() || (input.unit ?? "").trim()
  const where = loc ? ` at ${loc}` : ""
  const urgentMark = input.urgent ? " — URGENT" : ""
  const issue = (input.issueHeadline ?? "").trim() ||
    "See the work order for details."

  const lines = [
    `Hi ${vendor} — job ${wo}${where}${urgentMark}`,
    company,
    "",
    `Issue: ${issue}`,
  ]
  if (input.entryOkIfAbsent === true) {
    lines.push("Entry OK if resident out: Yes")
  } else if (input.entryOkIfAbsent === false) {
    lines.push("Entry OK if resident out: No")
  }
  const avail = sanitizeResidentAvailabilityForVendor(
    input.residentAvailabilityText,
    [input.description, input.issueHeadline],
  )
  if (avail) {
    lines.push(`Resident avail: ${avail}`)
  }
  lines.push(
    "",
    "Take it? Reply earliest day + window (ex: Wed 9am-12pm) + estimate if you have one",
    `Can't? Reply NO ${wo}`,
  )
  const url = input.jobDetailUrl?.trim()
  if (url) {
    lines.push("", `Details: ${url}`)
  }
  return lines.join("\n")
}

export function buildVendorProbeAckSms(input: {
  windowLabel: string
  workOrderRef: string
}): string {
  const when = input.windowLabel.trim() || "that window"
  const wo = input.workOrderRef.trim() || "this work order"
  return [
    `Thanks — we have you down for ${when} on ${wo}.`,
    "",
    "We'll text you if the property team selects you for this job.",
  ].join("\n")
}

function serializeProbe(probe: VendorAvailabilityProbe): Record<string, unknown> {
  return {
    ticket_id: probe.ticketId,
    landlord_id: probe.landlordId,
    unit: probe.unit,
    issue_category: probe.issueCategory,
    description: probe.description,
    issue_headline: probe.issueHeadline,
    entry_ok_if_absent: probe.entryOkIfAbsent,
    urgent: probe.urgent,
    resident_availability_text: probe.residentAvailabilityText,
    candidates: probe.candidates.map((c) => ({
      vendor_id: c.vendorId,
      name: c.name,
      role: c.role,
      phone: c.phone,
    })),
    offers: probe.offers.map((o) => ({
      vendor_id: o.vendorId,
      name: o.name,
      role: o.role,
      window_label: o.windowLabel,
      scheduled_at: o.scheduledAt,
      end_at: o.endAt,
      estimate_note: o.estimateNote,
      received_at: o.receivedAt,
    })),
    declined_vendor_ids: probe.declinedVendorIds,
    status: probe.status,
    started_at: probe.startedAt,
    first_offer_at: probe.firstOfferAt,
    status_sms_sent_at: probe.statusSmsSentAt,
    hold_until: probe.holdUntil,
    landlord_notified_at: probe.landlordNotifiedAt,
    insight_auto_assign: probe.insightAutoAssign === true,
    insight_scheduling_request_id: probe.insightSchedulingRequestId ?? null,
    inspection_report_id: probe.inspectionReportId ?? null,
    visit_ticket_ids: probe.visitTicketIds ?? [probe.ticketId],
  }
}

export function readVendorAvailabilityProbe(
  intakeState: unknown,
): VendorAvailabilityProbe | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).vendor_availability_probe
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  const landlordId = typeof row.landlord_id === "string" ? row.landlord_id.trim() : ""
  if (!ticketId || !landlordId) return null
  const candidatesRaw = Array.isArray(row.candidates) ? row.candidates : []
  const offersRaw = Array.isArray(row.offers) ? row.offers : []
  const declinedRaw = Array.isArray(row.declined_vendor_ids)
    ? row.declined_vendor_ids
    : []
  return {
    ticketId,
    landlordId,
    unit: typeof row.unit === "string" ? row.unit : "",
    issueCategory: typeof row.issue_category === "string" ? row.issue_category : null,
    description: typeof row.description === "string" ? row.description : "",
    issueHeadline: typeof row.issue_headline === "string" ? row.issue_headline : null,
    entryOkIfAbsent: typeof row.entry_ok_if_absent === "boolean"
      ? row.entry_ok_if_absent
      : null,
    urgent: row.urgent === true,
    residentAvailabilityText:
      typeof row.resident_availability_text === "string"
        ? row.resident_availability_text
        : null,
    candidates: candidatesRaw.flatMap((c) => {
      if (!c || typeof c !== "object") return []
      const item = c as Record<string, unknown>
      const vendorId = typeof item.vendor_id === "string" ? item.vendor_id.trim() : ""
      if (!vendorId) return []
      return [{
        vendorId,
        name: typeof item.name === "string" ? item.name : "Vendor",
        role: item.role === "generalist" ? "generalist" as const : "specialist" as const,
        phone: typeof item.phone === "string" ? item.phone : null,
      }]
    }),
    offers: offersRaw.flatMap((o) => {
      if (!o || typeof o !== "object") return []
      const item = o as Record<string, unknown>
      const vendorId = typeof item.vendor_id === "string" ? item.vendor_id.trim() : ""
      if (!vendorId) return []
      return [{
        vendorId,
        name: typeof item.name === "string" ? item.name : "Vendor",
        role: item.role === "generalist" ? "generalist" as const : "specialist" as const,
        windowLabel: typeof item.window_label === "string" ? item.window_label : "",
        scheduledAt: typeof item.scheduled_at === "string" ? item.scheduled_at : null,
        endAt: typeof item.end_at === "string" ? item.end_at : null,
        estimateNote: typeof item.estimate_note === "string" ? item.estimate_note : null,
        receivedAt: typeof item.received_at === "string" ? item.received_at : "",
      }]
    }),
    declinedVendorIds: declinedRaw
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim()),
    status: row.status === "awaiting_landlord"
      ? "awaiting_landlord"
      : row.status === "holding"
      ? "holding"
      : "probing",
    startedAt: typeof row.started_at === "string" ? row.started_at : "",
    firstOfferAt:
      typeof row.first_offer_at === "string" ? row.first_offer_at : null,
    statusSmsSentAt:
      typeof row.status_sms_sent_at === "string" ? row.status_sms_sent_at : null,
    holdUntil: typeof row.hold_until === "string" ? row.hold_until : null,
    landlordNotifiedAt:
      typeof row.landlord_notified_at === "string" ? row.landlord_notified_at : null,
    insightAutoAssign: row.insight_auto_assign === true,
    insightSchedulingRequestId:
      typeof row.insight_scheduling_request_id === "string"
        ? row.insight_scheduling_request_id
        : null,
    inspectionReportId:
      typeof row.inspection_report_id === "string" && row.inspection_report_id.trim()
        ? row.inspection_report_id.trim()
        : null,
    visitTicketIds: Array.isArray(row.visit_ticket_ids)
      ? row.visit_ticket_ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
      : [ticketId],
  }
}

/** Candidates that were actually soft-offered (have a phone). */
export function probePhoneCandidates(
  probe: VendorAvailabilityProbe,
): VendorAvailabilityProbe["candidates"] {
  return probe.candidates.filter((c) => Boolean(c.phone?.trim()))
}

/** Every soft-offered vendor has either offered a slot or declined. */
export function probeAllCandidatesResponded(
  probe: VendorAvailabilityProbe,
): boolean {
  const phoneOnes = probePhoneCandidates(probe)
  if (phoneOnes.length === 0) return true
  return phoneOnes.every(
    (c) =>
      probe.offers.some((o) => o.vendorId === c.vendorId) ||
      probe.declinedVendorIds.includes(c.vendorId),
  )
}

export function isVendorProbeHoldActive(probe: VendorAvailabilityProbe): boolean {
  return (
    probe.status === "holding" &&
    !probe.landlordNotifiedAt &&
    probe.offers.length > 0
  )
}

/**
 * Ready to send the one landlord decision SMS (YES or 1/2).
 * Single soft-offered vendor finalizes immediately; multi waits for all
 * responses or the hold timeout from the first offer.
 */
export function shouldFinalizeVendorProbeHold(
  probe: VendorAvailabilityProbe,
  nowMs: number = Date.now(),
  holdMs: number = VENDOR_PROBE_HOLD_MS,
): boolean {
  if (probe.offers.length === 0) return false
  if (probe.landlordNotifiedAt) return false
  if (probe.status === "awaiting_landlord") return false

  const phoneCount = probePhoneCandidates(probe).length
  if (phoneCount <= 1) return true
  if (probeAllCandidatesResponded(probe)) return true

  const anchor = probe.firstOfferAt || probe.statusSmsSentAt || probe.startedAt
  if (!anchor) return false
  const start = Date.parse(anchor)
  if (!Number.isFinite(start)) return false
  if (probe.holdUntil) {
    const until = Date.parse(probe.holdUntil)
    if (Number.isFinite(until) && nowMs >= until) return true
  }
  return nowMs >= start + holdMs
}

/** Status-only SMS — not an approval ask (YES must not assign anyone). */
export function buildLandlordProbeStatusSms(input: {
  issueHeadline?: string | null
  locationLabel?: string | null
  unit?: string | null
}): string {
  const issue = input.issueHeadline?.trim() || "the repair"
  const loc =
    input.locationLabel?.trim() ||
    input.unit?.trim() ||
    "the property"
  return (
    `Checking vendor availability for ${issue} at ${loc}. ` +
    "I'll follow up shortly with options."
  )
}

async function loadLandlordProbeConversation(
  supabase: SupabaseClient,
  landlordId: string,
  ticketId: string,
): Promise<{ conversationId: string; intake: Record<string, unknown> } | null> {
  const main = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!main?.id) return null
  const { phones } = await import("./sms/tenantActivationAdminAlert.ts").then((m) =>
    m.resolveLandlordOpsPhones(supabase, landlordId)
  )
  const phone = phones[0]
  if (!phone) return null
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId,
    phone,
    identityType: "landlord",
  })
  if (!identity) return null
  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId,
    smsNumberId: main.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: ticketId,
    conversationStatus: "open",
  })
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  return { conversationId, intake }
}

async function saveProbeOnLandlordThread(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
  probe: VendorAvailabilityProbe,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: {
        ...priorIntake,
        vendor_availability_probe: serializeProbe(probe),
      },
      maintenance_request_id: probe.ticketId,
      conversation_type: "landlord_update",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export async function loadVendorAvailabilityProbeForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<VendorAvailabilityProbe | null> {
  const id = ticketId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(40)
  if (error) {
    console.error("[vendor-probe] load probe", error.message)
    return null
  }
  for (const row of data ?? []) {
    const probe = readVendorAvailabilityProbe(row.intake_state)
    if (probe?.ticketId === id) return probe
  }
  return null
}

function probeOffersToChoiceNames(offers: VendorProbeOffer[]): VendorAssignmentOption[] {
  return offers.map((offer) => ({
    vendor: {
      id: offer.vendorId,
      name: offer.name,
      email: null,
      phone: null,
      notification_channel: "sms",
      active: true,
      category: null,
      portal_api_key: null,
      last_assigned_at: null,
      created_at: "",
    } satisfies VendorAssignmentRow,
    role: offer.role,
  }))
}

function probeOffersAvailabilityByVendorId(
  offers: VendorProbeOffer[],
): Record<string, { windowLabel?: string | null; estimateNote?: string | null }> {
  const out: Record<
    string,
    { windowLabel?: string | null; estimateNote?: string | null }
  > = {}
  for (const offer of offers) {
    out[offer.vendorId] = {
      windowLabel: offer.windowLabel?.trim() || null,
      estimateNote: offer.estimateNote?.trim() || null,
    }
  }
  return out
}

/**
 * Soft-offer every matchable vendor. Landlord choice waits until at least one
 * returns a slot (or all decline → fall through elsewhere).
 *
 * When the ticket shares an inspection_report_id with other open siblings,
 * sends one visit-framed SMS covering the whole group and upserts a pending
 * probe per ticket (siblings that already await the probe are skipped by
 * assignVendorAndNotify).
 */
export async function startVendorAvailabilityProbe(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unit: string
    issueCategory: string | null
    description: string
    issueHeadline?: string | null
    entryOkIfAbsent?: boolean | null
    urgent?: boolean
    residentAvailabilityText?: string | null
    options: VendorAssignmentOption[]
    /** Insight inspector scheduling: auto-assign on offer; skip landlord choice SMS. */
    insightAutoAssign?: boolean
    insightSchedulingRequestId?: string | null
  },
): Promise<{ probed: number; skipReason?: string }> {
  const candidates = params.options
    .map((opt) => ({
      vendorId: opt.vendor.id,
      name: opt.vendor.name,
      role: opt.role,
      phone: opt.vendor.phone?.trim() || null,
    }))
    .filter((c) => Boolean(c.vendorId))

  if (candidates.length === 0) {
    return { probed: 0, skipReason: "no_vendor" }
  }

  const { data: ticketRow } = await supabase
    .from("maintenance_requests")
    .select(
      "id, inspection_report_id, description, issue_category, vendor_notify_error, status, vendor_work_status",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  const inspectionReportId =
    typeof ticketRow?.inspection_report_id === "string" &&
      ticketRow.inspection_report_id.trim()
      ? ticketRow.inspection_report_id.trim()
      : null

  type VisitItem = {
    ticketId: string
    description: string
    issueCategory: string | null
    issueHeadline: string | null
  }

  let visitItems: VisitItem[] = [{
    ticketId: params.ticketId,
    description: params.description,
    issueCategory: params.issueCategory,
    issueHeadline: params.issueHeadline?.trim() || null,
  }]

  if (inspectionReportId) {
    const { data: siblings } = await supabase
      .from("maintenance_requests")
      .select(
        "id, description, issue_category, issue_headline, vendor_notify_error, status, vendor_work_status",
      )
      .eq("inspection_report_id", inspectionReportId)
      .eq("landlord_id", params.landlordId)

    const openSiblings = (siblings ?? []).filter((row) => {
      const id = typeof row.id === "string" ? row.id : ""
      if (!id) return false
      const status = String(row.status ?? "").toLowerCase()
      if (status === "completed" || status === "cancelled" || status === "closed") {
        return false
      }
      const vws = String(row.vendor_work_status ?? "").toLowerCase()
      if (vws === "completed" || vws === "cancelled") return false
      // Already in a visit probe from an earlier sibling dispatch — skip restart.
      if (
        id !== params.ticketId &&
        ticketIsAwaitingVendorAvailabilityProbe(
          typeof row.vendor_notify_error === "string" ? row.vendor_notify_error : null,
        )
      ) {
        return false
      }
      return true
    })

    if (openSiblings.length > 1) {
      visitItems = openSiblings.map((row) => {
        const id = String(row.id)
        const description = String(row.description ?? "")
        const headline =
          (typeof row.issue_headline === "string" && row.issue_headline.trim()) ||
          description.split("\n")[0]?.trim() ||
          null
        return {
          ticketId: id,
          description,
          issueCategory:
            typeof row.issue_category === "string" ? row.issue_category : null,
          issueHeadline: headline,
        }
      })
      // Ensure the triggering ticket is included first for stable primary id.
      visitItems.sort((a, b) => {
        if (a.ticketId === params.ticketId) return -1
        if (b.ticketId === params.ticketId) return 1
        return a.ticketId.localeCompare(b.ticketId)
      })
    }
  }

  const isVisitGroup = visitItems.length > 1 && Boolean(inspectionReportId)
  const visitTicketIds = visitItems.map((v) => v.ticketId)

  const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
  const residentAvailabilityText = sanitizeResidentAvailabilityForVendor(
    params.residentAvailabilityText,
    [params.description, params.issueHeadline],
  )

  const primary = visitItems[0]!
  const wo = formatWorkOrderRef(primary.ticketId)
  const issueHeadline = primary.issueHeadline?.trim() || null
  const entryOkIfAbsent = typeof params.entryOkIfAbsent === "boolean"
    ? params.entryOkIfAbsent
    : null
  const urgent = params.urgent === true
  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: params.landlordId,
    ticketId: primary.ticketId,
    unitFallback: params.unit,
  })

  const inspectionRef = inspectionReportId
    ? `IR-${inspectionReportId.replace(/-/g, "").slice(0, 4).toUpperCase()}`
    : null

  // Persist a probe host state per ticket so landlord/vendor progress stays
  // independently trackable, while visitTicketIds links them for fan-out.
  for (const item of visitItems) {
    const probe: VendorAvailabilityProbe = {
      ticketId: item.ticketId,
      landlordId: params.landlordId,
      unit: locationLabel || params.unit,
      issueCategory: item.issueCategory,
      description: item.description,
      issueHeadline: item.issueHeadline,
      entryOkIfAbsent,
      urgent,
      residentAvailabilityText,
      candidates,
      offers: [],
      declinedVendorIds: [],
      status: "probing",
      startedAt: new Date().toISOString(),
      firstOfferAt: null,
      statusSmsSentAt: null,
      holdUntil: null,
      landlordNotifiedAt: null,
      insightAutoAssign: params.insightAutoAssign === true,
      insightSchedulingRequestId: params.insightSchedulingRequestId ?? null,
      inspectionReportId,
      visitTicketIds,
    }
    const host = await loadLandlordProbeConversation(
      supabase,
      params.landlordId,
      item.ticketId,
    )
    if (host) {
      await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
    }
  }

  let probed = 0
  for (const candidate of candidates) {
    if (!candidate.phone) continue
    const body = isVisitGroup
      ? buildVendorInspectionVisitProbeSms({
        vendorName: candidate.name,
        companyName: companyName || null,
        location: locationLabel || params.unit,
        urgent,
        inspectionRef,
        items: visitItems.map((item) => ({
          label: checklistLabelFromTicketDescription(item.description),
          workOrderRef: formatWorkOrderRef(item.ticketId),
        })),
      })
      : buildVendorAvailabilityProbeSms({
        vendorName: candidate.name,
        companyName: companyName || null,
        workOrderRef: wo,
        location: locationLabel || params.unit,
        issueHeadline,
        entryOkIfAbsent,
        urgent,
        residentAvailabilityText,
      })
    const sent = await sendVendorJobAlert(supabase, {
      ticketId: primary.ticketId,
      vendorId: candidate.vendorId,
      vendorPhone: candidate.phone,
      body,
      landlordId: params.landlordId,
      // Soft-offer only — landlord YES assigns + sends the real job SMS.
      bindAssignment: false,
    })
    if (!sent.ok) {
      console.warn("[vendor-probe] soft offer failed", candidate.vendorId, sent.error)
      continue
    }
    probed += 1

    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", sent.conversationId)
      .maybeSingle()
    let nextIntake =
      conv?.intake_state && typeof conv.intake_state === "object"
        ? { ...(conv.intake_state as Record<string, unknown>) }
        : {}
    const sentAt = new Date().toISOString()
    for (const item of visitItems) {
      nextIntake = upsertAwaitingVendorProbeOnIntake(nextIntake, {
        ticketId: item.ticketId,
        vendorId: candidate.vendorId,
        sentAt,
        workOrderRef: formatWorkOrderRef(item.ticketId),
        issueHeadline: item.issueHeadline,
        inspectionReportId,
      })
    }
    await supabase
      .from("sms_conversations")
      .update({
        intake_state: nextIntake,
        maintenance_request_id: primary.ticketId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sent.conversationId)
  }

  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notify_error: AWAITING_VENDOR_AVAILABILITY_PROBE,
      awaiting_vendor_availability_at: new Date().toISOString(),
    })
    .in("id", visitTicketIds)

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_availability_probed",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: primary.ticketId,
    metadata: {
      message: isVisitGroup
        ? probed === 1
          ? `Asked 1 vendor for availability on an inspection visit (${visitTicketIds.length} items) before assigning.`
          : `Asked ${probed} vendors for availability on an inspection visit (${visitTicketIds.length} items) before assigning.`
        : probed === 1
        ? `Asked 1 vendor for availability on ${wo} before assigning.`
        : `Asked ${probed} vendors for availability on ${wo} before assigning.`,
      probed,
      candidate_ids: candidates.map((c) => c.vendorId),
      inspection_report_id: inspectionReportId,
      visit_ticket_ids: visitTicketIds,
    },
  })

  if (probed === 0) {
    return { probed: 0, skipReason: "no_vendor" }
  }
  return { probed }
}

function extractEstimateNote(body: string): string | null {
  const money = body.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/)
  if (money?.[0]) return money[0].replace(/\s+/g, "")
  const approx = body.match(
    /\b(?:about|around|estimate(?:d)?|quote(?:d)?)\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?\b/i,
  )
  return approx?.[0]?.trim() || null
}

function looksLikeProbeDecline(body: string): boolean {
  const t = body.trim()
  if (/^(n|no|nope|nah|decline|can't|cannot|unable)\b/i.test(t)) return true
  if (/\b(can't take|cannot take|unable to take|not available|pass on this)\b/i.test(t)) {
    return true
  }
  return false
}

async function sendLandlordProbeStatusSms(
  supabase: SupabaseClient,
  probe: VendorAvailabilityProbe,
): Promise<void> {
  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: probe.landlordId,
    ticketId: probe.ticketId,
    unitFallback: probe.unit,
  })
  const body = buildLandlordProbeStatusSms({
    issueHeadline: probe.issueHeadline,
    locationLabel: locationLabel || probe.unit,
    unit: probe.unit,
  })

  const main = await findActiveLandlordMainNumber(supabase, probe.landlordId)
  const { getSMSProviderForSend } = await import("./sms/providerFactory.ts")
  const provider = getSMSProviderForSend({
    landlordId: probe.landlordId,
    lineProvider: main?.provider,
  })
  const { phones } = await import("./sms/tenantActivationAdminAlert.ts").then((m) =>
    m.resolveLandlordOpsPhones(supabase, probe.landlordId)
  )

  for (const phone of phones) {
    const sendResult = await provider.sendMessage({
      to: phone,
      body,
      from: main?.phone_number,
    })
    if (sendResult.error) {
      console.error("[vendor-probe] status SMS", phone, sendResult.error)
      continue
    }
    try {
      const identity = await upsertSmsIdentityForPhone(supabase, {
        landlordId: probe.landlordId,
        phone,
        identityType: "landlord",
      })
      if (!identity || !main?.id) continue
      const { conversationId } = await findOrCreateConversation(supabase, {
        landlordId: probe.landlordId,
        smsNumberId: main.id,
        externalPhone: phone,
        identity,
        maintenanceRequestId: probe.ticketId,
        conversationStatus: "open",
      })
      const { data: conv } = await supabase
        .from("sms_conversations")
        .select("intake_state")
        .eq("id", conversationId)
        .maybeSingle()
      const prior =
        conv?.intake_state && typeof conv.intake_state === "object"
          ? { ...(conv.intake_state as Record<string, unknown>) }
          : {}
      // Persist hold probe on the ops thread — do NOT set awaiting_vendor_choice.
      await saveProbeOnLandlordThread(supabase, conversationId, {
        ...prior,
        // Keep conversation type landlord so hold replies stay on this path.
      }, {
        ...probe,
        // Ensure status is holding before save (caller may have set it).
        status: "holding",
      })
      await supabase
        .from("sms_conversations")
        .update({
          conversation_type: "landlord_update",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
    } catch (e) {
      console.error("[vendor-probe] persist status SMS", e)
    }
  }

  await recordActivityLog(supabase, {
    landlordId: probe.landlordId,
    eventType: "maintenance.vendor_probe_status_sent",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: probe.ticketId,
    metadata: {
      message: `Told the landlord vendors are being checked for availability on ${formatWorkOrderRef(probe.ticketId)}.`,
    },
  })
}

/** Send exactly one decision SMS (YES or 1/2). Idempotent via landlordNotifiedAt. */
export async function finalizeLandlordProbeDecision(
  supabase: SupabaseClient,
  probe: VendorAvailabilityProbe,
): Promise<{ sent: boolean }> {
  if (probe.offers.length === 0) return { sent: false }
  if (probe.landlordNotifiedAt) return { sent: false }

  const nowIso = new Date().toISOString()
  probe.landlordNotifiedAt = nowIso
  probe.status = "awaiting_landlord"

  const visitTicketIds =
    probe.visitTicketIds && probe.visitTicketIds.length > 0
      ? probe.visitTicketIds
      : [probe.ticketId]
  const isVisit = visitTicketIds.length > 1 && Boolean(probe.inspectionReportId)

  // Mirror decision state onto every visit sibling so cron doesn't re-SMS.
  for (const ticketId of visitTicketIds) {
    const host = await loadLandlordProbeConversation(
      supabase,
      probe.landlordId,
      ticketId,
    )
    if (!host) continue
    const sibling = ticketId === probe.ticketId
      ? probe
      : (await loadVendorAvailabilityProbeForTicket(supabase, ticketId)) ?? {
        ...probe,
        ticketId,
      }
    sibling.landlordNotifiedAt = nowIso
    sibling.status = "awaiting_landlord"
    sibling.offers = probe.offers
    sibling.visitTicketIds = visitTicketIds
    sibling.inspectionReportId = probe.inspectionReportId ?? null
    await saveProbeOnLandlordThread(
      supabase,
      host.conversationId,
      host.intake,
      sibling,
    )
  }

  const enriched = probeOffersToChoiceNames(probe.offers)
  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: probe.landlordId,
    ticketId: probe.ticketId,
    unitFallback: probe.unit,
  })

  if (isVisit) {
    const { data: tickets } = await supabase
      .from("maintenance_requests")
      .select("id, description, issue_headline")
      .in("id", visitTicketIds)
    const items = (tickets ?? []).map((t) => ({
      label: checklistLabelFromTicketDescription(
        (typeof t.issue_headline === "string" && t.issue_headline.trim()) ||
          String(t.description ?? ""),
      ),
      workOrderRef: formatWorkOrderRef(String(t.id)),
    }))
    const primaryOffer = probe.offers[0]
    await notifyLandlordVendorChoice(supabase, {
      landlordId: probe.landlordId,
      ticketId: probe.ticketId,
      unit: probe.unit,
      issueCategory: probe.issueCategory,
      options: enriched,
      reason: "availability",
      issueHeadline: `inspection visit (${visitTicketIds.length} items)`,
      locationLabel,
      availabilityByVendorId: probeOffersAvailabilityByVendorId(probe.offers),
      visitTicketIds,
      inspectionReportId: probe.inspectionReportId ?? null,
      visitItems: items,
      visitVendorName: primaryOffer?.name ?? enriched[0]?.vendor?.name ?? null,
    })
  } else {
    await notifyLandlordVendorChoice(supabase, {
      landlordId: probe.landlordId,
      ticketId: probe.ticketId,
      unit: probe.unit,
      issueCategory: probe.issueCategory,
      options: enriched,
      reason: "availability",
      issueHeadline: probe.issueHeadline,
      locationLabel,
      availabilityByVendorId: probeOffersAvailabilityByVendorId(probe.offers),
    })
  }

  for (const ticketId of visitTicketIds) {
    await markAwaitingLandlordVendorChoice(supabase, ticketId)
  }

  return { sent: true }
}

/**
 * After a vendor offer/decline (or cron): either send the status SMS, keep
 * holding, or finalize the one decision message.
 */
export async function progressLandlordProbeAfterOffer(
  supabase: SupabaseClient,
  probe: VendorAvailabilityProbe,
  nowMs: number = Date.now(),
): Promise<"status" | "holding" | "decision" | "noop"> {
  if (probe.insightAutoAssign) return "noop"
  if (probe.offers.length === 0) return "noop"
  if (probe.landlordNotifiedAt || probe.status === "awaiting_landlord") {
    return "noop"
  }

  const phoneCount = probePhoneCandidates(probe).length
  const nowIso = new Date(nowMs).toISOString()

  // Multi-vendor: first offer → status-only (not replyable as approval).
  if (phoneCount > 1 && !probe.statusSmsSentAt) {
    probe.status = "holding"
    probe.firstOfferAt = probe.firstOfferAt || nowIso
    probe.statusSmsSentAt = nowIso
    probe.holdUntil = new Date(nowMs + VENDOR_PROBE_HOLD_MS).toISOString()
    await sendLandlordProbeStatusSms(supabase, probe)
    const host = await loadLandlordProbeConversation(
      supabase,
      probe.landlordId,
      probe.ticketId,
    )
    if (host) {
      await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
    }
    return "status"
  }

  if (shouldFinalizeVendorProbeHold(probe, nowMs)) {
    await finalizeLandlordProbeDecision(supabase, probe)
    return "decision"
  }

  probe.status = "holding"
  if (!probe.firstOfferAt) probe.firstOfferAt = nowIso
  if (!probe.holdUntil && probe.firstOfferAt) {
    const start = Date.parse(probe.firstOfferAt)
    if (Number.isFinite(start)) {
      probe.holdUntil = new Date(start + VENDOR_PROBE_HOLD_MS).toISOString()
    }
  }
  const host = await loadLandlordProbeConversation(
    supabase,
    probe.landlordId,
    probe.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }
  return "holding"
}

/** Cron: finalize holds whose timeout elapsed with at least one offer. */
export async function processExpiredVendorProbeHolds(
  supabase: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ finalized: number }> {
  const { data: tickets, error } = await supabase
    .from("maintenance_requests")
    .select("id, landlord_id")
    .ilike("vendor_notify_error", `%${AWAITING_VENDOR_AVAILABILITY_PROBE}%`)
    .limit(80)
  if (error) {
    console.error("[vendor-probe] list holding tickets", error.message)
    return { finalized: 0 }
  }

  let finalized = 0
  for (const row of tickets ?? []) {
    const ticketId = typeof row.id === "string" ? row.id : ""
    if (!ticketId) continue
    const probe = await loadVendorAvailabilityProbeForTicket(supabase, ticketId)
    if (!probe) continue
    if (!shouldFinalizeVendorProbeHold(probe, nowMs)) continue
    const result = await finalizeLandlordProbeDecision(supabase, probe)
    if (result.sent) finalized += 1
  }
  return { finalized }
}

export async function tryHandleVendorAvailabilityProbeInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
    vendorId?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; replyBody: string }
> {
  if (params.identityType !== "vendor") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  let intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  const pendingList = readAwaitingVendorProbes(intake)
  const clarify = readAwaitingVendorProbeClarify(intake)
  if (pendingList.length === 0 && !clarify) return { handled: false }

  const resolved = resolveVendorProbeTicketFromReply({
    body: params.body,
    probes: pendingList,
    clarify,
  })

  if (resolved.kind === "none") return { handled: false }

  if (resolved.kind === "ambiguous") {
    const options = resolved.probes.map((p) => ({
      ticketId: p.ticketId,
      workOrderRef: p.workOrderRef ?? formatWorkOrderRef(p.ticketId),
      label: (p.issueHeadline ?? "").trim() ||
        (p.workOrderRef ?? formatWorkOrderRef(p.ticketId)),
    }))
    intake = setAwaitingVendorProbeClarifyOnIntake(intake, {
      options,
      askedAt: new Date().toISOString(),
    })
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)
    return {
      handled: true,
      replyBody: buildVendorProbeWhichJobSms(resolved.probes),
    }
  }

  const targetProbes: AwaitingVendorProbe[] =
    resolved.kind === "visit_group" ? resolved.probes : [resolved.probe]
  const bodyForParse = resolved.bodyForParse
  const primaryPending = targetProbes[0]!
  // Clear clarify once a ticket or visit group is chosen.
  delete intake.awaiting_vendor_probe_clarify

  const vendorId = params.vendorId?.trim() || primaryPending.vendorId
  const probe = await loadVendorAvailabilityProbeForTicket(
    supabase,
    primaryPending.ticketId,
  )
  if (!probe) {
    for (const p of targetProbes) {
      intake = removeAwaitingVendorProbeFromIntake(intake, p.ticketId)
    }
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)
    return {
      handled: true,
      replyBody:
        "Thanks — that availability request is no longer open. We'll text you if a new job comes up.",
    }
  }

  const visitTicketIds =
    (probe.visitTicketIds && probe.visitTicketIds.length > 0
      ? probe.visitTicketIds
      : targetProbes.map((p) => p.ticketId))
  const isVisitReply = resolved.kind === "visit_group" || visitTicketIds.length > 1
  const wo = formatWorkOrderRef(probe.ticketId)
  const candidate = probe.candidates.find((c) => c.vendorId === vendorId)
  const vendorName = candidate?.name || "Vendor"
  const role = candidate?.role || "specialist"

  if (looksLikeProbeDecline(bodyForParse)) {
    // WO-scoped matched decline → one ticket; visit_group / bare NO → whole visit.
    const declineIds = resolved.kind === "matched"
      ? [resolved.probe.ticketId]
      : visitTicketIds

    for (const ticketId of declineIds) {
      const ticketProbe = ticketId === probe.ticketId
        ? probe
        : await loadVendorAvailabilityProbeForTicket(supabase, ticketId) ?? probe
      if (!ticketProbe.declinedVendorIds.includes(vendorId)) {
        ticketProbe.declinedVendorIds.push(vendorId)
      }
      intake = removeAwaitingVendorProbeFromIntake(intake, ticketId)
      const host = await loadLandlordProbeConversation(
        supabase,
        ticketProbe.landlordId,
        ticketId,
      )
      if (host) {
        await saveProbeOnLandlordThread(
          supabase,
          host.conversationId,
          host.intake,
          { ...ticketProbe, ticketId },
        )
      }
      await recordActivityLog(supabase, {
        landlordId: probe.landlordId,
        eventType: "maintenance.vendor_probe_declined",
        source: "sms",
        actorType: "vendor",
        actorId: vendorId,
        vendorId,
        maintenanceRequestId: ticketId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        metadata: {
          message: `${vendorName} declined the availability ask for ${formatWorkOrderRef(ticketId)}.`,
        },
      })
      // Soft probes usually leave the ticket unassigned. When a race (or
      // parallel assign) left this vendor on pending_accept, persist the NO so
      // Active Tasks / Overview do not keep saying "waiting to accept."
      const declined = await applyVendorStatusTransition(supabase, {
        ticketId,
        vendorId,
        action: "decline",
        source: "sms",
        conversationId: params.conversationId,
        askAvailability: false,
        skipAutoReassign: true,
      })
      if (!declined.ok && declined.reason !== "not_assigned_to_vendor") {
        console.warn(
          "[vendor-probe] decline status transition",
          ticketId,
          declined.reason,
        )
      }
    }
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)

    const allDeclined =
      probe.offers.length === 0 &&
      probe.candidates.length > 0 &&
      probe.candidates.every((c) => probe.declinedVendorIds.includes(c.vendorId))
    if (allDeclined && declineIds.includes(probe.ticketId)) {
      if (probe.insightAutoAssign) {
        const requestId = probe.insightSchedulingRequestId?.trim()
        if (requestId) {
          const { markInsightSchedulingNeedsExternal } = await import(
            "./insightInspectorScheduling.ts"
          )
          await markInsightSchedulingNeedsExternal(supabase, requestId)
        }
        await supabase
          .from("maintenance_requests")
          .update({
            vendor_notify_error: null,
            awaiting_vendor_availability_at: null,
          })
          .in("id", declineIds)
      } else {
        const fallbackOptions: VendorAssignmentOption[] = probe.candidates.map((c) => ({
          vendor: {
            id: c.vendorId,
            name: c.name,
            email: null,
            phone: c.phone,
            notification_channel: "sms",
            active: true,
            category: null,
            portal_api_key: null,
            last_assigned_at: null,
            created_at: "",
          } satisfies VendorAssignmentRow,
          role: c.role,
        }))
        await notifyLandlordVendorChoice(supabase, {
          landlordId: probe.landlordId,
          ticketId: probe.ticketId,
          unit: probe.unit,
          issueCategory: probe.issueCategory,
          options: fallbackOptions,
          reason: "declined",
        })
        for (const ticketId of declineIds) {
          await markAwaitingLandlordVendorChoice(supabase, ticketId)
        }
      }
    } else if (
      !probe.insightAutoAssign &&
      probe.offers.length > 0 &&
      shouldFinalizeVendorProbeHold(probe)
    ) {
      await finalizeLandlordProbeDecision(supabase, probe)
    }

    const declineLabel = declineIds.length > 1
      ? "the inspection visit"
      : formatWorkOrderRef(declineIds[0]!)
    return {
      handled: true,
      replyBody: `Got it — thanks for letting us know about ${declineLabel}.`,
    }
  }

  const resolvedAvail = await resolveVendorAvailability(bodyForParse, {
    conversationContext: undefined,
    clarifyAttempts: 0,
    timeZone: await (async () => {
      try {
        const { loadLandlordOperationalSettings } = await import(
          "./landlordNotificationPrefs.ts"
        )
        const ops = await loadLandlordOperationalSettings(
          supabase,
          probe.landlordId,
        )
        return ops.timeZone?.trim() || undefined
      } catch {
        return undefined
      }
    })(),
  })

  if (resolvedAvail.status === "needs_clarification") {
    return {
      handled: true,
      replyBody: resolvedAvail.softPrompt ||
        (isVisitReply
          ? "Thanks — what day and time works for the whole visit? For example: Tomorrow 9am–12pm."
          : `Thanks — what day and time works best for ${wo}? For example: Tomorrow 9am–12pm.`),
    }
  }

  const value: ResolvedAvailability = resolvedAvail.value
  const windowLabel =
    value.entity?.display_text?.trim() ||
    value.windowLabel?.trim() ||
    "the window you shared"
  const estimateNote = extractEstimateNote(bodyForParse)

  const offer: VendorProbeOffer = {
    vendorId,
    name: vendorName,
    role,
    windowLabel,
    scheduledAt: value.scheduledAt,
    endAt: value.endAt,
    estimateNote,
    receivedAt: new Date().toISOString(),
  }

  // Visit-group bare window → every pending ticket in the group; WO-scoped → one.
  const applyIds = resolved.kind === "matched"
    ? [resolved.probe.ticketId]
    : visitTicketIds.filter((id) =>
      targetProbes.some((p) => p.ticketId === id) || visitTicketIds.includes(id)
    )

  const schedulePatch: Record<string, unknown> = {}
  if (offer.scheduledAt) schedulePatch.scheduled_at = offer.scheduledAt
  if (offer.windowLabel.trim()) {
    schedulePatch.scheduled_window_text = offer.windowLabel.trim()
  }
  // Visit window is shared across the inspection group on the vendor's reply.
  if (applyIds.length > 1 || resolved.kind === "visit_group") {
    schedulePatch.schedule_confirmed_at = new Date().toISOString()
  }
  if (Object.keys(schedulePatch).length > 0) {
    await supabase
      .from("maintenance_requests")
      .update(schedulePatch)
      .in("id", applyIds)
  }

  for (const ticketId of applyIds) {
    const ticketProbe = ticketId === probe.ticketId
      ? probe
      : await loadVendorAvailabilityProbeForTicket(supabase, ticketId)
    const active = ticketProbe ?? { ...probe, ticketId }
    const existingIdx = active.offers.findIndex((o) => o.vendorId === vendorId)
    if (existingIdx >= 0) active.offers[existingIdx] = offer
    else active.offers.push(offer)
    intake = removeAwaitingVendorProbeFromIntake(intake, ticketId)
    const host = await loadLandlordProbeConversation(
      supabase,
      active.landlordId,
      ticketId,
    )
    if (host) {
      await saveProbeOnLandlordThread(
        supabase,
        host.conversationId,
        host.intake,
        { ...active, visitTicketIds, inspectionReportId: probe.inspectionReportId },
      )
    }
    await recordActivityLog(supabase, {
      landlordId: probe.landlordId,
      eventType: "maintenance.vendor_probe_offer",
      source: "sms",
      actorType: "vendor",
      actorId: vendorId,
      vendorId,
      maintenanceRequestId: ticketId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      metadata: {
        message: `${vendorName} offered ${windowLabel} for ${formatWorkOrderRef(ticketId)}.`,
        window_label: windowLabel,
        estimate_note: estimateNote,
        inspection_report_id: probe.inspectionReportId ?? null,
      },
    })
  }

  await supabase
    .from("sms_conversations")
    .update({ intake_state: intake, updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)

  // Keep primary probe offers in sync for landlord progress.
  const primaryExistingIdx = probe.offers.findIndex((o) => o.vendorId === vendorId)
  if (primaryExistingIdx >= 0) probe.offers[primaryExistingIdx] = offer
  else probe.offers.push(offer)
  probe.visitTicketIds = visitTicketIds
  probe.inspectionReportId = probe.inspectionReportId ??
    (resolved.kind === "visit_group" ? resolved.inspectionReportId : null)

  // Insight inspector path: auto-assign immediately (landlord already tapped Schedule).
  if (probe.insightAutoAssign) {
    const { assignVendorAndNotify } = await import(
      "../submit-maintenance-request/vendor_notify.ts"
    )
    const { markInsightSchedulingAccepted } = await import(
      "./insightInspectorScheduling.ts"
    )
    for (const ticketId of applyIds) {
      const ticketProbe = await loadVendorAvailabilityProbeForTicket(supabase, ticketId)
      await assignVendorAndNotify(supabase, {
        ticketId,
        priority: "normal",
        unit: (ticketProbe ?? probe).unit,
        description: (ticketProbe ?? probe).description,
        issueHeadline: (ticketProbe ?? probe).issueHeadline,
        entryOkIfAbsent: (ticketProbe ?? probe).entryOkIfAbsent,
        urgency: null,
        severity: null,
        dueAt: null,
        estimatedMinutes: null,
        landlordId: probe.landlordId,
        preferVendorId: vendorId,
        landlordAcknowledged: true,
        residentAvailabilityText: probe.residentAvailabilityText,
        retryIfUnassigned: true,
      })
    }

    const requestId = probe.insightSchedulingRequestId?.trim()
    if (requestId) {
      await markInsightSchedulingAccepted(supabase, {
        requestId,
        inspectorName: vendorName,
        confirmedWindow: offer.windowLabel.trim() || null,
        vendorId,
      })
    }

    return {
      handled: true,
      replyBody: applyIds.length > 1
        ? buildVendorInspectionVisitAckSms({
          windowLabel,
          itemCount: applyIds.length,
        })
        : buildVendorProbeAckSms({
          windowLabel,
          workOrderRef: formatWorkOrderRef(applyIds[0]!),
        }),
    }
  }

  // Multi-vendor: status-only → hold → one decision SMS (no mid-flight YES→1/2).
  // Visit groups finalize once against the primary probe (covers all ticket ids).
  await progressLandlordProbeAfterOffer(supabase, probe)

  return {
    handled: true,
    replyBody: applyIds.length > 1
      ? buildVendorInspectionVisitAckSms({
        windowLabel,
        itemCount: applyIds.length,
      })
      : buildVendorProbeAckSms({
        windowLabel,
        workOrderRef: formatWorkOrderRef(applyIds[0]!),
      }),
  }
}

/** Look up a stored probe offer for the vendor the landlord just picked. */
export async function findProbeOfferForVendor(
  supabase: SupabaseClient,
  ticketId: string,
  vendorId: string,
): Promise<VendorProbeOffer | null> {
  const probe = await loadVendorAvailabilityProbeForTicket(supabase, ticketId)
  if (!probe) return null
  return probe.offers.find((o) => o.vendorId === vendorId) ?? null
}

/**
 * Rebuild multi-ticket pending probes on a vendor thread from open ticket rows,
 * and optionally send one consolidated reminder listing every WO still waiting.
 * Use after a last-write-wins batch (e.g. HQS letter) clobbered the single slot.
 */
export async function remediateOpenVendorProbesOnThread(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    vendorId: string
    ticketIds: string[]
    sendReminderSms?: boolean
  },
): Promise<{
  synced: number
  reminderSent: boolean
  probes: AwaitingVendorProbe[]
}> {
  const { data: tickets } = await supabase
    .from("maintenance_requests")
    .select("id, description, assigned_vendor_id, vendor_notify_error")
    .in("id", params.ticketIds)

  const openProbeTickets = (tickets ?? []).filter((t) => {
    const id = typeof t.id === "string" ? t.id : ""
    if (!id) return false
    if (!ticketIsAwaitingVendorAvailabilityProbe(
      typeof t.vendor_notify_error === "string" ? t.vendor_notify_error : null,
    )) {
      return false
    }
    const assigned =
      typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id.trim() : ""
    return !assigned || assigned === params.vendorId
  })

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state, external_phone_number, vendor_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  let intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}

  const probes: AwaitingVendorProbe[] = []
  const now = new Date().toISOString()
  for (const t of openProbeTickets) {
    const ticketId = String(t.id)
    const headline = String(t.description ?? "").split("\n")[0]?.trim() || null
    const probe: AwaitingVendorProbe = {
      ticketId,
      vendorId: params.vendorId,
      sentAt: now,
      workOrderRef: formatWorkOrderRef(ticketId),
      issueHeadline: headline,
    }
    intake = upsertAwaitingVendorProbeOnIntake(intake, probe)
    probes.push(probe)
  }

  // Drop clarify so the consolidated list is the source of truth.
  delete intake.awaiting_vendor_probe_clarify

  await supabase
    .from("sms_conversations")
    .update({
      intake_state: intake,
      updated_at: now,
      vendor_id: params.vendorId,
    })
    .eq("id", params.conversationId)

  let reminderSent = false
  if (params.sendReminderSms !== false && probes.length > 0) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, phone")
      .eq("id", params.vendorId)
      .maybeSingle()
    const phone =
      (typeof vendor?.phone === "string" && vendor.phone.trim()) ||
      (typeof conv?.external_phone_number === "string"
        ? conv.external_phone_number.trim()
        : "")
    if (phone) {
      const body = buildVendorOpenProbesReminderSms({
        vendorName: typeof vendor?.name === "string" ? vendor.name : "there",
        probes: probes.map((p) => ({
          workOrderRef: p.workOrderRef ?? formatWorkOrderRef(p.ticketId),
          issueHeadline: p.issueHeadline,
        })),
      })
      const sent = await sendVendorJobAlert(supabase, {
        ticketId: probes[probes.length - 1]!.ticketId,
        vendorId: params.vendorId,
        vendorPhone: phone,
        body,
        landlordId: params.landlordId,
        bindAssignment: false,
      })
      reminderSent = sent.ok
      if (sent.ok) {
        await recordActivityLog(supabase, {
          landlordId: params.landlordId,
          eventType: "maintenance.vendor_probe_batch_reminder",
          source: "automation",
          actorType: "system",
          vendorId: params.vendorId,
          conversationId: params.conversationId,
          metadata: {
            message:
              `Sent a consolidated availability reminder covering ${probes.length} open work orders.`,
            ticket_ids: probes.map((p) => p.ticketId),
          },
        })
      }
    }
  }

  return { synced: probes.length, reminderSent, probes }
}
