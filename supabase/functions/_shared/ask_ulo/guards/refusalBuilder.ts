/**
 * Explain missing information clearly — from the landlord's perspective.
 * Never make the user learn how the AI works.
 */

export const MISSING_INFO_COMMUNICATION_GUIDE = `
## Explain missing information clearly (critical)

When you cannot complete a task, explain it from the user's perspective — not the AI's.

Never explain your internal reasoning, retrieval process, evidence requirements,
or investigation mechanics. Never make the user learn how the AI works.

The user should only have to understand their property.
Translate technical gaps into plain language that helps them decide.

### Forbidden user-facing phrases
Never say things like:
- I investigated / I searched / I reviewed / I analyzed
- I don't have enough evidence
- What's missing depends on…
- Evidence-backed answer
- Nearby dashboard metric
- Based on the available context / available data (as a dodge)
- Response Sufficiency / evidence threshold / packets / retrieval / context window
- Keep investigating / earn the right to answer

### Required 3-part model (when you cannot fully answer)
1. **What I know** — concrete facts you can see about their portfolio
2. **What's missing** — what you cannot determine yet, and why (property terms)
3. **What happens next** — what you'll do once that information is available

Use simple, direct language. Lead with the limitation in one clear sentence.

Bad: "I don't have enough evidence for an evidence-backed answer."
Good: "I can't tell which maintenance requests are becoming emergencies because I can't see how they've progressed over time."

Bad: "What's missing depends on the question."
Good: "To answer this, I need things like whether vendors have responded, whether requests missed their deadlines, or whether the same issue was reported more than once."

Bad: "I won't substitute a nearby dashboard metric."
Good: "Rather than guessing from your open work order count, I'd rather tell you exactly what's missing."

Example shape:
**What I know** — I can see that you have 25 open maintenance requests.
**What's missing** — I can't tell which ones are becoming emergencies because I don't have their history, vendor progress, or missed deadlines.
**What happens next** — Once that information is available, I'll rank the requests by risk and explain why each one deserves attention.
`.trim()

/** Phrases that describe AI mechanics — must never appear in landlord-facing text. */
const AI_MECHANICS_PHRASE_RE =
  /\b(i\s+investigated|i\s+don'?t\s+have\s+enough\s+evidence|what'?s\s+missing\s+depends|i\s+searched|i\s+reviewed|i\s+analyzed|evidence[- ]backed|nearby\s+dashboard\s+metric|based\s+on\s+(?:the\s+)?available\s+context|response\s+sufficiency|evidence\s+threshold|earn(?:ed|ing)?\s+the\s+right\s+to\s+answer|keep\s+investigating|i\s+started\s+investigating|tool\s+packets?|context\s+window|retrieval\s+process|incomplete\s+investigation)\b/i

export type IncompleteAnswerParts = {
  /** One-line opener — what you cannot tell yet / what you can tell. */
  lead: string
  /** Concrete facts available today. */
  whatIKnow: string
  /** What you cannot determine + why (portfolio language). */
  whatsMissing: string
  /** What you'll do once the gap is filled. */
  whatHappensNext: string
}

/**
 * Format the standard 3-part incomplete-answer message.
 */
export function formatIncompleteAnswer(parts: IncompleteAnswerParts): string {
  return [
    parts.lead,
    "",
    "**What I know**",
    parts.whatIKnow,
    "",
    "**What's missing**",
    parts.whatsMissing,
    "",
    "**What happens next**",
    parts.whatHappensNext,
  ].join("\n")
}

/** Default incomplete answer for analytical / emergency-style questions. */
export function incompleteMaintenanceRiskAnswer(opts?: {
  openCount?: number | null
}): string {
  const count = opts?.openCount
  const know =
    typeof count === "number" && count >= 0
      ? `I can see that you have **${count}** open maintenance requests.`
      : "I can see your open maintenance activity at a high level."
  return formatIncompleteAnswer({
    lead:
      "I can't tell which maintenance requests are becoming emergencies yet, because I can't see how individual tickets have progressed over time.",
    whatIKnow: know,
    whatsMissing:
      "I don't have enough detail on vendor responses, missed deadlines, repeat reports, or how each request has changed — so I can't separate routine tickets from ones that are heating up.",
    whatHappensNext:
      "Once that history is available, I'll rank the requests by risk and explain why each one deserves attention — rather than guessing from the open-ticket count alone.",
  })
}

export function incompleteEntityRootCauseAnswer(opts?: {
  label?: string | null
}): string {
  const label = opts?.label?.trim() || "that specific issue"
  return formatIncompleteAnswer({
    lead: `I can't explain why ${label} hasn't been resolved yet.`,
    whatIKnow: `I know you're asking about ${label}, not a portfolio-wide total.`,
    whatsMissing:
      "I need the matching work order's status history, vendor assignment, and how long each step has been waiting before I can say what's blocking it.",
    whatHappensNext:
      "Once those details are available, I'll walk through what stalled, why it matters, and what I'd do next for that issue specifically.",
  })
}

export function incompleteOldestWaitingAnswer(): string {
  return formatIncompleteAnswer({
    lead: "I can't say which work order has been waiting the longest yet.",
    whatIKnow: "I can see that you have open maintenance activity.",
    whatsMissing:
      "I don't have clear waiting ages tied to each open ticket, property, and unit — so I can't pick the single oldest one with confidence.",
    whatHappensNext:
      "Once ages and property linkage are available, I'll name the exact work order, how long it's been waiting, and why it's still open — rather than guessing from your open-ticket count.",
  })
}

export function incompleteInvestigationAnswer(opts?: {
  openCount?: number | null
  questionHint?: string | null
}): string {
  const hint = opts?.questionHint?.trim()
  const lead = hint
    ? `I can't fully answer that yet — specifically about ${hint}.`
    : "I can't fully answer that yet with the detail you need."
  const know =
    typeof opts?.openCount === "number" && opts.openCount >= 0
      ? `I can see that you have **${opts.openCount}** open maintenance requests.`
      : "I can see high-level activity across your portfolio."
  return formatIncompleteAnswer({
    lead,
    whatIKnow: know,
    whatsMissing:
      "I'm missing the request-level history that would let me name specific issues — things like vendor progress, missed deadlines, escalations, and whether the same problem has come back more than once.",
    whatHappensNext:
      "Once that information is available, I'll give you a clear finding and what I'd focus on first. Rather than guessing from portfolio totals, I'd rather tell you exactly what's missing.",
  })
}

/** Honest gap when subject is resident but no on-subject packet matched. */
export function incompleteResidentSubjectAnswer(opts?: {
  residentFilter?: string | null
}): string {
  const filter = opts?.residentFilter ?? null
  if (filter === "message_nonresponse") {
    return formatIncompleteAnswer({
      lead: "I can't list which tenants haven't replied to your messages yet.",
      whatIKnow:
        "I can see portfolio and maintenance activity, but not a clear open SMS thread waiting on a resident reply.",
      whatsMissing:
        "I need outbound SMS to residents plus whether they replied afterward — not rent balances or property health scores.",
      whatHappensNext:
        "Once those message threads are available, I'll name who is still waiting to reply and how long you've been waiting.",
    })
  }
  if (filter === "move_in") {
    return formatIncompleteAnswer({
      lead: "I can't list who moved in this period yet.",
      whatIKnow:
        "I can see portfolio activity, but not a clear move-in date roll for each resident.",
      whatsMissing:
        "I need resident or occupancy move-in dates — not open work-order counts or property health.",
      whatHappensNext:
        "Once move-in dates are on file, I'll list who moved in and where.",
    })
  }
  return formatIncompleteAnswer({
    lead: "I can't list residents who are consistently late on rent yet.",
    whatIKnow:
      "I can see your portfolio and maintenance activity, but not a clear rent-payment / arrears ledger for each resident.",
    whatsMissing:
      "I need resident rent balances, late-payment history, or collections status tied to each occupant — not property health scores.",
    whatHappensNext:
      "Once rent collection records are available in Ulo, I'll name the residents who are repeatedly late, how far past due they are, and what I'd follow up on first.",
  })
}

/** Honest gap when subject forbids property-dashboard fallback and no on-subject packet exists. */
export function incompleteSubjectGapAnswer(opts: {
  subject: string
  openCount?: number | null
  residentFilter?: string | null
  capability?: string | null
  /** Original question — used for weather / grants / predictive honest-gap copy. */
  question?: string | null
}): string {
  if (opts.subject === "resident" || opts.subject === "finance") {
    return incompleteResidentSubjectAnswer({
      residentFilter: opts.residentFilter ?? null,
    })
  }
  if (opts.subject === "vendor") {
    return formatIncompleteAnswer({
      lead: "I can't answer that vendor question from property priority alone.",
      whatIKnow:
        typeof opts.openCount === "number" && opts.openCount >= 0
          ? `I can see that you have **${opts.openCount}** open maintenance requests, but that doesn't rank your vendors.`
          : "I can see portfolio activity, but that isn't a vendor ranking.",
      whatsMissing:
        "I need vendor acceptance, response, completion, or workload history for the metric you asked about.",
      whatHappensNext:
        "Once those vendor metrics are available, I'll answer with the vendors themselves — not which building needs attention first.",
    })
  }

  const q = (opts.question ?? "").trim()
  if (/\bweather\s+alerts?\b|\bweather\b.{0,40}\baffect\b/i.test(q)) {
    return formatIncompleteAnswer({
      lead: "I can't check live weather alerts for your properties yet.",
      whatIKnow:
        "I know where your buildings are in the portfolio, but I don't have a weather-alert feed wired into Ask Ulo.",
      whatsMissing:
        "I need an external weather / NWS alerts source tied to each property's location — Ulo doesn't pull storm, freeze, or heat warnings today.",
      whatHappensNext:
        "Once weather alerts are connected, I'll tell you which properties sit in an active alert zone and what I'd watch for (pipes, HVAC, roof, access). For now, check your local NWS / weather service for those cities.",
    })
  }
  if (/\bgrants?\b|\btax\s+incentives?\b/i.test(q)) {
    return formatIncompleteAnswer({
      lead: "I can't look up landlord grants or tax incentives yet.",
      whatIKnow: "I can see your portfolio operations, but not a grants / incentive database.",
      whatsMissing:
        "I need an external program catalog (federal, state, local) — that isn't connected to Ask Ulo today.",
      whatHappensNext:
        "Once that source is available, I'll match programs to your markets. For now, check your state housing agency or a tax advisor for current incentives.",
    })
  }
  if (
    /\bforecast\b|\bpredict\b|\bmight\s+not\s+renew\b|\bbefore\s+winter\b|\bmost\s+likely\s+to\s+need\b/i
      .test(q)
  ) {
    return formatIncompleteAnswer({
      lead: "I can't make that forward-looking prediction from live ops alone yet.",
      whatIKnow:
        "I can see current maintenance, workflows, and portfolio activity — not a trained forecast model for that ask.",
      whatsMissing:
        "I need predictive signals (renewal risk models, seasonal maintenance forecasts, or similar) that aren't available as an Ask Ulo tool today.",
      whatHappensNext:
        "Once those models are connected, I'll give you a ranked prediction with the drivers. Until then I won't invent a forecast from open-ticket totals.",
    })
  }

  return incompleteInvestigationAnswer({
    openCount: opts.openCount,
    questionHint: opts.subject.replace(/_/g, " "),
  })
}

export function incompleteTaskAnswer(): string {
  return formatIncompleteAnswer({
    lead: "I can't complete that specific ask with what I can see right now.",
    whatIKnow: "I can see general portfolio activity, but not the exact detail that would finish your question.",
    whatsMissing:
      "I need the specific records tied to what you asked for — not just overall totals or a health score.",
    whatHappensNext:
      "Once that detail is available, I'll give you a straight answer to your question. Rather than guessing from a portfolio count, I'd rather tell you exactly what's missing.",
  })
}

/**
 * True when user-facing text leaks AI mechanics / process language.
 */
export function looksLikeAiMechanicsLanguage(answer: string): boolean {
  return AI_MECHANICS_PHRASE_RE.test(answer.trim())
}

/**
 * True when an incomplete answer uses the landlord-facing 3-part shape
 * (or clear what-I-can / can't / need language).
 */
export function looksLikeClearMissingInfoExplanation(answer: string): boolean {
  const text = answer.trim()
  if (!text) return false
  if (looksLikeAiMechanicsLanguage(text)) return false
  const hasKnow =
    /\b(what\s+i\s+know|i\s+can\s+see|i\s+can\s+tell)\b/i.test(text)
  const hasMissing =
    /\b(what'?s\s+missing|i\s+can'?t\s+(?:tell|say|see|explain|fully)|i\s+don'?t\s+have|i\s+need)\b/i
      .test(text)
  const hasNext =
    /\b(what\s+happens\s+next|once\s+(?:that|those|this)|i'?ll\s+(?:rank|name|walk|give|explain))\b/i
      .test(text)
  return (hasKnow && hasMissing) || (hasMissing && hasNext) || (hasKnow && hasMissing && hasNext)
}

/**
 * QC: incomplete / gap answers must use landlord language, never AI mechanics.
 */
export function evaluateMissingInfoCommunicationQc(input: {
  question: string
  answer: string
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
} {
  const answer = input.answer.trim()
  if (!answer) {
    return { status: "skip", summary: "Empty answer." }
  }

  if (looksLikeAiMechanicsLanguage(answer)) {
    return {
      status: "fail",
      summary:
        "User-facing answer describes AI process (evidence / investigation / retrieval) — rewrite in property language.",
    }
  }

  // Gap-style answers should prefer the 3-part model.
  const looksIncomplete =
    /\b(i\s+can'?t\s+(?:tell|say|see|explain|fully|complete)|i\s+don'?t\s+have|what'?s\s+missing|once\s+that\s+(?:information|history|detail))\b/i
      .test(answer)
  if (looksIncomplete && !looksLikeClearMissingInfoExplanation(answer) && answer.length < 500) {
    return {
      status: "warn",
      summary:
        "Incomplete answer may need clearer What I know / What's missing / What happens next structure.",
    }
  }

  return {
    status: "pass",
    summary: "Missing-info communication uses landlord language (or full answer).",
  }
}

/** Compact per-turn prompt reminder. */
export function missingInfoCommunicationPromptBlock(): string {
  return (
    `MISSING_INFO_VOICE: When you cannot fully answer, use What I know → What's missing → What happens next.\n` +
    `Speak only in property terms. Never mention evidence, investigation pipelines, retrieval, packets, ` +
    `sufficiency scores, or dashboard-metric substitution. Never make the user learn how the AI works.\n`
  )
}
