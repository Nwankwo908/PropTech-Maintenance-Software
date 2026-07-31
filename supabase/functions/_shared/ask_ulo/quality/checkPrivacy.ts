/**
 * Post-answer privacy check — refuse drafts that leak PII / screening data.
 */

import { redactPiiForExternalAi } from "./privacyRedact.ts"

export type AnswerPrivacyCheck = {
  pass: boolean
  failClosed: boolean
  block: "clarify" | "refuse" | null
  summary: string
  reasons: string[]
  /** Categories detected (ssn, phone, screening_score, …). */
  categories: string[]
  /** Safe redacted copy when soft PII was present but not fail-closed. */
  redactedAnswer?: string
}

const HARD_FAIL_CATEGORIES = new Set([
  "ssn",
  "credit_card",
  "dob",
  "screening_score",
])

/**
 * Did the drafted answer reveal private / screening information?
 * Fail-closed on hard PII or when screening isolation was on and screening detail leaked.
 */
export function checkAnswerPrivacy(input: {
  answer: string
  screeningIsolation?: boolean
  sensitiveTopicIds?: string[]
}): AnswerPrivacyCheck {
  const redaction = redactPiiForExternalAi(input.answer)
  const reasons: string[] = []
  const categories = redaction.categories

  const hardLeak = categories.some((c) => HARD_FAIL_CATEGORIES.has(c))
  if (hardLeak) {
    reasons.push(
      `pii_leak:${categories.filter((c) => HARD_FAIL_CATEGORIES.has(c)).join(",")}`,
    )
  }

  const screeningTopics = (input.sensitiveTopicIds ?? []).filter(
    (id) => id === "tenant_screening" || id === "application_denial",
  )
  const discussesScreening =
    /\b(credit\s*score|fico|background\s*check|criminal\s*record|eviction\s*filing|deny\s+(?:the\s+)?application|approve\s+(?:the\s+)?applicant)\b/i
      .test(input.answer)

  if (
    (input.screeningIsolation || screeningTopics.length > 0) &&
    discussesScreening
  ) {
    reasons.push("screening_detail_in_answer")
  }

  const failClosed = reasons.length > 0
  const softPii =
    !failClosed &&
    redaction.redacted &&
    categories.some((c) => c === "email" || c === "phone")

  return {
    pass: !failClosed,
    failClosed,
    block: failClosed ? "refuse" : null,
    summary: failClosed
      ? "Answer revealed private or screening information that should not be shown."
      : softPii
        ? "Answer contained contact PII — redacted for safety."
        : "No private-information leak detected.",
    reasons: failClosed
      ? reasons
      : softPii
        ? [`soft_pii:${categories.join(",")}`]
        : [],
    categories,
    redactedAnswer: redaction.redacted ? redaction.text : undefined,
  }
}
