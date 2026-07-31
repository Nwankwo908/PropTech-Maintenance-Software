/**
 * Post-answer confidence check — refuse drafts that overclaim certainty.
 */

export type AnswerConfidenceCheck = {
  pass: boolean
  failClosed: boolean
  block: "clarify" | "refuse" | null
  summary: string
  reasons: string[]
}

const OVERCONFIDENT_RE =
  /\b(definitely|certainly|guaranteed|100\s*%|without\s+(?:a\s+)?doubt|always\s+illegal|never\s+legal|you\s+must\s+win|court\s+will\s+(?:definitely|always))\b/i

const LEGAL_ABSOLUTE_RE =
  /\b(it\s+is\s+(?:illegal|unlawful)\s+to|you\s+are\s+required\s+by\s+law\s+to|the\s+law\s+requires\s+you\s+to)\b/i

/**
 * Did the answer make claims that are too confident for the evidence / topic?
 */
export function checkAnswerConfidence(input: {
  intent: string
  answer: string
  hasEvidence?: boolean
  citationCount?: number
  requireCounsel?: boolean
}): AnswerConfidenceCheck {
  const reasons: string[] = []
  const hasSources =
    Boolean(input.hasEvidence) || (input.citationCount ?? 0) > 0

  if (OVERCONFIDENT_RE.test(input.answer) && !hasSources) {
    reasons.push("overconfident_without_evidence")
  }

  if (
    input.intent === "legal" &&
    LEGAL_ABSOLUTE_RE.test(input.answer) &&
    (input.citationCount ?? 0) === 0
  ) {
    reasons.push("absolute_legal_claim_without_citation")
  }

  if (
    input.intent === "legal" &&
    input.requireCounsel &&
    OVERCONFIDENT_RE.test(input.answer)
  ) {
    reasons.push("overconfident_on_counsel_topic")
  }

  // Soft warn path: overconfident wording with some evidence — do not fail-closed.
  const softOverclaim =
    reasons.length === 0 &&
    hasSources &&
    OVERCONFIDENT_RE.test(input.answer) &&
    input.intent === "legal"

  if (softOverclaim) {
    reasons.push("overconfident_tone_legal")
  }

  const failClosed =
    reasons.includes("overconfident_without_evidence") ||
    reasons.includes("absolute_legal_claim_without_citation") ||
    reasons.includes("overconfident_on_counsel_topic")

  const pass = reasons.length === 0

  return {
    pass,
    failClosed,
    block: failClosed ? "refuse" : null,
    summary: failClosed
      ? "Answer is more certain than the evidence supports."
      : pass
        ? "Confidence level looks appropriate."
        : "Tone is assertive — treat conclusions cautiously.",
    reasons,
  }
}
