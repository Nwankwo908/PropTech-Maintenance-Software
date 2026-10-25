/**
 * One reply to "Which property is this for?" saves that property.
 * Booking stays in the normal dispatch path after the address is known.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { dispatchConfirmedMaintenanceTicket } from "../confirmedMaintenanceDispatch.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  canHandlePropertyChoice,
  matchPropertyChoice,
  propertyUnknownAttentionCopy,
  readAwaitingPropertyChoice,
} from "../vendorPropertyGate.ts"

export { canHandlePropertyChoice }

function propertyChoiceRetry(options: { label: string }[]): string {
  const copy = propertyUnknownAttentionCopy({
    emergency: false,
    issueLine: null,
    options: options.map((option, index) => ({
      id: String(index),
      label: option.label,
    })),
  })
  const lines = [
    "Which property is this for?",
    "",
    "We will not book anyone until we know the address.",
  ]
  if (copy.nextSteps.length > 0) {
    lines.push("", ...copy.nextSteps.map((label, index) => `${index + 1} — ${label}`))
  }
  lines.push("", copy.choiceReplyHint)
  return lines.join("\n")
}

export async function tryHandlePropertyChoiceInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string | null
    body: string
    identityType: string
  },
): Promise<{ handled: boolean; replyBody?: string; ticketId?: string }> {
  const { data: conversation } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const intake = conversation?.intake_state
  if (!canHandlePropertyChoice({
    identityType: params.identityType,
    intakeState: intake,
  })) {
    return { handled: false }
  }
  const pending = readAwaitingPropertyChoice(intake)
  if (!pending) return { handled: false }

  const match = matchPropertyChoice(params.body, pending.options)
  if (!match) {
    return {
      handled: true,
      ticketId: pending.ticket_id,
      replyBody: propertyChoiceRetry(pending.options),
    }
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, landlord_id, name, street_address, city")
    .eq("id", match.id)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  const propertyId = typeof property?.id === "string" ? property.id : ""
  if (!propertyId) {
    return {
      handled: true,
      ticketId: pending.ticket_id,
      replyBody: propertyChoiceRetry(pending.options),
    }
  }

  const { data: updated, error } = await supabase
    .from("maintenance_requests")
    .update({ property_id: propertyId })
    .eq("id", pending.ticket_id)
    .eq("landlord_id", params.landlordId)
    .select("id")
    .maybeSingle()
  if (error || !updated?.id) {
    console.error("[property-choice] save property", error)
    return {
      handled: true,
      ticketId: pending.ticket_id,
      replyBody: propertyChoiceRetry(pending.options),
    }
  }

  const prior = intake && typeof intake === "object"
    ? { ...(intake as Record<string, unknown>) }
    : {}
  delete prior.awaiting_property_choice
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: prior,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  const street = typeof property?.street_address === "string"
    ? property.street_address.trim()
    : ""
  const name = typeof property?.name === "string" ? property.name.trim() : ""
  const place = street || name || match.label

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.property_confirmed",
    source: "sms",
    actorType: "landlord",
    propertyId,
    maintenanceRequestId: pending.ticket_id,
    conversationId: params.conversationId,
    messageId: params.messageId,
    metadata: {
      message: `Property confirmed for this job: ${place}. A vendor can be booked for that address.`,
    },
  })

  let booked = false
  try {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("priority, urgency, severity, unit, description, issue_headline")
      .eq("id", pending.ticket_id)
      .maybeSingle()
    const outcome = await dispatchConfirmedMaintenanceTicket(supabase, {
      ticketId: pending.ticket_id,
      landlordId: params.landlordId,
      residentConfirmed: true,
      priority: typeof ticket?.priority === "string" && ticket.priority.trim()
        ? ticket.priority
        : "normal",
      urgency: typeof ticket?.urgency === "string" ? ticket.urgency : null,
      severity: typeof ticket?.severity === "string" ? ticket.severity : null,
      unit: typeof ticket?.unit === "string" ? ticket.unit : "",
      description: typeof ticket?.description === "string" ? ticket.description : "",
      issueHeadline: typeof ticket?.issue_headline === "string"
        ? ticket.issue_headline
        : null,
    })
    booked = outcome.vendorAssigned
  } catch (dispatchError) {
    console.error("[property-choice] dispatch after address", dispatchError)
  }

  const replyBody = booked
    ? `Thanks. This job is for ${place}.\n\nWe're contacting a vendor for that address.`
    : `Thanks. This job is for ${place}.\n\nWe'll only book a vendor for that address.`
  return { handled: true, ticketId: pending.ticket_id, replyBody }
}
