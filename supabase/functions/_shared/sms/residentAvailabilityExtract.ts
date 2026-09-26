/**
 * Extract resident visit / access windows from free-form SMS for vendor scheduling.
 */

/** Real visit-window cues — not vendor request phrasing like "can come out to spray". */
const AVAILABILITY_CUE =
  /\b(?:available|availability|someone\s+will\s+be\s+(?:home|available)|i\s+(?:am|'m)\s+available|we\s+(?:are|'re)\s+available|after\s+\d|between\s+\d|from\s+\d|this\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday)|next\s+(?:saturday|sunday|monday|week)|all\s+day|(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.{0,40}\b(?:am|pm|\d{1,2}))\b/i

const WINDOW_CHUNK_SOURCE =
  String.raw`(?:(?:this|next|coming)\s+)?(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|sat|sun|mon|tue|wed|thu|fri)(?:[^.!?\n]{0,80}?(?:after|before|between|from|until|to|-|–|—)\s*[\d:][^.!?\n]{0,40})?|(?:all\s+day)|(?:after\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|(?:between\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+and\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`

function windowChunkRe(): RegExp {
  return new RegExp(WINDOW_CHUNK_SOURCE, "gi")
}

function hasWindowChunk(text: string): boolean {
  return new RegExp(WINDOW_CHUNK_SOURCE, "i").test(text)
}

/** True when the message looks like it includes visit availability. */
export function hasResidentAvailabilityCues(text: string): boolean {
  return AVAILABILITY_CUE.test(text.trim())
}

/** Issue / greeting copy that must never be treated as visit windows. */
function looksLikeIssueOrGreeting(text: string): boolean {
  return (
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thank)/i.test(text.trim()) ||
    /\b(?:exterminator|pest|roach|leak|clog|outlet|spark|plumber|electrician|broken|not working|spray the (?:property|unit))\b/i
      .test(text)
  )
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
  const matches = text.match(windowChunkRe()) ?? []
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
    // Fall back: grab sentences that mention availability — never issue reports.
    const sentences = text.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      if (!AVAILABILITY_CUE.test(s)) continue
      if (looksLikeIssueOrGreeting(s)) continue
      const cleaned = s.replace(/\s+/g, " ").trim()
      if (cleaned.length < 12 || cleaned.length > 160) continue
      // Prefer sentences that also include a day/time window chunk.
      if (!(hasWindowChunk(cleaned) || /\b(?:am|pm|\d{1,2}\s*(?::\d{2})?\s*(?:am|pm))\b/i.test(cleaned))) {
        continue
      }
      chunks.push(cleaned)
      if (chunks.length >= 3) break
    }
  }

  if (chunks.length === 0) return null
  const joined = chunks.join("; ")
  // Whole-message fallback is never safe when the text is an issue report.
  if (looksLikeIssueOrGreeting(joined) && !hasWindowChunk(joined)) return null
  return joined
}

/**
 * True when stored availability is a real visit window, not a copy of the
 * opening issue message (or other free-text intake field).
 */
export function isDistinctResidentAvailability(
  availability: string | null | undefined,
  sourceTexts: Array<string | null | undefined> = [],
): boolean {
  const t = (availability ?? "").replace(/\s+/g, " ").trim()
  if (!t) return false
  if (looksLikeIssueOrGreeting(t) && !hasWindowChunk(t)) return false
  const lower = t.toLowerCase()
  for (const raw of sourceTexts) {
    const s = (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase()
    if (!s) continue
    if (lower === s) return false
    // Stored field accidentally equals the greeting lead of the first message.
    if (s.startsWith(lower) && lower.length >= 40) return false
    if (lower.startsWith(s) && s.length >= 40) return false
  }
  // Require an actual day/time cue — "available" alone is not enough.
  return hasWindowChunk(t) || /\b(?:am|pm|after\s+\d|between\s+\d|all\s+day)\b/i.test(t)
}

/**
 * Vendor SMS / ticket writes: return a real visit window or null.
 * Never pass opening issue text through as "Resident avail".
 */
export function sanitizeResidentAvailabilityForVendor(
  availability: string | null | undefined,
  sourceTexts: Array<string | null | undefined> = [],
): string | null {
  const t = (availability ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  if (!isDistinctResidentAvailability(t, sourceTexts)) return null
  return t.length > 280 ? `${t.slice(0, 277)}…` : t
}

/** Format for ticket description / vendor SMS. */
export function formatResidentAvailabilityForVendor(
  availabilityText: string | null | undefined,
): string | null {
  return sanitizeResidentAvailabilityForVendor(availabilityText)
}
