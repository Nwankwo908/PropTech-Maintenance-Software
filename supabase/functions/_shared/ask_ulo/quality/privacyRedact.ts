/**
 * Privacy helpers for Ask Ulo — minimize PII sent to outside AI services.
 */

export type PrivacyRedactionResult = {
  text: string
  redacted: boolean
  categories: string[]
}

const PATTERNS: Array<{ category: string; re: RegExp; replace: string }> = [
  {
    category: "ssn",
    re: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replace: "[REDACTED_SSN]",
  },
  {
    category: "email",
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: "[REDACTED_EMAIL]",
  },
  {
    category: "phone",
    re: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    replace: "[REDACTED_PHONE]",
  },
  {
    category: "dob",
    re: /\b(?:dob|date\s+of\s+birth|born)\s*[:#]?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi,
    replace: "[REDACTED_DOB]",
  },
  {
    category: "credit_card",
    re: /\b(?:\d[ -]*?){13,19}\b/g,
    replace: "[REDACTED_CARD]",
  },
  {
    category: "screening_score",
    re: /\b(?:credit\s*score|fico|vantage\s*score)\s*(?:is|=|:)?\s*\d{3}\b/gi,
    replace: "[REDACTED_CREDIT_SCORE]",
  },
]

/**
 * Strip common PII before sending text to external LLM providers.
 * Conservative: prefer over-redaction for screening-related content.
 */
export function redactPiiForExternalAi(input: string): PrivacyRedactionResult {
  let text = input
  const categories = new Set<string>()
  for (const p of PATTERNS) {
    if (p.category === "credit_card") {
      // Avoid nuking ordinary dollar amounts / years — only long digit runs.
      const next = text.replace(p.re, (m) => {
        const digits = m.replace(/\D/g, "")
        if (digits.length < 13 || digits.length > 19) return m
        categories.add(p.category)
        return p.replace
      })
      text = next
      continue
    }
    const next = text.replace(p.re, () => {
      categories.add(p.category)
      return p.replace
    })
    text = next
  }
  return {
    text,
    redacted: categories.size > 0,
    categories: [...categories],
  }
}

export function redactHistoryForExternalAi(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): { history: Array<{ role: "user" | "assistant"; content: string }>; redacted: boolean } {
  let redacted = false
  const out = history.map((m) => {
    const r = redactPiiForExternalAi(m.content)
    if (r.redacted) redacted = true
    return { role: m.role, content: r.text }
  })
  return { history: out, redacted }
}
