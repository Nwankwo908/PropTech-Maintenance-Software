/**
 * Recurring / prior-visit language in tenant SMS — feeds intake confirmations,
 * follow-up questions, and landlord-facing recurring signals.
 */

const RECURRING_ISSUE_RE =
  /\b(?:again|before|still|repeatedly|repeat(?:ed|ing)?|keeps?\s+(?:coming|happening|coming\s+back)|come\s+back|coming\s+back|didn'?t\s+work|doesn'?t\s+work|never\s+worked|came\s+out\s+(?:before|already)|already\s+(?:came|been|fixed|treated|sprayed)|someone\s+(?:came|was)\s+out|prior\s+visit|last\s+time|second\s+time|not\s+the\s+first\s+time|isn'?t\s+the\s+first\s+time|this\s+isn'?t\s+the\s+first)\b/i

export function detectRecurringIssueSignal(text: string): boolean {
  return RECURRING_ISSUE_RE.test(text.trim())
}

/**
 * One-sentence tenant confirmation — never quotes raw stored description /
 * "Tenant update:" scaffolding. Reuses issue noun-phrase extraction.
 */
export function buildIntakeUnderstandingConfirm(input: {
  issuePhrase: string
  recurring?: boolean
  priorVisitKnown?: boolean
}): string {
  const raw = input.issuePhrase.trim().replace(/\.$/, '')
  const issue = (raw.replace(/^an?\s+/i, '') || 'a maintenance issue').replace(
    /^./,
    (c) => c.toLowerCase(),
  )
  // Keep known proper acronyms capitalized when they lead the phrase.
  const display = /^(hvac|ac)\b/i.test(issue)
    ? issue.replace(/^(hvac|ac)\b/i, (m) => m.toUpperCase())
    : issue
  if (input.priorVisitKnown) {
    return `Got it — ${display}, and I see this has come up for your unit before.`
  }
  if (input.recurring) {
    return `Got it — ${display}, and it sounds like this has come up before.`
  }
  return `Got it — ${display}.`
}
