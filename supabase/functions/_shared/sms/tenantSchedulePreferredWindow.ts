/**
 * Shared day/time cues for tenant schedule counter-propose / reschedule.
 * Kept separate so tenantScheduleConfirm ↔ vendorRescheduleSms stay cycle-free.
 */

/** True when the text includes a day and/or clock cue for a visit window. */
export function hasTenantScheduleTimeCue(text: string): boolean {
  return (
    /\b(tomorrow|today|tonight|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i
      .test(text) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(text) ||
    /\b(?:after|before|between|from)\s+\d{1,2}\b/i.test(text)
  )
}

/**
 * Pull the resident's alternate window from a decline / counter-propose SMS.
 * Strips leading NO / decline filler so vendors see a clean preference.
 */
export function extractTenantSchedulePreferredWindow(
  body: string,
): string | null {
  let text = body.replace(/\s+/g, " ").trim()
  if (!text || !hasTenantScheduleTimeCue(text)) return null

  text = text
    .replace(
      /^(?:no|n|nope|nah)(?:\s*[,.\-–—:]+\s*|\s+)/i,
      "",
    )
    .replace(
      /^(?:that\s+)?(?:time\s+)?(?:doesn'?t|does\s+not)\s+work(?:\s+for\s+me)?(?:\s*[,.\-–—:]+\s*|\s+)/i,
      "",
    )
    .replace(
      /^(?:i\s+)?(?:won'?t|cannot|can'?t)\s+be\s+(?:home|there|available)(?:\s*[,.\-–—:]+\s*|\s+)/i,
      "",
    )
    .replace(
      /^(?:can\s+they\s+come|another\s+(?:day|time)|different\s+(?:day|time)|how\s+about|what\s+about)(?:\s*[,.\-–—?]+\s*|\s+)/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "")
    .trim()

  if (!text || text.length < 3 || !hasTenantScheduleTimeCue(text)) return null
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}
