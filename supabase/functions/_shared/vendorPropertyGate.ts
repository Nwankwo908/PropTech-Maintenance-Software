/**
 * Vendor search may start before a street address is known.
 * Booking (assigned_vendor_id) waits until the ticket has one property.
 *
 * One property on the account is assumed and saved.
 * Several properties: ask which one, and only search statewide when they
 * share a single state. An emergency still alerts a person immediately.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "./landlordAttentionNotify.ts"
import { normalizeUsStateCode } from "./vendorServiceArea.ts"

export type VendorPropertyInput = {
  id: string
  name?: string | null
  streetAddress?: string | null
  city?: string | null
  state?: string | null
}

export type PropertyChoiceOption = {
  id: string
  label: string
}

export type VendorPropertyDecision = {
  /** Save this property onto the ticket. Only set when it is the only one. */
  assumePropertyId: string | null
  /** A vendor may be assigned and sent. */
  mayBook: boolean
  /** State-wide availability search may start. */
  mayLook: boolean
  /** Text the property team which property this is. */
  askProperty: boolean
  state: string | null
  options: PropertyChoiceOption[]
}

const AWAITING_PROPERTY_CHOICE = "awaiting_property_choice"

export type AwaitingPropertyChoice = {
  ticket_id: string
  options: PropertyChoiceOption[]
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function propertyChoiceLabel(property: VendorPropertyInput): string {
  const street = clean(property.streetAddress)
  const name = clean(property.name)
  const city = clean(property.city)
  let label = ""
  if (street && name && street.toLowerCase() !== name.toLowerCase()) {
    label = `${name}, ${street}`
  } else {
    label = street || name || "Unnamed property"
  }
  if (city && !label.toLowerCase().includes(city.toLowerCase())) {
    label = `${label}, ${city}`
  }
  return label
}

function choiceOptions(properties: VendorPropertyInput[]): PropertyChoiceOption[] {
  const options = properties
    .map((property) => ({
      id: clean(property.id),
      label: propertyChoiceLabel(property),
    }))
    .filter((option) => option.id.length > 0)
  const counts = new Map<string, number>()
  for (const option of options) {
    const key = option.label.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return options.map((option) => {
    const key = option.label.toLowerCase()
    const next = (seen.get(key) ?? 0) + 1
    seen.set(key, next)
    if ((counts.get(key) ?? 0) < 2) return option
    return { ...option, label: `${option.label} (${next})` }
  })
}

function sharedState(properties: VendorPropertyInput[]): string | null {
  const states = new Set<string>()
  for (const property of properties) {
    const code = normalizeUsStateCode(clean(property.state))
    if (code) states.add(code)
  }
  if (states.size !== 1) return null
  return [...states][0] ?? null
}

/**
 * Looking is allowed when every property is in one state.
 * Booking is allowed only when the ticket already names a property,
 * or the landlord has exactly one property to assume.
 */
export function decideVendorPropertyGate(input: {
  ticketPropertyId: string | null
  properties: VendorPropertyInput[]
}): VendorPropertyDecision {
  const ticketPropertyId = clean(input.ticketPropertyId)
  const properties = input.properties.filter((property) => clean(property.id))
  if (ticketPropertyId) {
    const match = properties.find((property) => clean(property.id) === ticketPropertyId)
    return {
      assumePropertyId: null,
      mayBook: true,
      mayLook: true,
      askProperty: false,
      state: match ? normalizeUsStateCode(clean(match.state)) : null,
      options: [],
    }
  }
  if (properties.length === 1) {
    const only = properties[0]!
    return {
      assumePropertyId: clean(only.id),
      mayBook: true,
      mayLook: true,
      askProperty: false,
      state: normalizeUsStateCode(clean(only.state)),
      options: [],
    }
  }
  if (properties.length === 0) {
    return {
      assumePropertyId: null,
      mayBook: false,
      mayLook: false,
      askProperty: false,
      state: null,
      options: [],
    }
  }
  const state = sharedState(properties)
  return {
    assumePropertyId: null,
    mayBook: false,
    mayLook: state != null,
    askProperty: true,
    state,
    options: choiceOptions(properties),
  }
}

export function propertyUnknownAttentionCopy(input: {
  emergency: boolean
  issueLine: string | null
  options: PropertyChoiceOption[]
}): {
  headline: string
  locationLine: string
  whyLine: string
  nextSteps: string[]
  choiceReplyHint: string
} {
  const issue = clean(input.issueLine)
  const listed = input.options.slice(0, 8).map((option) => option.label)
  return {
    headline: input.emergency
      ? "emergency — which property is this for?"
      : "which property is this for?",
    locationLine: issue || "The address is not on this job yet.",
    whyLine: input.emergency
      ? "This is an emergency, so your team is being alerted now. We will not book anyone until we know the address."
      : "We can look for a vendor, but we will not book anyone until we know the address.",
    nextSteps: input.options.length > 8 ? [] : listed,
    choiceReplyHint: input.options.length > 8
      ? "Reply with the property name or street address."
      : "Reply with the property name, or the number next to it.",
  }
}

export function isImmediatePropertyEmergency(input: {
  priority?: string | null
  urgency?: string | null
  severity?: string | null
}): boolean {
  const hay = [input.priority, input.urgency, input.severity]
    .map((value) => clean(value).toLowerCase())
    .join(" ")
  return /\b(emergency|critical)\b/.test(hay)
}

function normalizeChoiceText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Match a landlord reply to one offered property. Numbers only match the list index. */
export function matchPropertyChoice(
  body: string,
  options: PropertyChoiceOption[],
): PropertyChoiceOption | null {
  const text = body.trim()
  if (!text || options.length === 0) return null
  if (/^\d{1,2}$/.test(text)) {
    const index = Number(text) - 1
    return options[index] ?? null
  }
  const normalized = normalizeChoiceText(text)
  if (!normalized) return null
  const exact = options.filter((option) =>
    normalizeChoiceText(option.label) === normalized
  )
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return null
  if (normalized.length < 3) return null
  const partial = options.filter((option) =>
    normalizeChoiceText(option.label).includes(normalized)
  )
  if (partial.length === 1) return partial[0]!
  return null
}

export function readAwaitingPropertyChoice(
  intakeState: unknown,
): AwaitingPropertyChoice | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>)[AWAITING_PROPERTY_CHOICE]
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const ticketId = clean(typeof record.ticket_id === "string" ? record.ticket_id : "")
  const options = Array.isArray(record.options)
    ? record.options.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as Record<string, unknown>
      const id = clean(typeof row.id === "string" ? row.id : "")
      const label = clean(typeof row.label === "string" ? row.label : "")
      if (!id || !label) return []
      return [{ id, label }]
    })
    : []
  if (!ticketId || options.length === 0) return null
  return { ticket_id: ticketId, options }
}

export function canHandlePropertyChoice(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType === "vendor") return false
  return readAwaitingPropertyChoice(input.intakeState) != null
}

function mapPropertyRow(row: Record<string, unknown>): VendorPropertyInput | null {
  const id = clean(typeof row.id === "string" ? row.id : "")
  if (!id) return null
  return {
    id,
    name: typeof row.name === "string" ? row.name : null,
    streetAddress: typeof row.street_address === "string" ? row.street_address : null,
    city: typeof row.city === "string" ? row.city : null,
    state: typeof row.state === "string" ? row.state : null,
  }
}

async function loadLandlordProperties(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<VendorPropertyInput[]> {
  const { data } = await supabase
    .from("properties")
    .select("id, name, street_address, city, state")
    .eq("landlord_id", landlordId)
    .limit(200)
  return (data ?? []).flatMap((row) => {
    const mapped = mapPropertyRow(row as Record<string, unknown>)
    return mapped ? [mapped] : []
  })
}

async function rememberPropertyChoice(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    ticketId: string
    options: PropertyChoiceOption[]
  },
): Promise<void> {
  const { data: conversations } = await supabase
    .from("sms_conversations")
    .select("id, intake_state")
    .eq("landlord_id", input.landlordId)
    .eq("maintenance_request_id", input.ticketId)
    .eq("conversation_type", "landlord_update")
  for (const conversation of conversations ?? []) {
    const id = typeof conversation.id === "string" ? conversation.id : ""
    if (!id) continue
    const prior = conversation.intake_state &&
        typeof conversation.intake_state === "object"
      ? { ...(conversation.intake_state as Record<string, unknown>) }
      : {}
    prior[AWAITING_PROPERTY_CHOICE] = {
      ticket_id: input.ticketId,
      options: input.options,
    }
    await supabase
      .from("sms_conversations")
      .update({
        intake_state: prior,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
  }
}

/**
 * After location resolution: assume the only property, or ask which one.
 * Does not assign a vendor. Emergency alerts go out before any booking.
 */
export async function holdBookingUntilPropertyKnown(
  supabase: SupabaseClient,
  input: {
    ticketId: string
    landlordId: string | null
    emergency: boolean
    issueLine: string | null
  },
): Promise<VendorPropertyDecision> {
  const landlordId = clean(input.landlordId)
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("property_id")
    .eq("id", input.ticketId)
    .maybeSingle()
  const ticketPropertyId = clean(
    typeof ticket?.property_id === "string" ? ticket.property_id : "",
  )
  if (!landlordId) {
    return decideVendorPropertyGate({
      ticketPropertyId: ticketPropertyId || null,
      properties: [],
    })
  }
  const properties = ticketPropertyId
    ? []
    : await loadLandlordProperties(supabase, landlordId)
  const decision = decideVendorPropertyGate({
    ticketPropertyId: ticketPropertyId || null,
    properties,
  })
  if (decision.assumePropertyId && !ticketPropertyId) {
    const { error } = await supabase
      .from("maintenance_requests")
      .update({ property_id: decision.assumePropertyId })
      .eq("id", input.ticketId)
      .is("property_id", null)
    if (error) {
      console.error("[vendor-property] assume sole property", error)
      return { ...decision, mayBook: false, mayLook: decision.mayLook }
    }
    return decision
  }
  if (!decision.askProperty) return decision

  const copy = propertyUnknownAttentionCopy({
    emergency: input.emergency,
    issueLine: input.issueLine,
    options: decision.options,
  })
  try {
    const alert = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "workflow_escalated",
      headline: copy.headline,
      detail: copy.locationLine,
      whyLine: copy.whyLine,
      nextSteps: copy.nextSteps,
      choiceReplyHint: copy.choiceReplyHint,
      idempotencyKey: input.emergency
        ? `property-unknown-emergency:${input.ticketId}`
        : `property-unknown:${input.ticketId}`,
      maintenanceRequestId: input.ticketId,
      omitWorkOrderRef: true,
      isCritical: input.emergency,
    })
    await rememberPropertyChoice(supabase, {
      landlordId,
      ticketId: input.ticketId,
      options: decision.options,
    })
    const sent = alert.smsSent.length + alert.emailSent.length > 0
    if (sent) {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: input.emergency
          ? "maintenance.emergency_property_unknown"
          : "maintenance.property_choice_requested",
        source: "automation",
        actorType: "system",
        maintenanceRequestId: input.ticketId,
        metadata: {
          message: input.emergency
            ? "Alerted the property team about an emergency before the address was known. No vendor was booked."
            : "Asked which property this job is for. No vendor was booked.",
        },
      })
    }
  } catch (error) {
    console.error("[vendor-property] ask which property", error)
  }
  return decision
}
