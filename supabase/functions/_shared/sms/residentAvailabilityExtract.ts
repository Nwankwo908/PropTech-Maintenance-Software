/**
 * Extract resident visit / access windows from free-form SMS for vendor scheduling.
 */

const AVAILABILITY_CUE =
  /\b(?:available|availability|someone\s+will\s+be\s+(?:home|available)|i\s+(?:am|'m)\s+available|we\s+(?:are|'re)\s+available|can\s+come\s+out|come\s+out\s+to\s+inspect|after\s+\d|between\s+\d|from\s+\d|this\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday)|next\s+(?:saturday|sunday|monday|week)|all\s+day)\b/i

const WINDOW_CHUNK =
  /(?:(?:this|next|coming)\s+)?(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|sat|sun|mon|tue|wed|thu|fri)(?:[^.!?\n]{0,80}?(?:after|before|between|from|until|to|-|–|—)\s*[\d:][^.!?\n]{0,40})?|(?:all\s+day)|(?:after\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|(?:between\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+and\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi

/** True when the message looks like it includes visit availability. */
export function hasResidentAvailabilityCues(text: string): boolean {
  return AVAILABILITY_CUE.test(text.trim())
}

/**
 * Pull a compact, vendor-facing summary of resident visit windows from SMS text.
 * Returns null when nothing useful is found.
 */
export function extractResidentAvailabilityText(
  raw: string,
): string | null {
  const text = raw.replace(/\s+/g, " ").trim()
  if (!text || !hasResidentAvailabilityCues(text)) return null

  const chunks: string[] = []
  const seen = new Set<string>()
  const matches = text.match(WINDOW_CHUNK) ?? []
  for (const m of matches) {
    const cleaned = m.replace(/\s+/g, " ").trim()
    if (cleaned.length < 6) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    chunks.push(cleaned)
    if (chunks.length >= 6) break
  }

  if (chunks.length === 0) {
    // Fall back: grab sentences that mention availability.
    const sentences = text.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      if (!AVAILABILITY_CUE.test(s)) continue
      const cleaned = s.replace(/\s+/g, " ").trim()
      if (cleaned.length < 12 || cleaned.length > 220) continue
      chunks.push(cleaned)
      if (chunks.length >= 3) break
    }
  }

  if (chunks.length === 0) return null
  return chunks.join("; ")
}

/** Format for ticket description / vendor SMS. */
export function formatResidentAvailabilityForVendor(
  availabilityText: string | null | undefined,
): string | null {
  const t = availabilityText?.trim()
  if (!t) return null
  return t.length > 280 ? `${t.slice(0, 277)}…` : t
}
