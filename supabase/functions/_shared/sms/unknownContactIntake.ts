/**
 * Conversational self-healing intake for unknown phone numbers.
 * Identifies property/unit, relationship, and contact-save consent before
 * (or while) creating a maintenance request — especially when urgent.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getEstimatedMinutes } from "../sla_rules.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  notifyLandlordNeedsAttention,
} from "../landlordAttentionNotify.ts"
import { issueCategoryToVendorTrade } from "../vendor_trades.ts"
import {
  classifyMaintenanceRequest,
} from "../maintenance_classification/mod.ts"
import {
  attachPhoneToUnitResident,
  extractUnitFromMessage,
  findActiveResidentsByUnit,
  normalizeUnitForMatch,
  notifyLandlordUnresolvedTenant,
} from "./resolveIdentity.ts"
import {
  normalizeSmsPhone,
  upsertSmsIdentity,
  type SmsIdentityRow,
} from "./inbound_db.ts"

export const UNKNOWN_CONTACT_INTAKE_KEY = "unknown_contact_intake"
export const UNKNOWN_CONTACT_MAX_CLARIFY = 3

export type UnknownContactIntakeStatus =
  | "identifying_location"
  | "identifying_sender"
  | "awaiting_contact_consent"
  | "ready_to_submit"
  | "submitted"
  | "human_review_required"

export type UnknownContactRelationship =
  | "resident"
  | "subletter"
  | "household_member"
  | "guest"
  | "authorized_contact"
  | "other"
  | "unknown"

export type UnknownContactIntakeState = {
  conversationId: string
  landlordId: string | null
  senderPhone: string
  originalMessage: string
  detectedIntent: string | null
  issueSummary: string | null
  severity: string | null
  propertyId: string | null
  buildingId: string | null
  unitId: string | null
  unitLabel: string | null
  buildingLabel: string | null
  senderName: string | null
  relationshipToUnit: UnknownContactRelationship | null
  contactSaveConsent: boolean | null
  identityConfidence: number
  routingConfidence: number
  clarificationAttempts: number
  ticketId: string | null
  status: UnknownContactIntakeStatus
}

export type UnknownContactTurnResult = {
  replyHint: string
  state: UnknownContactIntakeState
  identity: SmsIdentityRow
  continueIntake: boolean
  selfHealingPhase: "awaiting_unit_number" | "resolved" | "unresolved"
  conversationStatus: string
  metadata: Record<string, unknown>
}

const URGENT_RE =
  /\b(leak(?:ing|ed)?|flood(?:ing|ed)?|gushing|pouring|no\s*heat|no\s*hot\s*water|gas\s*smell|smoke|fire|spark(?:ing|s)?|sewage|sewer|burst\s*pipe|ceiling\s*(?:leak|collaps)|water\s*everywhere|emergency|urgent|really\s*bad(?:ly)?)\b/i

const CONSENT_YES =
  /^(yes|y|yeah|yep|sure|ok|okay|please|go ahead|sounds good|that'?s fine|save it|save my number)\b/i
const CONSENT_NO =
  /^(no|n|nope|don'?t|do not|prefer not|rather not)\b/i

const RELATIONSHIP_PATTERNS: Array<{
  re: RegExp
  value: UnknownContactRelationship
}> = [
  { re: /\b(sublet(?:ter|ting)?|sub-?lease(?:r)?)\b/i, value: "subletter" },
  {
    re: /\b(roommate|housemate|household|partner|spouse|wife|husband|family|mom|dad|parent|sister|brother|son|daughter)\b/i,
    value: "household_member",
  },
  { re: /\b(guest|visitor|staying\s+here|visiting)\b/i, value: "guest" },
  {
    re: /\b(authorized|emergency\s+contact|property\s+contact)\b/i,
    value: "authorized_contact",
  },
  {
    re: /\b(resident|tenant|renter|leaseholder|i\s+live\s+here|my\s+apartment|my\s+unit)\b/i,
    value: "resident",
  },
]

function iso(): string {
  return new Date().toISOString()
}

export function detectUrgentIssue(text: string): boolean {
  return URGENT_RE.test(text)
}

const NAME_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "new",
  "old",
  "here",
  "just",
  "also",
  "still",
  "from",
  "resident",
  "tenant",
  "subletter",
  "guest",
  "roommate",
])

export function extractSenderName(body: string): string | null {
  // "…, Jordan" / "… — Jordan"
  const trailing = body.match(
    /[,—–-]\s*([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)[.!]?\s*$/,
  )
  if (trailing?.[1] && !NAME_STOPWORDS.has(trailing[1].toLowerCase())) {
    return trailing[1].replace(/\b\w/g, (c) => c.toUpperCase())
  }

  const patterns = [
    /\b(?:my name is|name'?s|this is)\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i,
    /\b(?:i'?m|i am)\s+([A-Za-z][a-z]+)(?:\s*[.!,]|$)/i,
  ]
  for (const re of patterns) {
    const m = body.match(re)
    if (m?.[1]) {
      const name = m[1].trim().replace(/\s+/g, " ")
      if (
        name.length >= 2 &&
        name.length <= 60 &&
        !NAME_STOPWORDS.has(name.toLowerCase())
      ) {
        return name.replace(/\b\w/g, (c) => c.toUpperCase())
      }
    }
  }
  return null
}

export function extractRelationship(
  body: string,
): UnknownContactRelationship | null {
  for (const { re, value } of RELATIONSHIP_PATTERNS) {
    if (re.test(body)) return value
  }
  return null
}

export function parseContactConsent(body: string): boolean | null {
  const t = body.trim()
  if (!t) return null
  if (CONSENT_YES.test(t)) return true
  if (CONSENT_NO.test(t)) return false
  // "Yes, I'm the new subletter, Jordan" → consent + extras
  if (/^\s*yes\b/i.test(t)) return true
  if (/^\s*no\b/i.test(t)) return false
  return null
}

/** Street / building hints from free text ("123 Main", "Oakwood Apts"). */
export function extractBuildingHints(body: string): string[] {
  const hints = new Set<string>()
  const street = body.match(
    /\b(\d{1,6}\s+[A-Za-z][A-Za-z0-9.'\-]*(?:\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way|Ct|Court))?)\b/,
  )
  if (street?.[1]) hints.add(street[1].trim())

  const atPlace = body.match(
    /\b(?:at|in|of)\s+([A-Za-z0-9][A-Za-z0-9 .'#-]{2,40})/i,
  )
  if (atPlace?.[1]) {
    const cleaned = atPlace[1]
      .replace(/\b(?:apt|apartment|unit|#)\s*[a-z0-9-]+$/i, "")
      .trim()
    if (cleaned.length >= 3) hints.add(cleaned)
  }
  return [...hints]
}

export function readUnknownContactIntake(
  intakeState: Record<string, unknown> | null | undefined,
): UnknownContactIntakeState | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = intakeState[UNKNOWN_CONTACT_INTAKE_KEY]
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const conversationId =
    typeof row.conversationId === "string" ? row.conversationId : ""
  const senderPhone = typeof row.senderPhone === "string" ? row.senderPhone : ""
  const originalMessage =
    typeof row.originalMessage === "string" ? row.originalMessage : ""
  const status = typeof row.status === "string"
    ? (row.status as UnknownContactIntakeStatus)
    : null
  if (!conversationId || !senderPhone || !status) return null
  return {
    conversationId,
    landlordId: typeof row.landlordId === "string" ? row.landlordId : null,
    senderPhone,
    originalMessage,
    detectedIntent: typeof row.detectedIntent === "string"
      ? row.detectedIntent
      : null,
    issueSummary: typeof row.issueSummary === "string" ? row.issueSummary : null,
    severity: typeof row.severity === "string" ? row.severity : null,
    propertyId: typeof row.propertyId === "string" ? row.propertyId : null,
    buildingId: typeof row.buildingId === "string" ? row.buildingId : null,
    unitId: typeof row.unitId === "string" ? row.unitId : null,
    unitLabel: typeof row.unitLabel === "string" ? row.unitLabel : null,
    buildingLabel: typeof row.buildingLabel === "string"
      ? row.buildingLabel
      : null,
    senderName: typeof row.senderName === "string" ? row.senderName : null,
    relationshipToUnit:
      typeof row.relationshipToUnit === "string"
        ? (row.relationshipToUnit as UnknownContactRelationship)
        : null,
    contactSaveConsent: typeof row.contactSaveConsent === "boolean"
      ? row.contactSaveConsent
      : null,
    identityConfidence: typeof row.identityConfidence === "number"
      ? row.identityConfidence
      : 0,
    routingConfidence: typeof row.routingConfidence === "number"
      ? row.routingConfidence
      : 0,
    clarificationAttempts: typeof row.clarificationAttempts === "number"
      ? row.clarificationAttempts
      : 0,
    ticketId: typeof row.ticketId === "string" ? row.ticketId : null,
    status,
  }
}

export async function persistUnknownContactIntake(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    state: UnknownContactIntakeState | null
    conversationStatus?: string
  },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const intake =
    convo?.intake_state && typeof convo.intake_state === "object"
      ? { ...(convo.intake_state as Record<string, unknown>) }
      : {}
  if (!params.state) {
    delete intake[UNKNOWN_CONTACT_INTAKE_KEY]
  } else {
    intake[UNKNOWN_CONTACT_INTAKE_KEY] = params.state
  }
  const patch: Record<string, unknown> = {
    intake_state: intake,
    updated_at: iso(),
  }
  if (params.conversationStatus) {
    patch.status = params.conversationStatus
  }
  await supabase
    .from("sms_conversations")
    .update(patch)
    .eq("id", params.conversationId)
}

export function createInitialUnknownContactState(params: {
  conversationId: string
  landlordId: string
  senderPhone: string
  originalMessage: string
}): UnknownContactIntakeState {
  const urgent = detectUrgentIssue(params.originalMessage)
  return {
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    senderPhone: normalizeSmsPhone(params.senderPhone),
    originalMessage: params.originalMessage.trim(),
    detectedIntent: "maintenance",
    issueSummary: params.originalMessage.trim().slice(0, 280) || null,
    severity: urgent ? "urgent" : "normal",
    propertyId: null,
    buildingId: null,
    unitId: null,
    unitLabel: null,
    buildingLabel: null,
    senderName: null,
    relationshipToUnit: null,
    contactSaveConsent: null,
    identityConfidence: 0.2,
    routingConfidence: 0.2,
    clarificationAttempts: 0,
    ticketId: null,
    status: "identifying_location",
  }
}

export function buildAskLocationSms(issueSummary: string | null): string {
  const issue = issueSummary?.trim()
  if (issue && detectUrgentIssue(issue)) {
    return (
      "Hi! I can help with that. I don't recognize this phone number yet. " +
      "Which property and apartment are you contacting us about?"
    )
  }
  return (
    "Hi! I can help with that. I don't recognize this phone number yet. " +
    "Which property and apartment are you contacting us about?"
  )
}

export function buildAskConsentSms(input: {
  unitLabel: string
  buildingLabel: string | null
  urgent: boolean
}): string {
  const place = input.buildingLabel
    ? `Apt ${input.unitLabel} at ${input.buildingLabel}`
    : `Apt ${input.unitLabel}`
  if (input.urgent) {
    return (
      `Thanks. I found ${place}. This sounds urgent. ` +
      `Before I continue, may I save this phone number as a contact for that unit ` +
      `so we can route future updates correctly?`
    )
  }
  return (
    `Thanks. I found ${place}. ` +
    `Before I continue, may I save this phone number as a contact for that unit ` +
    `so we can route future updates correctly?`
  )
}

export function buildSavedAndSubmittedSms(input: {
  senderName: string | null
  unitLabel: string
  urgent: boolean
  tradeLabel: string | null
}): string {
  const who = input.senderName?.trim() || null
  const hi = who ? `Thanks, ${who}.` : "Thanks."
  const trade = input.tradeLabel?.trim() || "maintenance"
  const urgency = input.urgent ? "urgent " : ""
  return (
    `${hi} I've saved your number as a contact for Apt ${input.unitLabel}. ` +
    `I'm opening an ${urgency}${trade} request now, and the property team has been notified.`
  )
}

export function buildSubmittedWithoutSaveSms(input: {
  unitLabel: string
  urgent: boolean
}): string {
  const urgency = input.urgent ? "urgent " : ""
  return (
    `Understood — I won't save this number for future routing. ` +
    `I'm still opening an ${urgency}maintenance request for Apt ${input.unitLabel}, ` +
    `and the property team has been notified.`
  )
}

type LocationMatch = {
  unitLabel: string
  buildingLabel: string | null
  unitId: string | null
  rosterHits: number
  routingConfidence: number
}

async function matchLocationFromText(
  supabase: SupabaseClient,
  landlordId: string,
  body: string,
): Promise<LocationMatch | null> {
  const unitInput = extractUnitFromMessage(body)
  if (!unitInput) return null

  const buildingHints = extractBuildingHints(body).map((h) => h.toLowerCase())
  const wantedUnit = normalizeUnitForMatch(unitInput)

  // Prefer units inventory scoped to landlord
  const { data: unitRows } = await supabase
    .from("units")
    .select("id, unit_label, building")
    .eq("landlord_id", landlordId)
    .limit(500)

  const inventory = ((unitRows ?? []) as Array<{
    id: string
    unit_label: string
    building: string | null
  }>).filter((u) => normalizeUnitForMatch(u.unit_label) === wantedUnit)

  let candidates = inventory
  if (buildingHints.length > 0 && inventory.length > 1) {
    const narrowed = inventory.filter((u) => {
      const b = (u.building ?? "").toLowerCase()
      return buildingHints.some((h) => b.includes(h) || h.includes(b) ||
        h.split(/\s+/).some((tok) => tok.length >= 3 && b.includes(tok)))
    })
    if (narrowed.length === 1) candidates = narrowed
    else if (narrowed.length > 1) candidates = narrowed
  }

  if (candidates.length === 1) {
    return {
      unitLabel: candidates[0].unit_label,
      buildingLabel: candidates[0].building,
      unitId: candidates[0].id,
      rosterHits: 0,
      routingConfidence: buildingHints.length > 0 ? 0.9 : 0.75,
    }
  }

  if (candidates.length > 1 && buildingHints.length === 0) {
    // Ambiguous multi-building unit labels — ask for property
    return null
  }

  // Fall back to active roster match (existing self-heal path)
  const residents = await findActiveResidentsByUnit(supabase, unitInput)
  if (residents.length === 0) return null

  let hits = residents
  if (buildingHints.length > 0) {
    const narrowed = residents.filter((r) => {
      const b = (r.building ?? "").toLowerCase()
      return buildingHints.some((h) =>
        b.includes(h) || h.includes(b) ||
        h.split(/\s+/).some((tok) => tok.length >= 3 && b.includes(tok))
      )
    })
    if (narrowed.length > 0) hits = narrowed
  }

  const first = hits[0]
  return {
    unitLabel: first.unit?.trim() || unitInput,
    buildingLabel: first.building?.trim() || buildingHints[0] || null,
    unitId: null,
    rosterHits: hits.length,
    routingConfidence: hits.length === 1 ? 0.8 : 0.55,
  }
}

async function classifyIssueSummary(
  text: string,
): Promise<{ trade: string | null; severity: string }> {
  try {
    const result = await classifyMaintenanceRequest({
      rawDescription: text,
      skipLlm: true,
    })
    const trade = result.vendorTrade ?? result.issueType ?? null
    const severity =
      result.severity === "critical" || result.severity === "urgent"
        ? "urgent"
        : detectUrgentIssue(text)
        ? "urgent"
        : "normal"
    return { trade: typeof trade === "string" ? trade : null, severity }
  } catch {
    return {
      trade: detectUrgentIssue(text) ? "plumbing" : null,
      severity: detectUrgentIssue(text) ? "urgent" : "normal",
    }
  }
}

function humanizeTrade(trade: string | null): string | null {
  if (!trade) return null
  const map: Record<string, string> = {
    plumbing: "plumbing",
    electrical: "electrical",
    hvac: "HVAC",
    appliance: "appliance",
    general: "maintenance",
  }
  return map[trade.toLowerCase()] ?? trade.replace(/_/g, " ")
}

async function createUnknownMaintenanceTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    phone: string
    unitLabel: string
    buildingLabel: string | null
    senderName: string | null
    issueSummary: string
    severity: string
    trade: string | null
    relationship: UnknownContactRelationship | null
    residentUserId: string | null
  },
): Promise<string | null> {
  const issueCategory = issueCategoryToVendorTrade(params.trade ?? "general")
  const dbSeverity = params.severity === "urgent" ? "urgent" : "normal"
  const priority = params.severity === "urgent" ? "urgent" : "normal"
  const estimatedMinutes = getEstimatedMinutes(issueCategory, dbSeverity)
  const dueAt = new Date(Date.now() + estimatedMinutes * 60_000)
  const name = params.senderName?.trim() || "Unknown contact"
  const emailDigits = params.phone.replace(/\D/g, "") || "unknown"

  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .insert({
      landlord_id: params.landlordId,
      priority,
      urgency: priority,
      resident_name: name,
      email: `${emailDigits}@sms-unknown.ulohome.local`,
      resident_phone: normalizeSmsPhone(params.phone),
      unit: params.unitLabel,
      description: params.buildingLabel
        ? `${params.issueSummary}\n\nProperty: ${params.buildingLabel}`
        : params.issueSummary,
      resident_user_id: params.residentUserId,
      photo_paths: [],
      issue_category: issueCategory,
      severity: dbSeverity,
      estimated_minutes: estimatedMinutes,
      due_at: dueAt.toISOString(),
      vendor_work_status: "unassigned",
    })
    .select("id")
    .single()

  if (error || !ticket?.id) {
    console.error("[unknown-contact] ticket insert", error?.message)
    return null
  }

  const ticketId = String(ticket.id)
  await supabase
    .from("sms_conversations")
    .update({
      maintenance_request_id: ticketId,
      updated_at: iso(),
    })
    .eq("id", params.conversationId)

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.request_drafted",
    source: "sms",
    actor_type: "system",
    maintenance_request_id: ticketId,
    conversation_id: params.conversationId,
    resident_id: params.residentUserId,
    metadata: {
      unknown_contact_intake: true,
      unit: params.unitLabel,
      building: params.buildingLabel,
      relationship: params.relationship,
      severity: params.severity,
      registration_incomplete: !params.residentUserId,
    },
  })

  return ticketId
}

async function notifyLandlordNewContact(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitLabel: string
    buildingLabel: string | null
    phone: string
    senderName: string | null
    relationship: UnknownContactRelationship | null
    ticketId: string | null
    conversationId: string
    urgent: boolean
  },
): Promise<void> {
  const place = params.buildingLabel
    ? `Apt ${params.unitLabel} at ${params.buildingLabel}`
    : `Apt ${params.unitLabel}`
  const who = params.senderName?.trim() || "An unverified contact"
  const rel = params.relationship && params.relationship !== "unknown"
    ? params.relationship.replace(/_/g, " ")
    : "unverified contact"
  const headline = params.urgent
    ? "Urgent repair from unverified contact"
    : "New unit contact reported an issue"
  const detail =
    `${who} (${rel}) texted about ${place}. Phone: ${normalizeSmsPhone(params.phone)}.`

  await notifyLandlordNeedsAttention(supabase, {
    landlordId: params.landlordId,
    kind: "unknown_occupant",
    headline,
    detail,
    idempotencyKey:
      `unknown_occupant:${params.conversationId}:${params.ticketId ?? "none"}`,
    maintenanceRequestId: params.ticketId,
    unitId: null,
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "sms.unknown_occupant_notified",
    source: "sms",
    actor_type: "system",
    conversation_id: params.conversationId,
    maintenance_request_id: params.ticketId,
    metadata: {
      unit: params.unitLabel,
      building: params.buildingLabel,
      relationship: params.relationship,
      phone: normalizeSmsPhone(params.phone),
      urgent: params.urgent,
    },
  })
}

/**
 * Advance unknown-contact intake for one inbound SMS turn.
 */
export async function processUnknownContactIntakeTurn(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    senderPhone: string
    inboundBody: string
    identity: SmsIdentityRow
    suggestedUnit?: string | null
    /** Prefer this as the issue description when the current body is only a unit reply. */
    seedIssueMessage?: string | null
  },
): Promise<UnknownContactTurnResult> {
  const body = params.inboundBody.trim()
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const intake =
    (convo?.intake_state as Record<string, unknown> | null) ?? null

  let state = readUnknownContactIntake(intake)
  let identity = params.identity

  if (!state) {
    const looksLikeUnitOnly = Boolean(
      extractUnitFromMessage(body) &&
        body.length <= 24 &&
        !detectUrgentIssue(body),
    )
    let seed =
      params.seedIssueMessage?.trim() ||
      (typeof intake?.initial_message === "string"
        ? intake.initial_message.trim()
        : "") ||
      (typeof intake?.description === "string" ? intake.description.trim() : "")

    if (!seed && looksLikeUnitOnly) {
      const { data: prior } = await supabase
        .from("sms_messages")
        .select("body")
        .eq("conversation_id", params.conversationId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(8)
      for (const row of prior ?? []) {
        const priorBody = typeof row.body === "string" ? row.body.trim() : ""
        if (
          priorBody.length >= 40 &&
          priorBody !== body &&
          !extractUnitFromMessage(priorBody)
        ) {
          seed = priorBody
          break
        }
        if (priorBody.length >= 40 && detectUrgentIssue(priorBody)) {
          seed = priorBody
          break
        }
      }
    }

    const originalMessage = seed || body
    state = createInitialUnknownContactState({
      conversationId: params.conversationId,
      landlordId: params.landlordId,
      senderPhone: params.senderPhone,
      originalMessage,
    })

    // First message may already include unit + address (or this turn is unit-only)
    const earlyMatch = await matchLocationFromText(
      supabase,
      params.landlordId,
      body,
    )
    if (earlyMatch) {
      state.unitLabel = earlyMatch.unitLabel
      state.buildingLabel = earlyMatch.buildingLabel
      state.unitId = earlyMatch.unitId
      state.routingConfidence = earlyMatch.routingConfidence
      state.status = "awaiting_contact_consent"
    } else if (params.suggestedUnit?.trim()) {
      // Soft hint only — still ask, but remember suggestion
      state.unitLabel = null
    }

    const classified = await classifyIssueSummary(state.originalMessage)
    state.severity = classified.severity
    state.detectedIntent = classified.trade ?? "maintenance"

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "identity.unknown_intake_started",
      source: "sms",
      actor_type: "system",
      conversation_id: params.conversationId,
      metadata: {
        severity: state.severity,
        has_location: Boolean(state.unitLabel),
      },
    })

    if (state.status === "identifying_location") {
      await persistUnknownContactIntake(supabase, {
        conversationId: params.conversationId,
        state,
        conversationStatus: "awaiting_unit_number",
      })
      return {
        replyHint: buildAskLocationSms(state.issueSummary),
        state,
        identity,
        continueIntake: false,
        selfHealingPhase: "awaiting_unit_number",
        conversationStatus: "awaiting_unit_number",
        metadata: { unknownContactStatus: state.status },
      }
    }

    // First message already included unit/property — ask consent next.
    if (state.status === "awaiting_contact_consent" && state.unitLabel) {
      if (state.severity === "urgent" && !state.ticketId) {
        const classified = await classifyIssueSummary(state.originalMessage)
        state.ticketId = await createUnknownMaintenanceTicket(supabase, {
          landlordId: params.landlordId,
          conversationId: params.conversationId,
          phone: params.senderPhone,
          unitLabel: state.unitLabel,
          buildingLabel: state.buildingLabel,
          senderName: state.senderName,
          issueSummary: state.issueSummary || state.originalMessage,
          severity: state.severity,
          trade: classified.trade,
          relationship: state.relationshipToUnit,
          residentUserId: null,
        })
      }
      await persistUnknownContactIntake(supabase, {
        conversationId: params.conversationId,
        state,
        conversationStatus: "awaiting_unit_number",
      })
      return {
        replyHint: buildAskConsentSms({
          unitLabel: state.unitLabel,
          buildingLabel: state.buildingLabel,
          urgent: state.severity === "urgent",
        }),
        state,
        identity,
        continueIntake: false,
        selfHealingPhase: "awaiting_unit_number",
        conversationStatus: "awaiting_unit_number",
        metadata: { unknownContactStatus: state.status },
      }
    }
  }

  // Enrich name / relationship from any turn
  const name = extractSenderName(body)
  if (name) state.senderName = name
  const relationship = extractRelationship(body)
  if (relationship) state.relationshipToUnit = relationship

  if (state.status === "identifying_location") {
    const match = await matchLocationFromText(
      supabase,
      params.landlordId,
      body,
    )
    if (!match) {
      state.clarificationAttempts += 1
      if (state.clarificationAttempts >= UNKNOWN_CONTACT_MAX_CLARIFY) {
        state.status = "human_review_required"
        await notifyLandlordUnresolvedTenant(supabase, {
          landlordId: params.landlordId,
          fromNumber: params.senderPhone,
          attemptedUnit: extractUnitFromMessage(body),
          conversationId: params.conversationId,
        })
        await persistUnknownContactIntake(supabase, {
          conversationId: params.conversationId,
          state,
          conversationStatus: "unresolved",
        })
        return {
          replyHint:
            "I wasn't able to match that unit on our end. I've flagged your property manager — someone will follow up with you shortly.",
          state,
          identity,
          continueIntake: false,
          selfHealingPhase: "unresolved",
          conversationStatus: "unresolved",
          metadata: { unknownContactStatus: state.status },
        }
      }
      await persistUnknownContactIntake(supabase, {
        conversationId: params.conversationId,
        state,
        conversationStatus: "awaiting_unit_number",
      })
      return {
        replyHint:
          "Thanks — I still need the property and apartment (for example: Apt 3B at 123 Main). What's the address and unit?",
        state,
        identity,
        continueIntake: false,
        selfHealingPhase: "awaiting_unit_number",
        conversationStatus: "awaiting_unit_number",
        metadata: { unknownContactStatus: state.status },
      }
    }

    state.unitLabel = match.unitLabel
    state.buildingLabel = match.buildingLabel
    state.unitId = match.unitId
    state.routingConfidence = match.routingConfidence
    state.status = "awaiting_contact_consent"

    // Urgent: mint ticket before consent so ops isn't blocked
    if (state.severity === "urgent" && !state.ticketId) {
      const classified = await classifyIssueSummary(
        state.originalMessage || body,
      )
      state.ticketId = await createUnknownMaintenanceTicket(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        phone: params.senderPhone,
        unitLabel: state.unitLabel,
        buildingLabel: state.buildingLabel,
        senderName: state.senderName,
        issueSummary: state.issueSummary || state.originalMessage,
        severity: state.severity,
        trade: classified.trade,
        relationship: state.relationshipToUnit,
        residentUserId: null,
      })
    }

    await persistUnknownContactIntake(supabase, {
      conversationId: params.conversationId,
      state,
      conversationStatus: "awaiting_unit_number",
    })

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "identity.location_resolved",
      source: "sms",
      actor_type: "system",
      conversation_id: params.conversationId,
      metadata: {
        unit: state.unitLabel,
        building: state.buildingLabel,
        routing_confidence: state.routingConfidence,
      },
    })

    return {
      replyHint: buildAskConsentSms({
        unitLabel: state.unitLabel,
        buildingLabel: state.buildingLabel,
        urgent: state.severity === "urgent",
      }),
      state,
      identity,
      continueIntake: false,
      selfHealingPhase: "awaiting_unit_number",
      conversationStatus: "awaiting_unit_number",
      metadata: { unknownContactStatus: state.status },
    }
  }

  if (
    state.status === "awaiting_contact_consent" ||
    state.status === "identifying_sender"
  ) {
    const consent = parseContactConsent(body)
    // If they only share relationship/name without yes/no, ask once more gently
    if (consent === null && (name || relationship)) {
      state.status = "awaiting_contact_consent"
      await persistUnknownContactIntake(supabase, {
        conversationId: params.conversationId,
        state,
        conversationStatus: "awaiting_unit_number",
      })
      return {
        replyHint:
          "Thanks — got it. May I save this phone number as a contact for that unit so we can route future updates correctly? Reply YES or NO.",
        state,
        identity,
        continueIntake: false,
        selfHealingPhase: "awaiting_unit_number",
        conversationStatus: "awaiting_unit_number",
        metadata: { unknownContactStatus: state.status },
      }
    }
    if (consent === null) {
      state.clarificationAttempts += 1
      await persistUnknownContactIntake(supabase, {
        conversationId: params.conversationId,
        state,
        conversationStatus: "awaiting_unit_number",
      })
      return {
        replyHint:
          "No problem — just reply YES to save this number for that unit, or NO if you'd rather not.",
        state,
        identity,
        continueIntake: false,
        selfHealingPhase: "awaiting_unit_number",
        conversationStatus: "awaiting_unit_number",
        metadata: { unknownContactStatus: state.status },
      }
    }

    state.contactSaveConsent = consent
    let residentId: string | null = null

    if (consent && state.unitLabel) {
      const matched = await findActiveResidentsByUnit(
        supabase,
        state.unitLabel,
      )
      const resident = await attachPhoneToUnitResident(supabase, {
        fromNumber: params.senderPhone,
        unit: state.unitLabel,
        matchedResidents: matched,
        fullName: state.senderName,
        building: state.buildingLabel,
      })
      residentId = resident.id

      if (state.senderName && resident.full_name === "SMS Resident") {
        await supabase
          .from("users")
          .update({
            full_name: state.senderName,
            building: state.buildingLabel ?? resident.building,
          })
          .eq("id", resident.id)
      } else if (state.senderName) {
        await supabase
          .from("users")
          .update({ full_name: state.senderName })
          .eq("id", resident.id)
      }

      identity = await upsertSmsIdentity(supabase, {
        fromNumber: params.senderPhone,
        landlordId: params.landlordId,
        existing: identity,
        patch: {
          identity_type: "resident",
          resident_id: resident.id,
          unit_id: state.unitId,
          verified: true,
        },
      })
      state.identityConfidence = 0.85

      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "identity.phone_saved",
        source: "sms",
        actor_type: "resident",
        actor_id: resident.id,
        resident_id: resident.id,
        conversation_id: params.conversationId,
        metadata: {
          unit: state.unitLabel,
          relationship: state.relationshipToUnit,
          sender_name: state.senderName,
        },
      })
    }

    const classified = await classifyIssueSummary(
      state.originalMessage || body,
    )
    if (!state.ticketId) {
      state.ticketId = await createUnknownMaintenanceTicket(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        phone: params.senderPhone,
        unitLabel: state.unitLabel || "Unknown",
        buildingLabel: state.buildingLabel,
        senderName: state.senderName,
        issueSummary: state.issueSummary || state.originalMessage,
        severity: state.severity || classified.severity,
        trade: classified.trade,
        relationship: state.relationshipToUnit,
        residentUserId: residentId,
      })
    } else if (residentId && state.ticketId) {
      await supabase
        .from("maintenance_requests")
        .update({
          resident_user_id: residentId,
          resident_name: state.senderName?.trim() || "Resident",
        })
        .eq("id", state.ticketId)
    }

    await notifyLandlordNewContact(supabase, {
      landlordId: params.landlordId,
      unitLabel: state.unitLabel || "Unknown",
      buildingLabel: state.buildingLabel,
      phone: params.senderPhone,
      senderName: state.senderName,
      relationship: state.relationshipToUnit,
      ticketId: state.ticketId,
      conversationId: params.conversationId,
      urgent: (state.severity || classified.severity) === "urgent",
    })

    state.status = "submitted"
    await persistUnknownContactIntake(supabase, {
      conversationId: params.conversationId,
      state,
      conversationStatus: "open",
    })

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "identity.onboarding_completed",
      source: "sms",
      actor_type: "system",
      conversation_id: params.conversationId,
      maintenance_request_id: state.ticketId,
      resident_id: residentId,
      metadata: {
        contact_save_consent: consent,
        relationship: state.relationshipToUnit,
        unit: state.unitLabel,
      },
    })

    const tradeLabel = humanizeTrade(classified.trade)
    const replyHint = consent
      ? buildSavedAndSubmittedSms({
        senderName: state.senderName,
        unitLabel: state.unitLabel || "your unit",
        urgent: (state.severity || classified.severity) === "urgent",
        tradeLabel,
      })
      : buildSubmittedWithoutSaveSms({
        unitLabel: state.unitLabel || "your unit",
        urgent: (state.severity || classified.severity) === "urgent",
      })

    return {
      replyHint,
      state,
      identity,
      continueIntake: Boolean(consent && residentId),
      selfHealingPhase: consent ? "resolved" : "awaiting_unit_number",
      conversationStatus: "open",
      metadata: {
        unknownContactStatus: state.status,
        ticketId: state.ticketId,
        contactSaveConsent: consent,
      },
    }
  }

  if (state.status === "submitted") {
    return {
      replyHint:
        "We've already opened your request with the property team. They'll follow up shortly.",
      state,
      identity,
      continueIntake: Boolean(identity.resident_id),
      selfHealingPhase: identity.resident_id ? "resolved" : "awaiting_unit_number",
      conversationStatus: "open",
      metadata: { unknownContactStatus: state.status },
    }
  }

  // human_review_required or unexpected
  await persistUnknownContactIntake(supabase, {
    conversationId: params.conversationId,
    state,
    conversationStatus: "unresolved",
  })
  return {
    replyHint:
      "I've let your property manager know. Someone from the team will follow up with you shortly.",
    state,
    identity,
    continueIntake: false,
    selfHealingPhase: "unresolved",
    conversationStatus: "unresolved",
    metadata: { unknownContactStatus: state.status },
  }
}
