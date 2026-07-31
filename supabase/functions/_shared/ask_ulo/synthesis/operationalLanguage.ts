/**
 * Humanize operational / database wording into language a property manager would use.
 * Applied deterministically before landlord-facing answers ship.
 */

export const OPERATIONAL_LANGUAGE_GUIDE = `
## Humanize operational language (never skip)

Before sending, rewrite operational data into natural property-manager language.
Replace technical, abbreviated, or database-style wording.

Examples:
- "waiting on accept" → "waiting for the vendor to accept the job"
- "pending accept" → "hasn't responded yet"
- "last assigned ~0d ago" → "assigned today"
- "last assigned ~1d ago" → "assigned yesterday"
- "~3d ago" → "about 3 days ago"
- "expected response time expired" → "the vendor response deadline has passed"
- "vendor_assigned" → "waiting for the vendor to respond"
- "workflow escalated" → "this job needs your attention"
- "in_progress" → "work is currently underway"
- "review_required" → "waiting for your approval"

Never expose internal status values, abbreviations, or relative time syntax like "~0d".
Always convert timestamps into natural language.

### Lead with the takeaway
Start with the most important insight — not raw field dumps.

Bad: "FreshNest Cleaning still hasn't accepted 2 assigned jobs."
Better: "The biggest follow-up today is FreshNest Cleaning. They still haven't responded to two recently assigned jobs."

### Avoid explaining retrieval
Never say: "I'm listing…", "I searched…", "I found…", "Based on…", "In scope…"
Present the information as a knowledgeable advisor would.

### Add context
Explain why it matters when you can — not just counts.

### Vary sentence structure
Don't make every list item follow the exact same database-field pattern.
`.trim()

/** "~0d ago" / "last assigned ~3d ago" → natural relative time. */
export function formatRelativeDaysAgo(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "recently"
  const d = Math.max(0, Math.floor(days))
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 7) return `about ${d} days ago`
  if (d < 28) {
    const w = Math.round(d / 7)
    return w === 1 ? "about a week ago" : `about ${w} weeks ago`
  }
  const m = Math.round(d / 30)
  return m === 1 ? "about a month ago" : `about ${m} months ago`
}

/** Assignment phrasing for vendor activity lines. */
export function formatLastAssigned(days: number | null | undefined): string {
  const rel = formatRelativeDaysAgo(days)
  if (rel === "today") return "assigned today"
  if (rel === "yesterday") return "assigned yesterday"
  return `last assigned ${rel}`
}

const STATUS_REWRITES: Array<[RegExp, string]> = [
  [/\bpending[_\s-]?accept\b/gi, "hasn't responded yet"],
  [/\bwaiting\s+on\s+accept\b/gi, "waiting for the vendor to accept the job"],
  [/\bwaiting\s+for\s+accept\b/gi, "waiting for the vendor to accept the job"],
  [/\bvendor[_\s-]?assigned\b/gi, "waiting for the vendor to respond"],
  [/\bworkflow\s+escalated\b/gi, "this job needs your attention"],
  [/\bescalated\s+workflow\b/gi, "this job needs your attention"],
  [/\bin[_\s-]?progress\b/gi, "work is currently underway"],
  [/\breview[_\s-]?required\b/gi, "waiting for your approval"],
  [/\bunassigned\b/gi, "no vendor assigned yet"],
  [/\baccepted\b(?!\s+jobs?\b)/gi, "vendor accepted the job"],
]

const TIME_REWRITES: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  [
    /\blast\s+assigned\s*~(\d+)d\s+ago\b/gi,
    (_match: string, n: string) => {
      const d = Number(n)
      if (d === 0) return "assigned today"
      if (d === 1) return "assigned yesterday"
      return `assigned about ${d} days ago`
    },
  ],
  [
    /\b~(\d+)d\s+ago\b/gi,
    (_match: string, n: string) => {
      const d = Number(n)
      if (d === 0) return "today"
      if (d === 1) return "yesterday"
      return `about ${d} days ago`
    },
  ],
  [
    /\b(\d+)d\s+ago\b/gi,
    (_match: string, n: string) => {
      const d = Number(n)
      if (d === 0) return "today"
      if (d === 1) return "yesterday"
      return `${d} days ago`
    },
  ],
]

const RETRIEVAL_VOICE_REWRITES: Array<[RegExp, string]> = [
  [/\bI'?m\s+listing\b[^.\n]*\.?\s*/gi, ""],
  [/\bI\s+searched\b[^.\n]*\.?\s*/gi, ""],
  [/\bI\s+found\b/gi, ""],
  [/\bBased\s+on\b[^.\n]*,\s*/gi, ""],
  [/\bIn\s+scope\b/gi, "across your portfolio"],
  [
    /\bnot\s+a\s+portfolio\s+health\s+briefing\b\.?/gi,
    "",
  ],
  [
    /\b(?:open\s+)?\*{0,2}pending\s+accept\*{0,2}\s+jobs?\b/gi,
    "jobs the vendor hasn't responded to yet",
  ],
]

const PHRASE_REWRITES: Array<[RegExp, string]> = [
  [
    /\bexpected\s+response\s+time\s+expired\b/gi,
    "the vendor response deadline has passed",
  ],
  [
    /\b(\d+)\s+jobs?\s+waiting\s+on\s+accept\b/gi,
    "$1 job(s) waiting for the vendor to accept",
  ],
  [
    /\bstill\s+hasn'?t\s+accepted\s+\*{0,2}(\d+)\*{0,2}\s+assigned\s+jobs?\b/gi,
    "still hasn't responded to $1 recently assigned job(s)",
  ],
]

function applyPairs(
  raw: string,
  pairs: Array<[RegExp, string | ((...args: string[]) => string)]>,
): string {
  let s = raw
  for (const [re, to] of pairs) {
    s = s.replace(re, to as Parameters<typeof String.prototype.replace>[1])
  }
  return s
}

/** Deterministic operational-language pass (run before or after other polish). */
export function humanizeOperationalProse(raw: string): string {
  if (!raw.trim()) return raw
  let s = raw
  s = applyPairs(s, STATUS_REWRITES)
  s = applyPairs(s, TIME_REWRITES)
  s = applyPairs(s, PHRASE_REWRITES)
  s = applyPairs(s, RETRIEVAL_VOICE_REWRITES)

  // Collapse empty lines left after stripping retrieval sentences
  s = s.replace(/\n{3,}/g, "\n\n")
  s = s.replace(/[^\S\n]{2,}/g, " ").replace(/[ \t]+\n/g, "\n")
  return s.trim()
}

export function looksLikeOperationalJargon(text: string): boolean {
  return (
    /\bpending[_\s-]?accept\b/i.test(text) ||
    /\bwaiting\s+on\s+accept\b/i.test(text) ||
    /\b~?\d+d\s+ago\b/i.test(text) ||
    /\blast\s+assigned\s*~/i.test(text) ||
    /\bI'?m\s+listing\b/i.test(text) ||
    /\bvendor_assigned\b/i.test(text) ||
    /\breview_required\b/i.test(text) ||
    /\bin_progress\b/i.test(text)
  )
}
