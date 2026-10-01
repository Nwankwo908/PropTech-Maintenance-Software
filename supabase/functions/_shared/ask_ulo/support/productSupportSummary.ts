/**
 * Product-support ticket summary + dedup signature (not raw transcript).
 */

/** Collapse wording noise for stable signatures. */
export function normalizeProductSupportTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(
      /\b(please|just|really|still|again|ulo|the|a|an|to|for|of|my|me|i|is|are|was|were|can|could|would|how|do|does|did|what|where|why|when|help|support|ticket)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Short landlord-facing summary — never the full chat transcript.
 */
export function generateProductSupportSummary(
  question: string,
  opts?: { maxChars?: number },
): string {
  const maxChars = opts?.maxChars ?? 90
  let cleaned = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hi|hey|hello|ulo)[,!.\s]+/i, "")
    .replace(
      /\b(?:i\s+)?need\s+help\s+from\s+support\s*[—\-:,]?\s*/gi,
      "",
    )
    .replace(/\b(?:i\s+)?need\s+help\s+(?:with|on)\s+/gi, "")
    .trim()

  if (!cleaned) return "Product support request"

  // Prefer an actionable how-to / broken-UX core.
  const howMatch = cleaned.match(
    /\b((?:how\s+do\s+i|how\s+to|where\s+(?:do\s+i|is|can\s+i)|(?:doesn'?t|won'?t|isn'?t)\s+work(?:ing)?|can'?t\s+\w+|vendor\s+invite|ask\s+ulo\s+panel)[^?.!]*)/i,
  )
  if (howMatch?.[1]) {
    cleaned = howMatch[1].trim()
  }

  cleaned = cleaned.replace(/[.?!]+$/g, "").trim()
  if (cleaned.length <= maxChars) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  const cut = cleaned.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(" ")
  const base =
    lastSpace > Math.floor(maxChars * 0.45) ? cut.slice(0, lastSpace) : cut
  const out = `${base.replace(/[,:;]+$/g, "").trim()}…`
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** Stable hex signature from normalized topic tokens. */
export function productSupportDedupSignature(summaryOrQuestion: string): string {
  const normalized = normalizeProductSupportTopic(summaryOrQuestion)
  const tokens = normalized.split(" ").filter((t) => t.length > 1).slice(0, 12)
  const key = tokens.join(" ") || "product-support"
  // FNV-1a 32-bit — fast, deterministic, no crypto dependency in Deno tests.
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `ps_${(hash >>> 0).toString(16).padStart(8, "0")}_${tokens.slice(0, 4).join("_") || "x"}`
}

export function buildTranscriptExcerpt(input: {
  question: string
  history?: Array<{ role: string; content: string }>
  maxChars?: number
}): string {
  const maxChars = input.maxChars ?? 800
  const lines: string[] = []
  for (const msg of (input.history ?? []).slice(-4)) {
    const role = msg.role === "assistant" ? "Ulo" : "Landlord"
    lines.push(`${role}: ${msg.content.trim().slice(0, 200)}`)
  }
  lines.push(`Landlord: ${input.question.trim().slice(0, 400)}`)
  const joined = lines.join("\n")
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1)}…`
}
