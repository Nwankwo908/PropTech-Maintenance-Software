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
  formatWorkOrderRef,
  titleCaseCompanyName,
  vendorCompanyName,
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
}

export type AwaitingVendorProbe = {
  ticketId: string
  vendorId: string
  sentAt: string
}

export function ticketIsAwaitingVendorAvailabilityProbe(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_VENDOR_AVAILABILITY_PROBE)
}

export function readAwaitingVendorProbe(
  intakeState: unknown,
): AwaitingVendorProbe | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_vendor_probe
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  const vendorId = typeof row.vendor_id === "string" ? row.vendor_id.trim() : ""
  if (!ticketId || !vendorId) return null
  return {
    ticketId,
    vendorId,
    sentAt: typeof row.sent_at === "string" ? row.sent_at : "",
  }
}

export function canHandleVendorAvailabilityProbe(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType !== "vendor") return false
  return readAwaitingVendorProbe(input.intakeState) != null
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

  const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
  const residentAvailabilityText = sanitizeResidentAvailabilityForVendor(
    params.residentAvailabilityText,
    [params.description, params.issueHeadline],
  )

  const wo = formatWorkOrderRef(params.ticketId)
  const issueHeadline = params.issueHeadline?.trim() || null
  const entryOkIfAbsent = typeof params.entryOkIfAbsent === "boolean"
    ? params.entryOkIfAbsent
    : null
  const urgent = params.urgent === true
  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: params.landlordId,
    ticketId: params.ticketId,
    unitFallback: params.unit,
  })
  const probe: VendorAvailabilityProbe = {
    ticketId: params.ticketId,
    landlordId: params.landlordId,
    unit: locationLabel || params.unit,
    issueCategory: params.issueCategory,
    description: params.description,
    issueHeadline,
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
  }

  const host = await loadLandlordProbeConversation(
    supabase,
    params.landlordId,
    params.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }

  let probed = 0
  for (const candidate of candidates) {
    if (!candidate.phone) continue
    const body = buildVendorAvailabilityProbeSms({
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
      ticketId: params.ticketId,
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
    const prior =
      conv?.intake_state && typeof conv.intake_state === "object"
        ? { ...(conv.intake_state as Record<string, unknown>) }
        : {}
    await supabase
      .from("sms_conversations")
      .update({
        intake_state: {
          ...prior,
          awaiting_vendor_probe: {
            ticket_id: params.ticketId,
            vendor_id: candidate.vendorId,
            sent_at: new Date().toISOString(),
          },
        },
        maintenance_request_id: params.ticketId,
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
    .eq("id", params.ticketId)

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_availability_probed",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      message:
        probed === 1
          ? `Asked 1 vendor for availability on ${wo} before assigning.`
          : `Asked ${probed} vendors for availability on ${wo} before assigning.`,
      probed,
      candidate_ids: candidates.map((c) => c.vendorId),
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

  const host = await loadLandlordProbeConversation(
    supabase,
    probe.landlordId,
    probe.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }

  const enriched = probeOffersToChoiceNames(probe.offers)
  const locationLabel = await resolveVendorProbeLocationLabel(supabase, {
    landlordId: probe.landlordId,
    ticketId: probe.ticketId,
    unitFallback: probe.unit,
  })

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

  await markAwaitingLandlordVendorChoice(supabase, probe.ticketId)

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
  const intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  const pending = readAwaitingVendorProbe(intake)
  if (!pending) return { handled: false }

  const vendorId = params.vendorId?.trim() || pending.vendorId
  const probe = await loadVendorAvailabilityProbeForTicket(supabase, pending.ticketId)
  if (!probe) {
    delete intake.awaiting_vendor_probe
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

  const wo = formatWorkOrderRef(probe.ticketId)
  const candidate = probe.candidates.find((c) => c.vendorId === vendorId)
  const vendorName = candidate?.name || "Vendor"
  const role = candidate?.role || "specialist"

  if (looksLikeProbeDecline(params.body)) {
    if (!probe.declinedVendorIds.includes(vendorId)) {
      probe.declinedVendorIds.push(vendorId)
    }
    delete intake.awaiting_vendor_probe
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)

    const host = await loadLandlordProbeConversation(
      supabase,
      probe.landlordId,
      probe.ticketId,
    )
    if (host) await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)

    await recordActivityLog(supabase, {
      landlordId: probe.landlordId,
      eventType: "maintenance.vendor_probe_declined",
      source: "sms",
      actorType: "vendor",
      actorId: vendorId,
      vendorId,
      maintenanceRequestId: probe.ticketId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      metadata: {
        message: `${vendorName} declined the availability ask for ${wo}.`,
      },
    })

    const allDeclined =
      probe.offers.length === 0 &&
      probe.candidates.length > 0 &&
      probe.candidates.every((c) => probe.declinedVendorIds.includes(c.vendorId))
    if (allDeclined) {
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
          .eq("id", probe.ticketId)
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
        await markAwaitingLandlordVendorChoice(supabase, probe.ticketId)
      }
    } else if (
      !probe.insightAutoAssign &&
      probe.offers.length > 0 &&
      shouldFinalizeVendorProbeHold(probe)
    ) {
      // Remaining vendors declined — finalize with whoever offered.
      await finalizeLandlordProbeDecision(supabase, probe)
    }

    return {
      handled: true,
      replyBody: `Got it — thanks for letting us know about ${wo}.`,
    }
  }

  const resolved = await resolveVendorAvailability(params.body, {
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

  if (resolved.status === "needs_clarification") {
    return {
      handled: true,
      replyBody: resolved.softPrompt ||
        "Thanks — what day and time works best? For example: Tomorrow 9am–12pm.",
    }
  }

  const value: ResolvedAvailability = resolved.value
  const windowLabel =
    value.entity?.display_text?.trim() ||
    value.windowLabel?.trim() ||
    "the window you shared"
  const estimateNote = extractEstimateNote(params.body)

  const existingIdx = probe.offers.findIndex((o) => o.vendorId === vendorId)
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
  if (existingIdx >= 0) probe.offers[existingIdx] = offer
  else probe.offers.push(offer)

  delete intake.awaiting_vendor_probe
  await supabase
    .from("sms_conversations")
    .update({ intake_state: intake, updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)

  const host = await loadLandlordProbeConversation(
    supabase,
    probe.landlordId,
    probe.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }

  await recordActivityLog(supabase, {
    landlordId: probe.landlordId,
    eventType: "maintenance.vendor_probe_offer",
    source: "sms",
    actorType: "vendor",
    actorId: vendorId,
    vendorId,
    maintenanceRequestId: probe.ticketId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    metadata: {
      message: `${vendorName} offered ${windowLabel} for ${wo}.`,
      window_label: windowLabel,
      estimate_note: estimateNote,
    },
  })

  // Insight inspector path: auto-assign immediately (landlord already tapped Schedule).
  if (probe.insightAutoAssign) {
    const { assignVendorAndNotify } = await import(
      "../submit-maintenance-request/vendor_notify.ts"
    )
    const { markInsightSchedulingAccepted } = await import(
      "./insightInspectorScheduling.ts"
    )
    const assignResult = await assignVendorAndNotify(supabase, {
      ticketId: probe.ticketId,
      priority: "normal",
      unit: probe.unit,
      description: probe.description,
      issueHeadline: probe.issueHeadline,
      entryOkIfAbsent: probe.entryOkIfAbsent,
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

    const patch: Record<string, unknown> = {}
    if (offer.scheduledAt) patch.scheduled_at = offer.scheduledAt
    if (offer.windowLabel.trim()) {
      patch.scheduled_window_text = offer.windowLabel.trim()
    }
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("maintenance_requests")
        .update(patch)
        .eq("id", probe.ticketId)
    }

    const requestId = probe.insightSchedulingRequestId?.trim()
    if (requestId && assignResult.assigned) {
      await markInsightSchedulingAccepted(supabase, {
        requestId,
        inspectorName: vendorName,
        confirmedWindow: offer.windowLabel.trim() || null,
        vendorId,
      })
    } else if (requestId && !assignResult.assigned) {
      const { markInsightSchedulingNeedsExternal } = await import(
        "./insightInspectorScheduling.ts"
      )
      await markInsightSchedulingNeedsExternal(supabase, requestId)
    }

    return {
      handled: true,
      replyBody: buildVendorProbeAckSms({
        windowLabel: windowLabel,
        workOrderRef: wo,
      }),
    }
  }

  // Multi-vendor: status-only → hold → one decision SMS (no mid-flight YES→1/2).
  await progressLandlordProbeAfterOffer(supabase, probe)

  return {
    handled: true,
    replyBody: buildVendorProbeAckSms({ windowLabel, workOrderRef: wo }),
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
