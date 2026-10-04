/**
 * Landlord must acknowledge by SMS before Ulo assigns any vendor.
 * One option → reply YES. Two options → reply 1 or 2.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isConfirmedDurableInboundTrigger } from "../../../shared/ops/vendorChoiceTriggerAudit.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { formatWorkOrderRef, vendorCompanyName } from "./vendor_outreach_copy.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { UNKNOWN_CONTACT_INTAKE_KEY } from "./sms/unknownContactIntake.ts"
import { getSMSProviderForSend } from "./sms/providerFactory.ts"
import { resolveLandlordOpsPhones } from "./sms/tenantActivationAdminAlert.ts"
import {
  appendLandlordAskTail,
  extractWorkOrderRefFromReply,
  landlordAskOpening,
  landlordAskSummaryLine,
  landlordNumberedChoiceReplyHint as sharedLandlordNumberedChoiceReplyHint,
  landlordYesChoiceReplyHint,
  replyMentionsLandlordAskLocation,
} from "./sms/landlordAskSms.ts"
import type { VendorAssignmentOption } from "./vendor_assignment.ts"

export type DurableLandlordChoiceTrigger =
  | { ok: true; messageId: string; providerMessageSid: string | null }
  | { ok: false; reason: string }

/**
 * Re-read the triggering inbound from sms_messages before any vendor dispatch.
 * In-memory messageId alone is not enough (WO-E6F7 phantom class).
 */
export async function confirmDurableLandlordChoiceTrigger(
  supabase: SupabaseClient,
  params: {
    messageId?: string | null
    conversationId: string
    landlordId: string
  },
): Promise<DurableLandlordChoiceTrigger> {
  const messageId = params.messageId?.trim() ?? ""
  if (!messageId) {
    return { ok: false, reason: "missing_message_id" }
  }
  const { data, error } = await supabase
    .from("sms_messages")
    .select("id, direction, conversation_id, landlord_id, provider_message_sid")
    .eq("id", messageId)
    .maybeSingle()
  if (error) {
    console.error("[vendor-choice] durable trigger lookup failed", error.message)
    return { ok: false, reason: "inbound_lookup_failed" }
  }
  return isConfirmedDurableInboundTrigger(data, {
    messageId,
    conversationId: params.conversationId,
    landlordId: params.landlordId,
  })
}

async function recordVendorChoiceSelected(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    conversationId: string
    vendorId?: string | null
    messageId: string
    providerMessageSid: string | null
    metadata: Record<string, unknown>
  },
): Promise<void> {
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_choice_selected",
    source: "sms",
    actorType: "landlord",
    vendorId: params.vendorId ?? undefined,
    maintenanceRequestId: params.ticketId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    metadata: {
      ...params.metadata,
      provider_message_sid: params.providerMessageSid,
      trigger_message_id: params.messageId,
    },
  })
}

export const AWAITING_LANDLORD_VENDOR_CHOICE = "Awaiting landlord vendor choice"

export function ticketIsAwaitingLandlordVendorChoice(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_LANDLORD_VENDOR_CHOICE)
}

/** Set the blocking flag + dwell timer when a landlord choice ask is sent. */
export async function markAwaitingLandlordVendorChoice(
  supabase: SupabaseClient,
  ticketId: string,
  at: Date = new Date(),
): Promise<void> {
  const id = ticketId.trim()
  if (!id) return
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE,
      awaiting_landlord_choice_at: at.toISOString(),
    })
    .eq("id", id)
}

/**
 * Clear the blocking flag when the landlord answers (or the ask is otherwise
 * finished). Records landlord_vendor_choice_resolved_at for cool-down.
 */
export async function clearLandlordVendorChoiceTicketFlag(
  supabase: SupabaseClient,
  ticketId: string,
  at: Date = new Date(),
): Promise<void> {
  const id = ticketId.trim()
  if (!id) return
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notify_error: null,
      awaiting_landlord_choice_at: null,
      landlord_vendor_choice_resolved_at: at.toISOString(),
    })
    .eq("id", id)
}

/**
 * Drop the blocking flag without treating it as a landlord answer (dwell /
 * loop escalation). Leaves landlord_vendor_choice_resolved_at unchanged.
 */
export async function releaseAwaitingLandlordVendorChoiceFlag(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const id = ticketId.trim()
  if (!id) return
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notify_error: null,
      awaiting_landlord_choice_at: null,
    })
    .eq("id", id)
}

/**
 * Escalate out of a stuck landlord-choice ask: clear ticket flag + pending
 * intake so automation cannot short-circuit forever. Does not mark the choice
 * as answered (no landlord_vendor_choice_resolved_at bump).
 */
export async function abandonStaleLandlordVendorChoiceAsk(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const id = ticketId.trim()
  if (!id) return
  await releaseAwaitingLandlordVendorChoiceFlag(supabase, id)

  const { data, error } = await supabase
    .from("sms_conversations")
    .select("id, intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(25)
  if (error) {
    console.error("[vendor-choice] abandon stale ask load", error)
    return
  }
  const now = new Date().toISOString()
  for (const row of data ?? []) {
    const prior =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : {}
    const awaiting = readAwaitingVendorChoice(prior)
    if (!awaiting || awaiting.ticketId !== id) continue
    const next = landlordVendorChoiceResolvedIntake(prior)
    delete next[UNKNOWN_CONTACT_INTAKE_KEY]
    await supabase
      .from("sms_conversations")
      .update({
        intake_state: next,
        updated_at: now,
      })
      .eq("id", row.id)
  }
}

/**
 * Intake + ticket fields that must all clear when a landlord vendor-choice ask
 * is finished (YES / 1 / 2, already-assigned short-circuit, etc.).
 * Pure helper for tests / Bugbot — keep in sync with clearAwaitingVendorChoice.
 */
export function landlordVendorChoiceResolvedIntake(
  priorIntake: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...priorIntake }
  delete next.awaiting_vendor_choice
  delete next.unknown_contact_intake
  delete next.vendor_availability_probe
  return next
}

export function vendorChoiceOptionIdsEqual(a: string[], b: string[]): boolean {
  const left = [...a].map((id) => id.trim()).filter(Boolean).sort()
  const right = [...b].map((id) => id.trim()).filter(Boolean).sort()
  if (left.length !== right.length) return false
  return left.every((id, i) => id === right[i])
}

export async function loadStoredAwaitingVendorChoiceForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<AwaitingVendorChoice | null> {
  const id = ticketId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(25)
  if (error) {
    console.error("[vendor-choice] load stored awaiting choice", error)
    return null
  }
  for (const row of data ?? []) {
    const awaiting = readAwaitingVendorChoice(row.intake_state)
    if (awaiting?.ticketId === id) return awaiting
  }
  return null
}

/** Landlord SMS can switch vendors while Ulo is still waiting for accept. */
export function canReplaceAssignedVendorForLandlordChoice(
  vendorWorkStatus?: string | null,
): boolean {
  const status = (vendorWorkStatus ?? "").trim().toLowerCase()
  return (
    status === "" ||
    status === "unassigned" ||
    status === "pending_accept" ||
    status === "declined"
  )
}

export type VendorChoiceOption = {
  id: string
  name: string
  role: "specialist" | "generalist" | "external"
  source?: "roster" | "external"
  searchId?: string | null
  categoryId?: string | null
  /** Availability window from a vendor probe reply (landlord-facing). */
  windowLabel?: string | null
  /** Estimate note from a vendor probe reply (e.g. "$200"). */
  estimateNote?: string | null
}

export type AwaitingVendorChoice = {
  ticketId: string
  options: VendorChoiceOption[]
  searchLocation?: string | null
  issueCategory?: string | null
  issueSummary?: string | null
  urgency?: string | null
  /** Property / address label for multi-ask disambiguation. */
  locationLabel?: string | null
  /** WO-XXXX for multi-ask disambiguation + trailing Ref line. */
  workOrderRef?: string | null
  /** Inspection visit: YES assigns every ticket in this list. */
  visitTicketIds?: string[]
  inspectionReportId?: string | null
}

function asRole(raw: unknown, source?: unknown): "specialist" | "generalist" | "external" {
  if (raw === "external" || source === "external") return "external"
  return raw === "generalist" ? "generalist" : "specialist"
}

export function isExternalVendorChoice(option: VendorChoiceOption): boolean {
  return option.role === "external" || option.source === "external"
}

export function readAwaitingVendorChoice(
  intakeState: unknown,
): AwaitingVendorChoice | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_vendor_choice
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  if (!ticketId) return null

  const options: VendorChoiceOption[] = []
  if (Array.isArray(row.options)) {
    for (const item of row.options) {
      if (!item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const id = typeof rec.id === "string" ? rec.id.trim() : ""
      const name = typeof rec.name === "string" ? rec.name.trim() : ""
      if (!id) continue
      const source =
        rec.source === "external"
          ? ("external" as const)
          : rec.source === "roster"
            ? ("roster" as const)
            : undefined
      const role = asRole(rec.role, rec.source ?? source)
      options.push({
        id,
        name: name || "the vendor",
        role,
        source: source ?? (role === "external" ? "external" : "roster"),
        searchId:
          typeof rec.search_id === "string"
            ? rec.search_id
            : typeof rec.searchId === "string"
              ? rec.searchId
              : null,
        categoryId:
          typeof rec.category_id === "string"
            ? rec.category_id
            : typeof rec.categoryId === "string"
              ? rec.categoryId
              : null,
        windowLabel:
          typeof rec.window_label === "string"
            ? rec.window_label
            : typeof rec.windowLabel === "string"
              ? rec.windowLabel
              : null,
        estimateNote:
          typeof rec.estimate_note === "string"
            ? rec.estimate_note
            : typeof rec.estimateNote === "string"
              ? rec.estimateNote
              : null,
      })
    }
  }
  if (options.length === 0) {
    const specialistId =
      typeof row.specialist_id === "string" ? row.specialist_id.trim() : ""
    const generalistId =
      typeof row.generalist_id === "string" ? row.generalist_id.trim() : ""
    const specialistName =
      typeof row.specialist_name === "string" ? row.specialist_name.trim() : ""
    const generalistName =
      typeof row.generalist_name === "string" ? row.generalist_name.trim() : ""
    if (specialistId) {
      options.push({
        id: specialistId,
        name: specialistName || "the specialist",
        role: "specialist",
      })
    }
    if (generalistId) {
      options.push({
        id: generalistId,
        name: generalistName || "the handyman",
        role: "generalist",
      })
    }
  }
  if (options.length === 0) return null
  const visitTicketIds = Array.isArray(row.visit_ticket_ids)
    ? row.visit_ticket_ids
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
    : undefined
  return {
    ticketId,
    options,
    searchLocation:
      typeof row.search_location === "string" ? row.search_location : null,
    issueCategory:
      typeof row.issue_category === "string" ? row.issue_category : null,
    issueSummary:
      typeof row.issue_summary === "string" ? row.issue_summary : null,
    urgency: typeof row.urgency === "string" ? row.urgency : null,
    locationLabel:
      typeof row.location_label === "string"
        ? row.location_label
        : typeof row.locationLabel === "string"
          ? row.locationLabel
          : typeof row.search_location === "string"
            ? row.search_location
            : null,
    workOrderRef:
      typeof row.work_order_ref === "string"
        ? row.work_order_ref
        : typeof row.workOrderRef === "string"
          ? row.workOrderRef
          : formatWorkOrderRef(ticketId),
    visitTicketIds,
    inspectionReportId:
      typeof row.inspection_report_id === "string" && row.inspection_report_id.trim()
        ? row.inspection_report_id.trim()
        : null,
  }
}

export function serializeAwaitingVendorChoice(
  awaiting: AwaitingVendorChoice,
): Record<string, unknown> {
  return {
    ticket_id: awaiting.ticketId,
    search_location: awaiting.searchLocation ?? awaiting.locationLabel ?? null,
    location_label: awaiting.locationLabel ?? awaiting.searchLocation ?? null,
    work_order_ref:
      awaiting.workOrderRef?.trim() || formatWorkOrderRef(awaiting.ticketId),
    issue_category: awaiting.issueCategory ?? null,
    issue_summary: awaiting.issueSummary ?? null,
    urgency: awaiting.urgency ?? null,
    visit_ticket_ids: awaiting.visitTicketIds ?? null,
    inspection_report_id: awaiting.inspectionReportId ?? null,
    options: awaiting.options.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      source: row.source ?? (row.role === "external" ? "external" : "roster"),
      search_id: row.searchId ?? null,
      category_id: row.categoryId ?? null,
      window_label: row.windowLabel ?? null,
      estimate_note: row.estimateNote ?? null,
    })),
  }
}

/** Strip probe suffixes; title-case so roster casing stays consistent in SMS. */
export function vendorChoiceDisplayName(name: string): string {
  const raw = name.trim()
  if (!raw) return "your vendor"
  const base = raw.split(" — ")[0]?.trim() || raw
  return vendorCompanyName(base)
}

/** True while multi-vendor probe is collecting offers (status SMS sent, no decision yet). */
export function intakeHasActiveVendorProbeHold(intakeState: unknown): boolean {
  if (!intakeState || typeof intakeState !== "object") return false
  const raw = (intakeState as Record<string, unknown>).vendor_availability_probe
  if (!raw || typeof raw !== "object") return false
  const row = raw as Record<string, unknown>
  if (row.status !== "holding") return false
  if (typeof row.landlord_notified_at === "string" && row.landlord_notified_at.trim()) {
    return false
  }
  return Array.isArray(row.offers) && row.offers.length > 0
}

export function buildLandlordProbeHoldClarifySms(): string {
  return (
    "Vendor options are still being gathered — your reply wasn't actionable yet. " +
    "I'll text you when there's a choice to make."
  )
}

function rematchReasonLine(
  reason: "assign" | "no_response" | "declined" | "noshow" | "availability" | undefined,
): string | null {
  if (reason === "no_response") return "The assigned vendor hasn't responded in time."
  if (reason === "declined") return "The assigned vendor isn't able to take this job."
  if (reason === "noshow") return "The assigned vendor didn't make the visit."
  return null
}

function vendorChoiceAskReason(
  reason: "assign" | "no_response" | "declined" | "noshow" | "availability" | undefined,
  optionCount: number,
): string {
  if (reason === "availability") {
    return optionCount <= 1 ? "vendor available" : "vendors available"
  }
  if (reason === "no_response" || reason === "declined" || reason === "noshow") {
    return "new vendor needed"
  }
  return "vendor needed"
}

export function buildLandlordVendorChoiceSms(input: {
  landlordFirstName?: string | null
  companyName?: string | null
  workOrderRef: string
  unit?: string | null
  tradeLabel: string
  options: VendorChoiceOption[]
  adminUrl?: string | null
  /** Why we're asking — rematch copy when the current vendor didn't respond. */
  reason?: "assign" | "no_response" | "declined" | "noshow" | "availability"
  issueHeadline?: string | null
  locationLabel?: string | null
  propertyType?: string | null
}): string {
  const available = input.reason === "availability"
  const rematch = rematchReasonLine(input.reason)
  const opening = landlordAskOpening(
    input.landlordFirstName,
    vendorChoiceAskReason(input.reason, input.options.length),
  )
  const summary = landlordAskSummaryLine({
    locationLabel: input.locationLabel,
    unit: input.unit,
    propertyType: input.propertyType,
    issueHeadline: input.issueHeadline,
    tradeLabel: input.tradeLabel,
  })
  const lines: string[] = [opening]
  if (summary) {
    lines.push("", summary)
  }
  if (rematch) {
    lines.push("", rematch)
  }

  const anyEstimate = input.options.some((o) => Boolean(o.estimateNote?.trim()))

  if (input.options.length === 1) {
    const only = input.options[0]
    const name = vendorChoiceDisplayName(only?.name || "your vendor")
    const verb = available ? "is available" : "can take this job"
    lines.push("", `${name} ${verb}.`)
    const window = only?.windowLabel?.trim()
    const estimate = only?.estimateNote?.trim()
    if (window) lines.push(window)
    if (estimate) lines.push(estimate)
    lines.push("", landlordYesChoiceReplyHint(name))
  } else {
    lines.push("")
    input.options.forEach((option, index) => {
      const name = vendorChoiceDisplayName(option.name)
      lines.push(`${index + 1} — ${name}`)
      const window = option.windowLabel?.trim()
      const estimate = option.estimateNote?.trim()
      if (window) lines.push(window)
      if (estimate) lines.push(estimate)
      else if (anyEstimate) lines.push("No estimate provided")
      if (index < input.options.length - 1) lines.push("")
    })
    lines.push("", landlordVendorChoiceReplyHint(input.options.length))
  }

  return appendLandlordAskTail(lines, {
    adminUrl: input.adminUrl,
    workOrderRef: input.workOrderRef,
  })
}

export type PendingLandlordVendorChoiceAsk = {
  conversationId: string
  awaiting: AwaitingVendorChoice
}

export type ResolveLandlordVendorChoiceAskResult =
  | {
    kind: "match"
    ask: PendingLandlordVendorChoiceAsk
    option: VendorChoiceOption
  }
  | { kind: "ambiguous"; pending: PendingLandlordVendorChoiceAsk[] }
  | {
    kind: "unclear"
    ask: PendingLandlordVendorChoiceAsk | null
    options: VendorChoiceOption[]
  }
  | { kind: "none" }

/**
 * Pick which pending vendor-choice ask a short landlord reply targets.
 * One pending ask → bare YES / 1 / 2 is enough. Multiple → need WO or address.
 */
export function resolveLandlordVendorChoiceAskFromReply(input: {
  body: string
  pending: PendingLandlordVendorChoiceAsk[]
}): ResolveLandlordVendorChoiceAskResult {
  const pending = input.pending.filter((p) => p.awaiting.options.length > 0)
  if (pending.length === 0) return { kind: "none" }

  const wo = extractWorkOrderRefFromReply(input.body)
  let candidates = pending
  if (wo) {
    const byWo = pending.filter((p) => {
      const ref =
        p.awaiting.workOrderRef?.trim().toUpperCase() ||
        formatWorkOrderRef(p.awaiting.ticketId).toUpperCase()
      return ref === wo
    })
    if (byWo.length === 1) {
      candidates = byWo
    } else if (byWo.length > 1) {
      return { kind: "ambiguous", pending: byWo }
    } else {
      return {
        kind: "unclear",
        ask: pending.length === 1 ? pending[0]! : null,
        options: pending.length === 1 ? pending[0]!.awaiting.options : [],
      }
    }
  } else {
    const byLoc = pending.filter((p) =>
      replyMentionsLandlordAskLocation(
        input.body,
        p.awaiting.locationLabel ?? p.awaiting.searchLocation,
      )
    )
    if (byLoc.length === 1) {
      candidates = byLoc
    } else if (byLoc.length > 1) {
      return { kind: "ambiguous", pending: byLoc }
    } else if (pending.length > 1) {
      // Bare number / YES with multiple open asks — clarify.
      return { kind: "ambiguous", pending }
    }
  }

  const ask = candidates[0]!
  const option =
    parseLandlordVendorChoice(input.body, ask.awaiting.options) ??
    parseLandlordVendorChoice(
      stripDisambiguatorsFromChoiceReply(input.body),
      ask.awaiting.options,
    )
  if (!option) {
    return { kind: "unclear", ask, options: ask.awaiting.options }
  }
  return { kind: "match", ask, option }
}

/** Keep YES / 1 / 2 for parse after stripping WO + address disambiguators. */
export function stripDisambiguatorsFromChoiceReply(body: string): string {
  let t = body
    .replace(/\bWO-[A-Za-z0-9]{4}\b/gi, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const m = t.match(
    /^(yes|y|yeah|yep|no|n|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
  )
  return m?.[1]?.trim() ?? t
}

export function buildLandlordVendorChoiceAmbiguousSms(
  pending: PendingLandlordVendorChoiceAsk[],
): string {
  const lines = [
    "You have more than one open request. Which one are you answering?",
    "",
  ]
  for (const p of pending) {
    const wo =
      p.awaiting.workOrderRef?.trim() ||
      formatWorkOrderRef(p.awaiting.ticketId)
    const loc =
      (p.awaiting.locationLabel ?? p.awaiting.searchLocation ?? "").trim() ||
      "this property"
    const issue =
      (p.awaiting.issueSummary ?? p.awaiting.issueCategory ?? "").trim()
    lines.push(issue ? `• ${loc} · ${issue} (${wo})` : `• ${loc} (${wo})`)
  }
  lines.push(
    "",
    'Reply with the number and the address (or WO code), e.g. "1 563 Springdale" or "YES WO-E6F7".',
  )
  return lines.join("\n")
}

export function formatExternalVendorSmsLine(row: {
  name: string
  rating?: number | null
  reviewCount?: number | null
}): string {
  const name = row.name.trim() || "Vendor"
  const rating =
    typeof row.rating === "number" && Number.isFinite(row.rating)
      ? Math.round(row.rating * 10) / 10
      : null
  const reviews =
    typeof row.reviewCount === "number" && Number.isFinite(row.reviewCount)
      ? Math.max(0, Math.round(row.reviewCount))
      : null
  const stars =
    rating == null
      ? null
      : `${Number.isInteger(rating) ? String(rating) : rating.toFixed(1)} ${
          rating === 1 ? "star" : "stars"
        }`
  const reviewBit =
    reviews == null
      ? null
      : `(${reviews.toLocaleString("en-US")} ${reviews === 1 ? "review" : "reviews"})`
  const social = [stars, reviewBit].filter(Boolean).join(" ")
  return social ? `${name} · ${social}` : name
}

export function choiceOptionsFromExternalSuggestions(
  rows: Array<{
    name: string
    providerRef?: string | null
    searchId?: string | null
    categoryId?: string | null
  }>,
  limit = 3,
): VendorChoiceOption[] {
  const options: VendorChoiceOption[] = []
  for (const row of rows) {
    if (options.length >= limit) break
    const name = row.name.trim()
    if (!name) continue
    const providerRef = row.providerRef?.trim() || ""
    options.push({
      id: providerRef || `mock:${name}`,
      name,
      role: "external",
      source: "external",
      searchId: row.searchId ?? null,
      categoryId: row.categoryId ?? null,
    })
  }
  return options
}

export function landlordNumberedChoiceReplyHint(count: number): string {
  // Attention copy still wants the short "and we'll contact them" form.
  if (count <= 0) return ""
  if (count === 1) return "Reply 1 and we'll contact them."
  if (count === 2) return "Reply 1 or 2 and we'll contact them."
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${nums[nums.length - 1]} and we'll contact them.`
}

/** Vendor-choice SMS reply line — WO/address optional for multi-pending threads. */
export function landlordVendorChoiceReplyHint(count: number): string {
  return sharedLandlordNumberedChoiceReplyHint(count)
}

export function canHandleLandlordVendorChoice(input: {
  identityType: string
  conversationType?: string | null
  intakeState: unknown
}): boolean {
  // Ops phones are sometimes mislabeled as resident (unknown-contact reuse).
  // Still honor a pending landlord choice ask; only skip real vendor threads.
  if (input.identityType === "vendor") return false
  if (readAwaitingVendorChoice(input.intakeState) != null) return true
  return intakeHasActiveVendorProbeHold(input.intakeState)
}

export function landlordChoiceReplyHint(count: number): string {
  if (count <= 1) return "Reply YES"
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  if (nums.length === 2) return `Reply ${nums[0]} or ${nums[1]}`
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${nums[nums.length - 1]}`
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

export function parseLandlordVendorChoice(
  body: string,
  options: VendorChoiceOption[],
): VendorChoiceOption | null {
  const raw = body.trim()
  if (!raw || options.length === 0) return null
  const normalized = raw.toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ")
  const first = options[0]
  if (!first) return null

  if (options.length === 1) {
    if (
      /^(yes|y|ok|okay|assign|send it|send|1|one|reply 1|option 1)$/i.test(normalized)
    ) {
      return first
    }
    if (first.name && normalized.includes(first.name.toLowerCase())) return first
    return null
  }

  const numbered = normalized.match(/^(?:option |reply )?(\d+)$/)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    return options[index] ?? null
  }
  const wordIndex = NUMBER_WORDS[normalized]
  if (typeof wordIndex === "number") {
    return options[wordIndex - 1] ?? null
  }

  for (const option of options) {
    if (option.name && normalized.includes(option.name.toLowerCase())) return option
  }
  const generalists = options.filter((row) => row.role === "generalist")
  if (/\b(handyman|general)\b/.test(normalized) && generalists.length === 1) {
    return generalists[0] ?? null
  }
  return null
}

export function unclearVendorChoiceReply(options: VendorChoiceOption[]): string {
  if (options.length === 1) {
    const name = vendorChoiceDisplayName(options[0]?.name || "this vendor")
    return `Please reply YES to send this to ${name}.`
  }
  const names = options.map(
    (row, index) => `${index + 1} for ${vendorChoiceDisplayName(row.name)}`,
  )
  if (names.length === 2) {
    return `Please reply ${names[0]} or ${names[1]}.`
  }
  return `Please reply ${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}.`
}

function tradeLabelFromCategory(issueCategory: string | null): string {
  const raw = (issueCategory ?? "").trim().toLowerCase().replace(/_/g, " ")
  if (!raw || raw === "other" || raw === "general") return "maintenance"
  return raw
}

function optionsFromAssignment(
  rows: VendorAssignmentOption[],
): VendorChoiceOption[] {
  return rows.map((row) => ({
    id: row.vendor.id,
    name: row.vendor.name,
    role: row.role,
  }))
}

export async function persistLandlordChoiceSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phone: string
    body: string
    awaiting: AwaitingVendorChoice
    providerMessageSid: string
    provider: string
    fromNumber: string
  },
): Promise<void> {
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "landlord",
  })
  if (!identity) return

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id) return

  const ticketId = params.awaiting.ticketId
  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: ticketId,
    conversationStatus: "open",
  })

  await supabase.from("sms_messages").insert({
    conversation_id: conversationId,
    landlord_id: params.landlordId,
    direction: "outbound",
    from_number: normalizeSmsPhone(params.fromNumber),
    to_number: normalizeSmsPhone(params.phone),
    body: params.body,
    media_urls: [],
    provider: params.provider,
    provider_message_sid: params.providerMessageSid,
    provider_status: "sent",
    raw_payload: {
      source: "landlord_vendor_choice",
      ticket_id: ticketId,
    },
  })

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const nextIntake = { ...prior }
  delete nextIntake[UNKNOWN_CONTACT_INTAKE_KEY]

  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      conversation_type: "landlord_update",
      maintenance_request_id: ticketId,
      intake_state: {
        ...nextIntake,
        awaiting_vendor_choice: serializeAwaitingVendorChoice(params.awaiting),
      },
    })
    .eq("id", conversationId)
}

export async function notifyLandlordVendorChoice(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unit: string
    issueCategory: string | null
    options: VendorAssignmentOption[]
    reason?: "assign" | "no_response" | "declined" | "noshow" | "availability"
    issueHeadline?: string | null
    locationLabel?: string | null
    /** Merge probe slot/estimate onto choice options by vendor id. */
    availabilityByVendorId?: Record<
      string,
      { windowLabel?: string | null; estimateNote?: string | null }
    >
    visitTicketIds?: string[] | null
    inspectionReportId?: string | null
    visitItems?: Array<{ label: string; workOrderRef?: string }> | null
    visitVendorName?: string | null
  },
): Promise<{ sent: number }> {
  let choiceOptions = optionsFromAssignment(params.options)
  if (params.availabilityByVendorId) {
    choiceOptions = choiceOptions.map((opt) => {
      const extra = params.availabilityByVendorId?.[opt.id]
      if (!extra) return opt
      return {
        ...opt,
        windowLabel: extra.windowLabel ?? opt.windowLabel ?? null,
        estimateNote: extra.estimateNote ?? opt.estimateNote ?? null,
      }
    })
  }
  if (choiceOptions.length === 0) return { sent: 0 }

  const { data: landlord } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", params.landlordId)
    .maybeSingle()
  const companyName =
    typeof landlord?.name === "string" ? landlord.name.trim() : ""
  const landlordFirstName = companyName.split(/\s+/)[0] || null
  const wo = formatWorkOrderRef(params.ticketId)

  let issueHeadline = params.issueHeadline?.trim() || null
  let locationLabel = params.locationLabel?.trim() || null
  if (!issueHeadline || !locationLabel) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("issue_headline, unit")
      .eq("id", params.ticketId)
      .maybeSingle()
    if (!issueHeadline && typeof ticket?.issue_headline === "string") {
      issueHeadline = ticket.issue_headline.trim() || null
    }
  }
  if (!locationLabel) {
    try {
      const { resolveVendorProbeLocationLabel } = await import(
        "./vendorAvailabilityProbe.ts"
      )
      locationLabel = await resolveVendorProbeLocationLabel(supabase, {
        landlordId: params.landlordId,
        ticketId: params.ticketId,
        unitFallback: params.unit,
      })
    } catch (e) {
      console.error("[vendor-choice] location label", e)
      locationLabel = params.unit?.trim() || null
    }
  }

  const visitTicketIds = (params.visitTicketIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean)
  const isVisit =
    visitTicketIds.length > 1 &&
    Array.isArray(params.visitItems) &&
    params.visitItems.length > 0

  let smsBody: string
  if (isVisit) {
    const { buildLandlordInspectionVisitChoiceSms } = await import(
      "./vendorAvailabilityProbe.ts"
    )
    const primary = choiceOptions[0]
    smsBody = buildLandlordInspectionVisitChoiceSms({
      landlordFirstName,
      vendorName: params.visitVendorName?.trim() || primary?.name || "your vendor",
      locationLabel,
      windowLabel: primary?.windowLabel ?? null,
      estimateNote: primary?.estimateNote ?? null,
      items: params.visitItems!,
      adminUrl: uloAppUrl.adminWorkOrder(wo),
      workOrderRef: wo,
    })
  } else {
    smsBody = buildLandlordVendorChoiceSms({
      landlordFirstName,
      companyName: companyName || null,
      workOrderRef: wo,
      unit: params.unit,
      tradeLabel: tradeLabelFromCategory(params.issueCategory),
      options: choiceOptions,
      adminUrl: uloAppUrl.adminWorkOrder(wo),
      reason: params.reason ?? "assign",
      issueHeadline,
      locationLabel,
    })
  }

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const provider = getSMSProviderForSend({
    landlordId: params.landlordId,
    lineProvider: main?.provider,
  })
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  let sent = 0
  const awaiting: AwaitingVendorChoice = {
    ticketId: params.ticketId,
    options: choiceOptions,
    locationLabel,
    searchLocation: locationLabel,
    workOrderRef: wo,
    issueCategory: params.issueCategory,
    issueSummary: issueHeadline,
    visitTicketIds: visitTicketIds.length > 0 ? visitTicketIds : undefined,
    inspectionReportId: params.inspectionReportId ?? null,
  }
  for (const phone of phones) {
    const sendResult = await provider.sendMessage({
      to: phone,
      body: smsBody,
      from: main?.phone_number,
    })
    if (sendResult.error) {
      console.error("[vendor-choice] landlord SMS", phone, sendResult.error)
      continue
    }
    sent += 1
    try {
      await persistLandlordChoiceSms(supabase, {
        landlordId: params.landlordId,
        phone,
        body: smsBody,
        awaiting,
        providerMessageSid:
          sendResult.providerMessageSid ??
          sendResult.messageId ??
          `landlord-vendor-choice:${params.ticketId}:${phone}`,
        provider: sendResult.provider ?? "twilio",
        fromNumber: main?.phone_number ?? "unknown",
      })
    } catch (e) {
      console.error("[vendor-choice] persist landlord SMS thread", e)
    }
  }

  const names = choiceOptions.map((row) => vendorChoiceDisplayName(row.name)).join(" or ")
  const rematch =
    params.reason === "no_response" ||
    params.reason === "declined" ||
    params.reason === "noshow"
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_choice_asked",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      message: isVisit
        ? `Asked the landlord to confirm the inspection visit (${visitTicketIds.length} items) with ${names}.`
        : rematch
        ? `Asked the landlord to confirm a replacement vendor for ${wo}: ${names}.`
        : `Asked the landlord to confirm vendor assignment for ${wo}: ${names}.`,
      option_ids: choiceOptions.map((row) => row.id),
      reason: params.reason ?? "assign",
      visit_ticket_ids: visitTicketIds.length > 0 ? visitTicketIds : undefined,
      inspection_report_id: params.inspectionReportId ?? undefined,
    },
  })

  return { sent }
}

async function clearAwaitingVendorChoice(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
  ticketId?: string | null,
): Promise<void> {
  const next = landlordVendorChoiceResolvedIntake(priorIntake)
  delete next[UNKNOWN_CONTACT_INTAKE_KEY]
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      status: "open",
      conversation_type: "landlord_update",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)

  const id = ticketId?.trim()
  if (id) {
    await clearLandlordVendorChoiceTicketFlag(supabase, id)
  }
}

export async function tryHandleLandlordVendorChoiceInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    fromPhone?: string | null
    /** Durable sms_messages.id for this inbound — required before dispatch. */
    messageId?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; ticketId: string; vendorId: string | null; replyBody: string }
> {
  // Real vendor threads use availability probe / job response — not this ask.
  if (params.identityType === "vendor") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, conversation_type, maintenance_request_id, external_phone_number")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!conv?.id) return { handled: false }

  let conversationId = conv.id
  let priorIntake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}

  const phone = normalizeSmsPhone(
    params.fromPhone?.trim() ||
      (typeof conv.external_phone_number === "string"
        ? conv.external_phone_number
        : ""),
  )

  const pendingAsks: PendingLandlordVendorChoiceAsk[] = []
  const seenConv = new Set<string>()
  const pushAsk = (conversationId: string, intake: unknown) => {
    if (seenConv.has(conversationId)) return
    const awaiting = readAwaitingVendorChoice(intake)
    if (!awaiting) return
    seenConv.add(conversationId)
    pendingAsks.push({ conversationId, awaiting })
  }
  pushAsk(conversationId, priorIntake)
  if (phone) {
    const { data: others } = await supabase
      .from("sms_conversations")
      .select("id, intake_state")
      .eq("landlord_id", params.landlordId)
      .eq("external_phone_number", phone)
      .order("updated_at", { ascending: false })
      .limit(25)
    for (const row of others ?? []) {
      if (typeof row.id !== "string") continue
      pushAsk(row.id, row.intake_state)
    }
  }

  const resolved = resolveLandlordVendorChoiceAskFromReply({
    body: params.body,
    pending: pendingAsks,
  })
  if (resolved.kind === "none") {
    // fall through to probe-hold handling below
  } else if (resolved.kind === "ambiguous") {
    return {
      handled: true,
      ticketId: resolved.pending[0]?.awaiting.ticketId ?? "",
      vendorId: null,
      replyBody: buildLandlordVendorChoiceAmbiguousSms(resolved.pending),
    }
  } else if (resolved.kind === "unclear") {
    return {
      handled: true,
      ticketId: resolved.ask?.awaiting.ticketId ?? "",
      vendorId: null,
      replyBody: unclearVendorChoiceReply(
        resolved.options.length > 0
          ? resolved.options
          : resolved.ask?.awaiting.options ?? [],
      ),
    }
  }

  let awaiting =
    resolved.kind === "match" ? resolved.ask.awaiting : null
  if (resolved.kind === "match") {
    conversationId = resolved.ask.conversationId
    const { data: matchConv } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", conversationId)
      .maybeSingle()
    priorIntake =
      matchConv?.intake_state && typeof matchConv.intake_state === "object"
        ? (matchConv.intake_state as Record<string, unknown>)
        : {}
  }

  if (!awaiting) {
    // Multi-vendor probe hold: status SMS was sent, decision not yet — never
    // treat YES/1/2 (or anything else) as an approval, and never fall through
    // to the generic maintenance greeting.
    let holdTicketId: string | null = null
    if (intakeHasActiveVendorProbeHold(priorIntake)) {
      const raw = (priorIntake as Record<string, unknown>).vendor_availability_probe as
        | Record<string, unknown>
        | undefined
      holdTicketId =
        typeof raw?.ticket_id === "string" ? raw.ticket_id.trim() : null
    } else {
      const phone = normalizeSmsPhone(
        params.fromPhone?.trim() ||
          (typeof conv.external_phone_number === "string"
            ? conv.external_phone_number
            : ""),
      )
      if (phone) {
        const { data: others } = await supabase
          .from("sms_conversations")
          .select("id, intake_state")
          .eq("landlord_id", params.landlordId)
          .eq("external_phone_number", phone)
          .order("updated_at", { ascending: false })
          .limit(25)
        const holdMatch = (others ?? []).find((row) =>
          intakeHasActiveVendorProbeHold(row.intake_state)
        )
        if (holdMatch?.intake_state && typeof holdMatch.intake_state === "object") {
          const raw = (holdMatch.intake_state as Record<string, unknown>)
            .vendor_availability_probe as Record<string, unknown> | undefined
          holdTicketId =
            typeof raw?.ticket_id === "string" ? raw.ticket_id.trim() : null
        }
      }
    }
    if (holdTicketId) {
      return {
        handled: true,
        ticketId: holdTicketId,
        vendorId: null,
        replyBody: buildLandlordProbeHoldClarifySms(),
      }
    }
    return { handled: false }
  }

  // Ops phone was mislabeled as resident — treat as landlord for this ask.
  if (params.identityType === "resident") {
    const repairPhone = normalizeSmsPhone(
      params.fromPhone?.trim() ||
        (typeof conv.external_phone_number === "string"
          ? conv.external_phone_number
          : ""),
    )
    if (repairPhone) {
      try {
        await upsertSmsIdentityForPhone(supabase, {
          landlordId: params.landlordId,
          phone: repairPhone,
          identityType: "landlord",
        })
      } catch (e) {
        console.error("[vendor-choice] repair landlord identity", e)
      }
    }
  }

  const chosen =
    resolved.kind === "match"
      ? resolved.option
      : parseLandlordVendorChoice(params.body, awaiting.options)
  if (!chosen) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody: unclearVendorChoiceReply(awaiting.options),
    }
  }

  // Fail closed: never assign/dispatch unless the triggering inbound is durable.
  const trigger = await confirmDurableLandlordChoiceTrigger(supabase, {
    messageId: params.messageId,
    conversationId,
    landlordId: params.landlordId,
  })
  if (!trigger.ok) {
    console.error("[vendor-choice] refusing dispatch — durable inbound missing", {
      reason: trigger.reason,
      messageId: params.messageId ?? null,
      conversationId,
      ticketId: awaiting.ticketId,
    })
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        "I couldn't confirm your reply just now. Please reply again to assign the vendor.",
    }
  }

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "id, priority, urgency, severity, unit, description, issue_headline, entry_ok_if_absent, due_at, estimated_minutes, resident_availability_text, assigned_vendor_id, vendor_work_status, vendor_notified_at",
    )
    .eq("id", awaiting.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!ticket?.id) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        "I couldn't find that work order. Open the dashboard if you still need to assign a vendor.",
    }
  }

  const assignedId =
    typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
      ? ticket.assigned_vendor_id.trim()
      : ""
  const workStatus =
    typeof ticket.vendor_work_status === "string" ? ticket.vendor_work_status : ""
  const vendorNotifiedAt =
    typeof ticket.vendor_notified_at === "string" && ticket.vendor_notified_at.trim()
      ? ticket.vendor_notified_at.trim()
      : ""

  // #region agent log
// #endregion

  if (assignedId && !isExternalVendorChoice(chosen)) {
    if (assignedId === chosen.id) {
      // Probe soft-offer may have bound assigned_vendor_id without a job SMS.
      // If the vendor was never notified, treat YES as assign+notify — not a no-op.
      if (!vendorNotifiedAt) {
        // #region agent log
// #endregion
        const { reassignVendorByIdAndNotify } = await import(
          "../submit-maintenance-request/vendor_notify.ts"
        )
        const notified = await reassignVendorByIdAndNotify(
          supabase,
          awaiting.ticketId,
          chosen.id,
        )
        if ("error" in notified) {
          return {
            handled: true,
            ticketId: awaiting.ticketId,
            vendorId: null,
            replyBody:
              `I couldn't send this to ${vendorChoiceDisplayName(chosen.name)} just now. Try again, or assign them from the dashboard.`,
          }
        }
        await clearAwaitingVendorChoice(
          supabase,
          conversationId,
          priorIntake,
          awaiting.ticketId,
        )
        await recordVendorChoiceSelected(supabase, {
          landlordId: params.landlordId,
          ticketId: awaiting.ticketId,
          conversationId,
          vendorId: chosen.id,
          messageId: trigger.messageId,
          providerMessageSid: trigger.providerMessageSid,
          metadata: {
            message: `Assigned ${vendorChoiceDisplayName(chosen.name)} after the landlord confirmed.`,
          },
        })
        return {
          handled: true,
          ticketId: awaiting.ticketId,
          vendorId: assignedId,
          replyBody: `Got it — we'll send this to ${vendorChoiceDisplayName(chosen.name)} now and ask them to take the job. We'll text you when they reply.`,
        }
      }
      // #region agent log
// #endregion
      await clearAwaitingVendorChoice(
        supabase,
        conversationId,
        priorIntake,
        awaiting.ticketId,
      )
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: assignedId,
        replyBody: `Got it — we'll keep ${vendorChoiceDisplayName(chosen.name)} on this job and wait for them to reply.`,
      }
    }
    if (!canReplaceAssignedVendorForLandlordChoice(workStatus)) {
      await clearAwaitingVendorChoice(
        supabase,
        conversationId,
        priorIntake,
        awaiting.ticketId,
      )
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: assignedId,
        replyBody: "That work order already has a vendor. We'll text you when they reply.",
      }
    }
    const { reassignVendorByIdAndNotify } = await import(
      "../submit-maintenance-request/vendor_notify.ts"
    )
    const reassigned = await reassignVendorByIdAndNotify(
      supabase,
      awaiting.ticketId,
      chosen.id,
    )
    if ("error" in reassigned) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          `I couldn't send this to ${vendorChoiceDisplayName(chosen.name)} just now. Try again, or assign them from the dashboard.`,
      }
    }
    await clearAwaitingVendorChoice(
        supabase,
        conversationId,
        priorIntake,
        awaiting.ticketId,
      )
    await recordVendorChoiceSelected(supabase, {
      landlordId: params.landlordId,
      ticketId: awaiting.ticketId,
      conversationId,
      vendorId: chosen.id,
      messageId: trigger.messageId,
      providerMessageSid: trigger.providerMessageSid,
      metadata: {
        message: `Assigned ${vendorChoiceDisplayName(chosen.name)} after the landlord confirmed.`,
      },
    })
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: chosen.id,
      replyBody: `Got it — we'll send this to ${vendorChoiceDisplayName(chosen.name)} now and ask them to take the job. We'll text you when they reply.`,
    }
  }

  if (isExternalVendorChoice(chosen)) {
    const businessId = chosen.id.startsWith("mock:") ? "" : chosen.id.trim()
    if (!businessId) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          "Open Ulo to contact that vendor — I couldn't reach them over text from here.",
      }
    }
    const { sendThumbtackVendorMessage } = await import(
      "./external_vendor/thumbtackMessages.ts"
    )
    const { buildThumbtackVendorOutreachMessage } = await import(
      "./external_vendor/thumbtackOutreachCopy.ts"
    )
    const text = buildThumbtackVendorOutreachMessage({
      propertyAddress: awaiting.searchLocation,
      jobCategory: awaiting.issueCategory,
      issueSummary: awaiting.issueSummary,
      urgency: awaiting.urgency,
    })
    const sent = await sendThumbtackVendorMessage(supabase, {
      ticketId: awaiting.ticketId,
      landlordId: params.landlordId,
      businessId,
      vendorName: vendorChoiceDisplayName(chosen.name),
      searchId: chosen.searchId,
      categoryId: chosen.categoryId,
      text,
      issueCategory: awaiting.issueCategory,
      searchLocation: awaiting.searchLocation,
    })
    if (!sent.ok) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          `I couldn't reach ${vendorChoiceDisplayName(chosen.name)} just now. Try again, or open Ulo to message them.`,
      }
    }
    await clearAwaitingVendorChoice(
        supabase,
        conversationId,
        priorIntake,
        awaiting.ticketId,
      )
    await recordVendorChoiceSelected(supabase, {
      landlordId: params.landlordId,
      ticketId: awaiting.ticketId,
      conversationId,
      messageId: trigger.messageId,
      providerMessageSid: trigger.providerMessageSid,
      metadata: {
        message: `Asked ${vendorChoiceDisplayName(chosen.name)} about this job after the landlord chose them.`,
        source: "external",
        business_id: businessId,
      },
    })
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody: `Got it — we'll contact ${vendorChoiceDisplayName(chosen.name)} about this job now. We'll text you when they reply.`,
    }
  }

  const { assignVendorAndNotify } = await import(
    "../submit-maintenance-request/vendor_notify.ts"
  )
  const displayName = vendorChoiceDisplayName(chosen.name)
  const visitIds = [
    ...new Set(
      [
        awaiting.ticketId,
        ...(awaiting.visitTicketIds ?? []),
      ].map((id) => id.trim()).filter(Boolean),
    ),
  ]

  let assignedPrimary = false
  for (const ticketId of visitIds) {
    const { data: row } = ticketId === awaiting.ticketId
      ? { data: ticket }
      : await supabase
        .from("maintenance_requests")
        .select(
          "id, priority, unit, description, issue_headline, entry_ok_if_absent, urgency, severity, due_at, estimated_minutes, resident_availability_text",
        )
        .eq("id", ticketId)
        .maybeSingle()
    if (!row) continue
    const result = await assignVendorAndNotify(supabase, {
      ticketId,
      priority: typeof row.priority === "string" && row.priority.trim()
        ? row.priority
        : "normal",
      unit: typeof row.unit === "string" ? row.unit : "",
      description: typeof row.description === "string" ? row.description : "",
      issueHeadline: typeof row.issue_headline === "string"
        ? row.issue_headline
        : null,
      entryOkIfAbsent: typeof row.entry_ok_if_absent === "boolean"
        ? row.entry_ok_if_absent
        : null,
      urgency: typeof row.urgency === "string" ? row.urgency : null,
      severity: typeof row.severity === "string" ? row.severity : null,
      dueAt: typeof row.due_at === "string" ? row.due_at : null,
      estimatedMinutes: typeof row.estimated_minutes === "number"
        ? row.estimated_minutes
        : null,
      landlordId: params.landlordId,
      preferVendorId: chosen.id,
      landlordAcknowledged: true,
      residentAvailabilityText:
        typeof row.resident_availability_text === "string"
          ? row.resident_availability_text
          : null,
      retryIfUnassigned: true,
    })
    if (ticketId === awaiting.ticketId) assignedPrimary = result.assigned
    else if (!result.assigned) {
      console.warn(
        "[landlord-vendor-choice] visit sibling assign failed",
        ticketId,
        result.skipReason,
      )
    }
  }

  if (!assignedPrimary) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        `I couldn't send this to ${displayName} just now. Try again, or assign them from the dashboard.`,
    }
  }

  // If this vendor offered a window during the availability probe, seed the schedule
  // on every ticket in the inspection visit group.
  try {
    const { findProbeOfferForVendor } = await import("./vendorAvailabilityProbe.ts")
    const offer = await findProbeOfferForVendor(
      supabase,
      awaiting.ticketId,
      chosen.id,
    )
    if (offer?.scheduledAt || offer?.windowLabel) {
      const patch: Record<string, unknown> = {}
      if (offer.scheduledAt) patch.scheduled_at = offer.scheduledAt
      if (offer.windowLabel.trim()) {
        patch.scheduled_window_text = offer.windowLabel.trim()
      }
      // Landlord YES locks the proposed visit window across the group.
      patch.schedule_confirmed_at = new Date().toISOString()
      if (Object.keys(patch).length > 0) {
        await supabase
          .from("maintenance_requests")
          .update(patch)
          .in("id", visitIds)
      }
    }
  } catch (e) {
    console.warn("[landlord-vendor-choice] apply probe offer window", e)
  }

  for (const ticketId of visitIds) {
    await clearLandlordVendorChoiceTicketFlag(supabase, ticketId)
  }
  await clearAwaitingVendorChoice(
    supabase,
    conversationId,
    priorIntake,
    awaiting.ticketId,
  )
  await recordVendorChoiceSelected(supabase, {
    landlordId: params.landlordId,
    ticketId: awaiting.ticketId,
    conversationId,
    vendorId: chosen.id,
    messageId: trigger.messageId,
    providerMessageSid: trigger.providerMessageSid,
    metadata: {
      message: visitIds.length > 1
        ? `Assigned ${displayName} to the inspection visit (${visitIds.length} items) after the landlord confirmed.`
        : `Assigned ${displayName} after the landlord confirmed.`,
      visit_ticket_ids: visitIds.length > 1 ? visitIds : undefined,
    },
  })

  return {
    handled: true,
    ticketId: awaiting.ticketId,
    vendorId: chosen.id,
    replyBody: visitIds.length > 1
      ? `Got it — we'll send the inspection visit to ${displayName} now and ask them to take the jobs. We'll text you when they reply.`
      : `Got it — we'll send this to ${displayName} now and ask them to take the job. We'll text you when they reply.`,
  }
}
