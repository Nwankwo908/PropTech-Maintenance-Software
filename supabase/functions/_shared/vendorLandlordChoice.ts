/**
 * Landlord must acknowledge by SMS before Ulo assigns any vendor.
 * One option → reply YES. Two options → reply 1 or 2.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
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
import type { VendorAssignmentOption } from "./vendor_assignment.ts"

export const AWAITING_LANDLORD_VENDOR_CHOICE = "Awaiting landlord vendor choice"

export function ticketIsAwaitingLandlordVendorChoice(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_LANDLORD_VENDOR_CHOICE)
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
  }
}

export function serializeAwaitingVendorChoice(
  awaiting: AwaitingVendorChoice,
): Record<string, unknown> {
  return {
    ticket_id: awaiting.ticketId,
    search_location: awaiting.searchLocation ?? null,
    issue_category: awaiting.issueCategory ?? null,
    issue_summary: awaiting.issueSummary ?? null,
    urgency: awaiting.urgency ?? null,
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

/** Strip probe suffixes embedded in older choice names ("Flex — Thu · $200"). */
export function vendorChoiceDisplayName(name: string): string {
  const raw = name.trim()
  if (!raw) return "your vendor"
  return raw.split(" — ")[0]?.trim() || raw
}

function problemContextForLandlordSms(input: {
  tradeLabel: string
  issueHeadline?: string | null
  locationLabel?: string | null
  unit?: string | null
}): string {
  const issueRaw = input.issueHeadline?.trim() || ""
  const issue = issueRaw
    ? /^(the|a|an)\s+/i.test(issueRaw)
      ? issueRaw
      : `the ${issueRaw}`
    : ""
  const loc =
    input.locationLabel?.trim() ||
    (() => {
      const unit = input.unit?.trim() || ""
      if (!unit) return ""
      if ((/\d/.test(unit) && /[a-z]/i.test(unit)) || unit.includes("·")) return unit
      return /^unit\b/i.test(unit) ? unit : `Unit ${unit}`
    })()
  const trade = input.tradeLabel.trim() || "maintenance"
  if (issue && loc) return `${issue} at ${loc}`
  if (issue) return issue
  if (loc) return `the ${trade} repair at ${loc}`
  return `the ${trade} repair`
}

function rematchReasonLine(
  reason: "assign" | "no_response" | "declined" | "noshow" | "availability" | undefined,
): string | null {
  if (reason === "no_response") return "The assigned vendor hasn't responded in time."
  if (reason === "declined") return "The assigned vendor isn't able to take this job."
  if (reason === "noshow") return "The assigned vendor didn't make the visit."
  return null
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
  if (count <= 0) return ""
  if (count === 1) return "Reply 1 and we'll contact them."
  if (count === 2) return "Reply 1 or 2 and we'll contact them."
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${nums[nums.length - 1]} and we'll contact them.`
}

export function canHandleLandlordVendorChoice(input: {
  identityType: string
  conversationType?: string | null
  intakeState: unknown
}): boolean {
  // Ops phones are sometimes mislabeled as resident (unknown-contact reuse).
  // Still honor a pending landlord choice ask; only skip real vendor threads.
  if (input.identityType === "vendor") return false
  return readAwaitingVendorChoice(input.intakeState) != null
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
}): string {
  const first = input.landlordFirstName?.trim()
  const greeting = first ? `Hi ${first}` : "Hi"
  const problem = problemContextForLandlordSms(input)
  const available = input.reason === "availability"
  const rematch = rematchReasonLine(input.reason)
  const lines: string[] = []

  if (input.options.length === 1) {
    const only = input.options[0]
    const name = vendorChoiceDisplayName(only?.name || "your vendor")
    const verb = available ? "is available for" : "can take"
    lines.push(`${greeting} — ${name} ${verb} ${problem}.`)
    if (rematch) {
      lines.push("", rematch)
    }
    const window = only?.windowLabel?.trim()
    const estimate = only?.estimateNote?.trim()
    if (window || estimate) {
      lines.push("")
      if (window) lines.push(window)
      if (estimate) lines.push(estimate)
    }
    lines.push("", `Reply YES to send the job to ${name}.`)
  } else {
    lines.push(
      available
        ? `${greeting} — vendors are available for ${problem}.`
        : `${greeting} — these vendors can take ${problem}.`,
    )
    if (rematch) {
      lines.push("", rematch)
    }
    lines.push("")
    input.options.forEach((option, index) => {
      const name = vendorChoiceDisplayName(option.name)
      lines.push(`${index + 1} — ${name}`)
      const window = option.windowLabel?.trim()
      const estimate = option.estimateNote?.trim()
      if (window) lines.push(window)
      if (estimate) lines.push(estimate)
      if (index < input.options.length - 1) lines.push("")
    })
    lines.push(
      "",
      `${landlordChoiceReplyHint(input.options.length)} to send them the job.`,
    )
  }

  const adminUrl = input.adminUrl?.trim() ?? ""
  if (adminUrl) {
    lines.push("", "View details:", adminUrl)
  }
  return lines.join("\n")
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

  const smsBody = buildLandlordVendorChoiceSms({
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

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const provider = getSMSProviderForSend({
    landlordId: params.landlordId,
    lineProvider: main?.provider,
  })
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  let sent = 0
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
        awaiting: { ticketId: params.ticketId, options: choiceOptions },
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
      message: rematch
        ? `Asked the landlord to confirm a replacement vendor for ${wo}: ${names}.`
        : `Asked the landlord to confirm vendor assignment for ${wo}: ${names}.`,
      option_ids: choiceOptions.map((row) => row.id),
      reason: params.reason ?? "assign",
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
    await supabase
      .from("maintenance_requests")
      .update({ vendor_notify_error: null })
      .eq("id", id)
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
  let awaiting = readAwaitingVendorChoice(priorIntake)

  if (!awaiting) {
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
      const match = (others ?? []).find((row) =>
        readAwaitingVendorChoice(row.intake_state) != null
      )
      if (match?.id) {
        conversationId = match.id
        priorIntake =
          match.intake_state && typeof match.intake_state === "object"
            ? (match.intake_state as Record<string, unknown>)
            : {}
        awaiting = readAwaitingVendorChoice(priorIntake)
      }
    }
  }

  if (!awaiting) return { handled: false }

  // Ops phone was mislabeled as resident — treat as landlord for this ask.
  if (params.identityType === "resident") {
    const phone = normalizeSmsPhone(
      params.fromPhone?.trim() ||
        (typeof conv.external_phone_number === "string"
          ? conv.external_phone_number
          : ""),
    )
    if (phone) {
      try {
        await upsertSmsIdentityForPhone(supabase, {
          landlordId: params.landlordId,
          phone,
          identityType: "landlord",
        })
      } catch (e) {
        console.error("[vendor-choice] repair landlord identity", e)
      }
    }
  }

  const chosen = parseLandlordVendorChoice(params.body, awaiting.options)
  if (!chosen) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody: unclearVendorChoiceReply(awaiting.options),
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
  fetch("http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "5d0562",
    },
    body: JSON.stringify({
      sessionId: "5d0562",
      runId: "pre-fix",
      hypothesisId: "A",
      location: "vendorLandlordChoice.ts:tryHandle",
      message: "landlord choice ticket state",
      data: {
        ticketId: awaiting.ticketId,
        chosenId: chosen.id,
        assignedId: assignedId || null,
        workStatus,
        vendorNotifiedAt: vendorNotifiedAt || null,
        hasAwaiting: true,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion

  if (assignedId && !isExternalVendorChoice(chosen)) {
    if (assignedId === chosen.id) {
      // Probe soft-offer may have bound assigned_vendor_id without a job SMS.
      // If the vendor was never notified, treat YES as assign+notify — not a no-op.
      if (!vendorNotifiedAt) {
        // #region agent log
        fetch("http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "5d0562",
          },
          body: JSON.stringify({
            sessionId: "5d0562",
            runId: "pre-fix",
            hypothesisId: "B",
            location: "vendorLandlordChoice.ts:sameVendorUnnotified",
            message: "same vendor but never notified — reassign+notify",
            data: { ticketId: awaiting.ticketId, vendorId: assignedId },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
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
        await recordActivityLog(supabase, {
          landlordId: params.landlordId,
          eventType: "maintenance.vendor_choice_selected",
          source: "sms",
          actorType: "landlord",
          vendorId: chosen.id,
          maintenanceRequestId: awaiting.ticketId,
          conversationId,
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
      fetch("http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "5d0562",
        },
        body: JSON.stringify({
          sessionId: "5d0562",
          runId: "pre-fix",
          hypothesisId: "B",
          location: "vendorLandlordChoice.ts:sameVendorAlreadyNotified",
          message: "keep short-circuit — vendor already notified",
          data: { ticketId: awaiting.ticketId, vendorId: assignedId },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
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
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.vendor_choice_selected",
      source: "sms",
      actorType: "landlord",
      vendorId: chosen.id,
      maintenanceRequestId: awaiting.ticketId,
      conversationId,
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
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.vendor_choice_selected",
      source: "sms",
      actorType: "landlord",
      maintenanceRequestId: awaiting.ticketId,
      conversationId,
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
  const result = await assignVendorAndNotify(supabase, {
    ticketId: awaiting.ticketId,
    priority: typeof ticket.priority === "string" && ticket.priority.trim()
      ? ticket.priority
      : "normal",
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    issueHeadline: typeof ticket.issue_headline === "string"
      ? ticket.issue_headline
      : null,
    entryOkIfAbsent: typeof ticket.entry_ok_if_absent === "boolean"
      ? ticket.entry_ok_if_absent
      : null,
    urgency: typeof ticket.urgency === "string" ? ticket.urgency : null,
    severity: typeof ticket.severity === "string" ? ticket.severity : null,
    dueAt: typeof ticket.due_at === "string" ? ticket.due_at : null,
    estimatedMinutes: typeof ticket.estimated_minutes === "number"
      ? ticket.estimated_minutes
      : null,
    landlordId: params.landlordId,
    preferVendorId: chosen.id,
    landlordAcknowledged: true,
    residentAvailabilityText:
      typeof ticket.resident_availability_text === "string"
        ? ticket.resident_availability_text
        : null,
    retryIfUnassigned: true,
  })

  if (!result.assigned) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        `I couldn't send this to ${displayName} just now. Try again, or assign them from the dashboard.`,
    }
  }

  // If this vendor offered a window during the availability probe, seed the schedule.
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
      if (Object.keys(patch).length > 0) {
        await supabase
          .from("maintenance_requests")
          .update(patch)
          .eq("id", awaiting.ticketId)
      }
    }
  } catch (e) {
    console.warn("[landlord-vendor-choice] apply probe offer window", e)
  }

  await clearAwaitingVendorChoice(
        supabase,
        conversationId,
        priorIntake,
        awaiting.ticketId,
      )
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_choice_selected",
    source: "sms",
    actorType: "landlord",
    vendorId: chosen.id,
    maintenanceRequestId: awaiting.ticketId,
    conversationId,
    metadata: {
      message: `Assigned ${displayName} after the landlord confirmed.`,
    },
  })

  return {
    handled: true,
    ticketId: awaiting.ticketId,
    vendorId: chosen.id,
    replyBody: `Got it — we'll send this to ${displayName} now and ask them to take the job. We'll text you when they reply.`,
  }
}
