/**
 * Landlord notice when an automated text is suppressed because the same
 * message already went out. Generic menus and closed offers stay quiet.
 * A real notice names the resident, home, and repair, and says what to do.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { uloAppUrl } from "../uloAppUrl.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import { formatLocationWithOptionalUnit } from "../properties/unitLabelDisplay.ts"
import { residentRequestRef } from "./residentRequestRef.ts"
import { loadTicketRescheduleFacts } from "./tenantRescheduleLandlordNotice.ts"

export type ReplyLoopAudience = "resident" | "property_team"

const GENERIC_SUPPRESSED_REPLY = [
  "happy to help. what do you need",
  "how can we help with your maintenance issue",
  "that offer isn't available anymore",
  "that action isn't available on this account",
]

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

/** A repeated generic menu or a closed offer does not need a person. */
export function replyLoopNeedsIntervention(body: string): boolean {
  const text = clean(body).toLowerCase()
  if (!text) return false
  return !GENERIC_SUPPRESSED_REPLY.some((snippet) => text.includes(snippet))
}

function usableName(name: string | null | undefined): string {
  const text = clean(name)
  if (!text || /^there$/i.test(text)) return ""
  return text
}

function actionLine(audience: ReplyLoopAudience, body: string): string {
  const text = body.toLowerCase()
  if (/\bapprove\b/.test(text) && /\bdecline\b/.test(text)) {
    return "Reply APPROVE or DECLINE for that estimate."
  }
  if (/\bpayment\b/.test(text)) {
    return "Reply with the payment choice on this thread."
  }
  if (audience === "resident") {
    return "Text the resident on this request."
  }
  return "Open the request and answer the latest question."
}

export function buildReplyLoopAttention(input: {
  audience: ReplyLoopAudience
  residentName?: string | null
  propertyAddress?: string | null
  unitLabel?: string | null
  propertyType?: string | null
  repairLabel?: string | null
  suppressedBody: string
}): {
  headline: string
  detail: string
  whyLine: string
  nextSteps: string[]
} {
  const name = usableName(input.residentName)
  const place = formatLocationWithOptionalUnit({
    propertyLabel: clean(input.propertyAddress),
    unitLabel: input.unitLabel,
    propertyType: input.propertyType,
  })
  const repair = clean(input.repairLabel).replace(/[.]+$/, "")
  const who = input.audience === "property_team"
    ? (place ? `The property-team thread for ${place}` : "The property-team thread")
    : (name && place ? `${name} at ${place}` : name || place || "A text thread")
  const headline = input.audience === "property_team"
    ? `${who} needs an answer`
    : `${who} needs a follow-up`
  const issue = repair ? `${repair.charAt(0).toUpperCase()}${repair.slice(1)}. ` : ""
  return {
    headline,
    detail: `${issue}Ulo stopped a repeated text, so this thread stays quiet until someone replies.`,
    whyLine: actionLine(input.audience, input.suppressedBody),
    nextSteps: [],
  }
}

export async function loadReplyLoopContext(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    audience: ReplyLoopAudience
  },
): Promise<{
  residentName: string | null
  propertyAddress: string | null
  unitLabel: string | null
  propertyType: string | null
  repairLabel: string | null
  ticketId: string | null
  requestRef: string | null
  dashboardUrl: string
}> {
  const empty = {
    residentName: null,
    propertyAddress: null,
    unitLabel: null,
    propertyType: null,
    repairLabel: null,
    ticketId: null,
    requestRef: null,
    dashboardUrl: uloAppUrl.admin(),
  }
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("resident_id, maintenance_request_id")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (!conv) return empty

  let ticketId = typeof conv.maintenance_request_id === "string"
    ? conv.maintenance_request_id.trim()
    : ""
  const residentId = typeof conv.resident_id === "string" ? conv.resident_id.trim() : ""

  let residentName: string | null = null
  if (residentId) {
    const { data: user } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", residentId)
      .maybeSingle()
    const name = usableName(typeof user?.full_name === "string" ? user.full_name : null)
    residentName = name || null
  }

  if (!ticketId && residentId && params.audience === "resident") {
    const { data: tickets } = await supabase
      .from("maintenance_requests")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("resident_id", residentId)
      .in("status", ["open", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(2)
    if (tickets?.length === 1 && typeof tickets[0]?.id === "string") {
      ticketId = tickets[0].id
    }
  }

  if (!ticketId) {
    return { ...empty, residentName }
  }

  const facts = await loadTicketRescheduleFacts(supabase, params.landlordId, ticketId)
  const { data: refRow } = await supabase
    .from("maintenance_requests")
    .select("resident_request_ref")
    .eq("id", ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  const requestRef = residentRequestRef(
    ticketId,
    typeof refRow?.resident_request_ref === "string" ? refRow.resident_request_ref : null,
  )
  return {
    residentName,
    propertyAddress: facts.propertyAddress,
    unitLabel: facts.unitLabel,
    propertyType: facts.propertyType,
    repairLabel: facts.repairLabel,
    ticketId,
    requestRef,
    dashboardUrl: uloAppUrl.adminWorkOrder(formatWorkOrderRef(ticketId)),
  }
}
