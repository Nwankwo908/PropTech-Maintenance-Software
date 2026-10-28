/**
 * Landlord notice when a resident asks to move a visit.
 * The saved appointment stays in place until a new time is confirmed.
 * Only saved names, addresses, units, repairs, and windows are included.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { formatLocationWithOptionalUnit } from "../properties/unitLabelDisplay.ts"

export type TenantRescheduleNoticeInput = {
  /** Vendor text was accepted by the provider. */
  vendorNotified: boolean
  /** Stable code from the reschedule attempt. Never a database message. */
  failureCode?: string | null
  /** Confirmed visit still on the request, in plain language. */
  currentVisitLabel: string | null
  /** Day and time the resident offered. */
  preferredWindow: string | null
  residentName?: string | null
  propertyAddress?: string | null
  unitLabel?: string | null
  propertyType?: string | null
  repairLabel?: string | null
  /**
   * True only when this account's settings require a sign-off
   * before the vendor is asked. A normal visit change is not one of these.
   */
  approvalRequired?: boolean
}

export type TenantRescheduleNotice = {
  outcome: "inform" | "failed" | "approval"
  headline: string
  detail: string
  /** Replaces the generic "This needs a decision from you." */
  whyLine: string
  nextSteps: string[]
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

export function formatSavedPropertyAddress(parts: {
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}): string | null {
  const street = clean(parts.streetAddress)
  const city = clean(parts.city)
  const state = clean(parts.state)
  const zip = clean(parts.zipCode)
  const region = [state, zip].filter(Boolean).join(" ")
  const cityRegion = [city, region].filter(Boolean).join(", ")
  const line = [street, cityRegion].filter(Boolean).join(", ")
  return line || null
}

function placePhrase(input: TenantRescheduleNoticeInput): string {
  return formatLocationWithOptionalUnit({
    propertyLabel: formatSavedPropertyAddress({
      streetAddress: input.propertyAddress,
    }) ?? clean(input.propertyAddress),
    unitLabel: input.unitLabel,
    propertyType: input.propertyType,
  })
}

function subjectPhrase(input: TenantRescheduleNoticeInput): {
  name: string
  place: string
  subject: string
} {
  const name = clean(input.residentName)
  const place = placePhrase(input)
  const subject = name && place ? `${name} at ${place}` : name || place
  return { name, place, subject }
}

function issueSentence(repairLabel: string | null | undefined): string | null {
  const text = clean(repairLabel).replace(/[.]+$/, "")
  if (!text) return null
  const clipped = text.length > 80 ? `${text.slice(0, 77).trim()}…` : text
  if (/\b(is|are|was|were|isn't|aren't|not|won't|can't|leak|leaking|out|broken|sparking)\b/i.test(clipped)) {
    return clipped.charAt(0).toUpperCase() + clipped.slice(1)
  }
  const body = /^(a|an|the|no)\b/i.test(clipped)
    ? clipped.charAt(0).toLowerCase() + clipped.slice(1)
    : `the ${clipped.charAt(0).toLowerCase()}${clipped.slice(1)}`
  return `The repair is ${body}`
}

function hasCalendarDate(text: string): boolean {
  return /\b(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text) ||
    /\b\d{1,2}\/\d{1,2}\b/.test(text)
}

function datePrefix(label: string): string | null {
  const date = label.replace(/,?\s*\d{1,2}:\d{2}\s*[ap]m\b.*$/i, "").trim()
  if (!date || date === label.trim()) return null
  return hasCalendarDate(date) ? date : null
}

/** Prefer the saved window, including its end time. Use the timestamp only to add a missing date. */
export function resolveCurrentVisitLabel(
  scheduledWindowText: string | null | undefined,
  scheduledAtLabel: string | null | undefined,
): string | null {
  const window = clean(scheduledWindowText)
  const at = clean(scheduledAtLabel)
  if (window && hasCalendarDate(window)) return window
  if (window) {
    const date = at ? datePrefix(at) : null
    return date ? `${date}, ${window}` : window
  }
  return at || null
}

function headlineFor(input: TenantRescheduleNoticeInput): string {
  const { name, subject } = subjectPhrase(input)
  if (name) return `${subject} asked to move a visit`
  if (subject) return `${subject} has a request to move a visit`
  return "A visit was asked to be moved"
}

function factSentences(input: TenantRescheduleNoticeInput): string[] {
  const { name } = subjectPhrase(input)
  const lines: string[] = []
  const issue = issueSentence(input.repairLabel)
  if (issue) lines.push(issue)
  const current = clean(input.currentVisitLabel)
  if (current) lines.push(`The current visit is still ${current}`)
  const preferred = clean(input.preferredWindow)
  if (preferred) {
    lines.push(name ? `They asked for ${preferred}` : `The requested time is ${preferred}`)
  }
  return lines
}

function person(input: TenantRescheduleNoticeInput): string {
  return clean(input.residentName) || "The resident"
}

export function buildTenantRescheduleLandlordNotice(
  input: TenantRescheduleNoticeInput,
): TenantRescheduleNotice {
  const headline = headlineFor(input)
  const facts = factSentences(input)
  const current = clean(input.currentVisitLabel)
  const preferred = clean(input.preferredWindow)

  if (input.approvalRequired === true && !input.vendorNotified) {
    const keep = current
      ? `NO to keep ${current}`
      : "NO to leave the visit unchanged"
    const ask = preferred
      ? `YES to ask the vendor about ${preferred}`
      : "YES to ask the vendor for a new time"
    return {
      outcome: "approval",
      headline,
      detail: [...facts, "The visit stays in place until you approve a change."].join(". "),
      whyLine: `Reply ${ask}, or ${keep}.`,
      nextSteps: [],
    }
  }

  if (input.vendorNotified) {
    return {
      outcome: "inform",
      headline,
      detail: [
        ...facts,
        "We asked the vendor for a new time and will text you when it is confirmed.",
      ].join(". "),
      whyLine: "No reply is needed.",
      nextSteps: [],
    }
  }

  const code = (input.failureCode ?? "").trim()
  const who = person(input)
  const whyLine = code === "no_vendor" || code === "no_vendor_phone"
    ? `Add a phone number for the vendor in Ulo. ${who} can send the new time again after that.`
    : code === "send_failed"
    ? `Open the visit in Ulo and contact the vendor, or wait until ${who === "The resident" ? "the resident" : who} sends the time again.`
    : `No reply is needed. ${who} can send the new day and time again.`

  return {
    outcome: "failed",
    headline,
    detail: [...facts, "The vendor was not texted."].join(". "),
    whyLine,
    nextSteps: [],
  }
}

function firstRepairLine(description: string | null, category: string | null): string | null {
  const raw = clean(description).split(/[.!\n]/)[0] ?? ""
  if (raw && !/^(open request|request)$/i.test(raw)) return raw
  const trade = clean(category).replace(/[_-]+/g, " ")
  if (!trade || /^(other|general|unknown)$/i.test(trade)) return null
  return trade
}

/** Address and repair from this ticket's property only. Never the landlord's other homes. */
export async function loadTicketRescheduleFacts(
  supabase: SupabaseClient,
  landlordId: string,
  ticketId: string,
): Promise<{
  propertyId: string | null
  propertyAddress: string | null
  unitLabel: string | null
  propertyType: string | null
  repairLabel: string | null
  scheduledWindowText: string | null
}> {
  const empty = {
    propertyId: null,
    propertyAddress: null,
    unitLabel: null,
    propertyType: null,
    repairLabel: null,
    scheduledWindowText: null,
  }
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("property_id, unit, description, issue_category, scheduled_window_text")
    .eq("id", ticketId)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (!ticket) return empty

  const propertyId = typeof ticket.property_id === "string" ? ticket.property_id.trim() : ""
  let propertyAddress: string | null = null
  let propertyType: string | null = null
  if (propertyId) {
    const { data: property } = await supabase
      .from("properties")
      .select("street_address, city, state, zip_code, property_type")
      .eq("id", propertyId)
      .eq("landlord_id", landlordId)
      .maybeSingle()
    if (property) {
      propertyType = typeof property.property_type === "string" ? property.property_type : null
      propertyAddress = formatSavedPropertyAddress({
        streetAddress: typeof property.street_address === "string" ? property.street_address : null,
        city: typeof property.city === "string" ? property.city : null,
        state: typeof property.state === "string" ? property.state : null,
        zipCode: typeof property.zip_code === "string" ? property.zip_code : null,
      })
    }
  }

  return {
    propertyId: propertyId || null,
    propertyAddress,
    unitLabel: typeof ticket.unit === "string" ? ticket.unit : null,
    propertyType,
    repairLabel: firstRepairLine(
      typeof ticket.description === "string" ? ticket.description : null,
      typeof ticket.issue_category === "string" ? ticket.issue_category : null,
    ),
    scheduledWindowText: typeof ticket.scheduled_window_text === "string"
      ? ticket.scheduled_window_text
      : null,
  }
}
