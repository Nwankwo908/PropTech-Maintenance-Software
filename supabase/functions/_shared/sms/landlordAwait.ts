/**
 * A property-team text owns the next resident reply when it asks for a photo
 * or more information. A trailing "?" is sufficient, not required.
 * Rent reminders stay on the rent workflow.
 */

const RENT_PROMPT_RE = /\b(reply\s+paid|reply\s+partial|reply\s+questions)\b/i

const PHOTO_ASK_RE =
  /\b(photo|picture|pic|image|video|screenshot)\b/i
const PHOTO_VERB_RE =
  /\b(send|add|reply|text|share|upload|take|include)\b/i
const INFO_ASK_RE =
  /\b(please|could you|can you)\b[\s\S]{0,80}\b(reply|text us|let us know|tell us|send (?:us |me )?)/i

/** Rent reminder copy must not be treated as a maintenance hold. */
export function looksLikeRentPrompt(body: string): boolean {
  return RENT_PROMPT_RE.test(body)
}

/**
 * True when the property team is waiting on the resident.
 * Matches a question, a photo/video ask, or a direct request to reply.
 */
export function landlordMessageAwaitsTenantReply(body: string): boolean {
  const text = body.trim()
  if (!text || looksLikeRentPrompt(text)) return false
  if (/\?\s*$/.test(text)) return true
  if (PHOTO_ASK_RE.test(text) && PHOTO_VERB_RE.test(text)) return true
  return INFO_ASK_RE.test(text)
}

/**
 * Last gate before an automated rent text. Disabled rent and a property-team
 * wait must not send the PAID / PARTIAL / QUESTIONS fallback. Emergencies
 * still go out. Explicit paused-rent acknowledgements are not this fallback.
 */
export function suppressAutomatedRentReply(input: {
  workflowRoute?: string
  source?: string
  replyBody: string
  rentPaused: boolean
  staffAwaiting: boolean
  inboundIsEmergency: boolean
}): boolean {
  const source = input.source ?? ""
  const rentReply =
    input.workflowRoute === "rent_collection" ||
    source === "tenant_rent_reply" ||
    source.includes("rent_collection")
  if (!rentReply || input.inboundIsEmergency) return false
  if (input.staffAwaiting) return true
  const fallback = input.replyBody.includes("didn't quite catch that") &&
    /\bPAID\b/.test(input.replyBody) &&
    /\bPARTIAL\b/.test(input.replyBody)
  return input.rentPaused && fallback
}
