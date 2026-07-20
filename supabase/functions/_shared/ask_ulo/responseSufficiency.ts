/**
 * Response Sufficiency Score + Evidence Threshold + Generic Response Filter.
 * Ask Ulo must earn the right to answer — never Question → Search → Answer.
 */

import { looksLikeGenericKpiFallback } from "./taskCompletion.ts"
import { hasSubjectMismatch } from "./questionSubjectMatch.ts"
import { requiresInvestigation } from "./investigationDefinition.ts"
import { isStrategicBriefingQuestion } from "./reasoningFirst.ts"
import {
  isComparisonRankingQuestion,
  isDiagnosisQuestion,
  isRecommendationQuestion,
} from "./reasoningMode.ts"

export const RESPONSE_SUFFICIENCY_GUIDE = `
## Response Sufficiency Score (critical — earn the right to answer)

The pipeline is NEVER Question → Search → Answer.
It MUST be:
Question → Understand success → Create hypotheses → Investigate →
Collect evidence → Challenge findings → Determine confidence → Answer

Before a response is shown, score yourself. If the score is too low, reject and keep investigating.

### Step 1 — Understand success (reasoning, not SQL)
Determine what would make the answer complete. Create criteria first.
Example — "Which maintenance requests are becoming emergencies?"
Criteria may include: age, priority, escalations, repeated updates, resident complaints,
water / electrical / gas / HVAC-in-extreme-weather, no vendor assigned, vendor not responding,
exceeded SLA, multiple reopenings, inspection findings, workflow stalled.

### Step 2 — Investigate against those criteria
Do not answer until the relevant evidence dimensions have been checked
(open maintenance, priority, age, vendor response, workflow state, escalations, SLA,
issue category, repeat repairs, resident complaints, photos, inspection notes — as applicable).

### Step 3 — Challenge findings
Ask: Did I actually identify what was requested (e.g. requests becoming emergencies)?
If NO — keep investigating. Do not fill with nearby dashboard metrics.

### Step 4 — Generate findings
Named work orders / units with issue, age, vendor state, risk, and priority —
not "Open maintenance tickets: 25".

### Evidence Threshold (minimum distinct evidence sources / dimensions)
- Simple factual → 1
- Comparison → 2
- Summary → 3
- Recommendation → 4
- Prediction → 5
- Root cause → 6
- Risk assessment → 7

If the threshold is not met, keep investigating or state exactly what evidence is missing.

### Generic Response Filter
If a response leans on phrases like:
Open maintenance / Portfolio health / Confidence / No action needed /
Based on available data / Recent activity / Maintenance summary / Property overview
AND it never actually answers the user's question — the response FAILS.
Incomplete / generic answers must never be shown.
`.trim()

export type EvidenceQuestionKind =
  | "factual"
  | "comparison"
  | "summary"
  | "recommendation"
  | "prediction"
  | "root_cause"
  | "risk_assessment"

export const EVIDENCE_THRESHOLD: Record<EvidenceQuestionKind, number> = {
  factual: 1,
  comparison: 2,
  summary: 3,
  recommendation: 4,
  prediction: 5,
  root_cause: 6,
  risk_assessment: 7,
}

/** Minimum Response Sufficiency Score (0–100) before an answer may be shown. */
export const SUFFICIENCY_SCORE_FLOOR: Record<EvidenceQuestionKind, number> = {
  factual: 35,
  comparison: 50,
  summary: 55,
  recommendation: 60,
  prediction: 65,
  root_cause: 70,
  risk_assessment: 75,
}

const PREDICTION_RE =
  /\b(will|forecast|predict|becoming|over\s+the\s+next|next\s+\d+\s+days|going\s+to|likely\s+to|risk\s+of\s+becoming)\b/i

const RISK_RE =
  /\b(risk|emergenc|expos(?:e|ure)|concern(?:s|ed)?|worried|at[- ]risk|what\s+concerns|damage|liability)\b/i

const SUMMARY_RE =
  /\b(summar(?:y|ize|ise)|catch\s+me\s+up|what\s+happened|recap|rundown|overview|what\s+did\s+i\s+miss)\b/i

/** Evidence dimensions the model can "check" in an investigation answer. */
const EVIDENCE_DIMENSIONS: Array<{ id: string; re: RegExp }> = [
  { id: "named_work_order", re: /\b(WO[- ][A-Za-z0-9]+|work\s*order\s+#?[A-Za-z0-9-]+|ticket\s+#?[A-Za-z0-9-]+)\b/i },
  { id: "named_unit", re: /\b(?:unit|apt\.?|apartment|#)\s*[A-Za-z]?\d{1,5}[A-Za-z]?\b/i },
  { id: "named_property", re: /\b(?:at|in|property)\s+[A-Z][A-Za-z0-9'’&\- ]{2,40}\b/ },
  { id: "priority", re: /\b(priority|critical|emergency|urgent|high[- ]priority|P[0-3])\b/i },
  { id: "age", re: /\b(\d+\s+days?\s+(?:open|waiting|old)|open\s+\d+\s+days?|waiting\s+\d+|aging|stale)\b/i },
  { id: "vendor_response", re: /\b(vendor\s+(?:hasn'?t|has\s+not|not)\s+respond|no\s+vendor|unassigned|cancelled\s+appointment|vendor\s+delay)\b/i },
  { id: "workflow_state", re: /\b(workflow|stalled|stuck|awaiting|escalated\s+column|kanban|stage)\b/i },
  { id: "escalations", re: /\b(escalat(?:e|ed|ion|ions))\b/i },
  { id: "sla", re: /\b(SLA|service[- ]level|exceeded\s+(?:SLA|deadline)|past\s+due|overdue)\b/i },
  { id: "issue_category", re: /\b(plumb|leak|water|electrical|spark|gas|HVAC|heat|cooling|mold|roof|pest)\b/i },
  { id: "repeat_repairs", re: /\b(reopen|repeat|reported\s+(?:again|twice|multiple)|second\s+time|recurring)\b/i },
  { id: "resident_complaints", re: /\b(resident|tenant)\s+(?:report|complaint|called|messaged|follow[- ]?up)/i },
  { id: "inspection", re: /\b(inspection\s+(?:note|finding|report)|photo|photos|image)\b/i },
  { id: "risk_impact", re: /\b(risk|damage\s+spread|property\s+damage|this\s+matters|could\s+cause|worsen)\b/i },
  { id: "action", re: /\b(i(?:'|’)?d |recommend|follow\s+up|reassign|call\s+the\s+vendor|next\s+step)\b/i },
  { id: "missing_honesty", re: /\b(do not have|don't have|missing|unavailable|not enough|need .+ to)\b/i },
]

/** Phrases that mark a generic shell when the question is not actually answered. */
const GENERIC_SHELL_PHRASES_RE =
  /\b(open\s+maintenance|portfolio\s+health|confidence\s*:|no\s+action\s+needed|based\s+on\s+(?:the\s+)?available\s+data|recent\s+activity|maintenance\s+summary|property\s+overview|current\s+kpis?|dashboard\s+metrics?|across\s+(?:your|the)\s+portfolio)\b/i

export type ResponseSufficiencyReport = {
  kind: EvidenceQuestionKind
  evidenceThreshold: number
  evidenceCount: number
  evidenceHits: string[]
  /** 0–100 composite score. */
  score: number
  scoreFloor: number
  meetsEvidenceThreshold: boolean
  meetsScoreFloor: boolean
  genericFilterFailed: boolean
  answersQuestion: boolean
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
}

/**
 * Classify the evidence / investigation intensity for this question.
 */
export function classifyEvidenceQuestionKind(question: string): EvidenceQuestionKind {
  const q = question.trim()
  if (!q) return "factual"

  if (isDiagnosisQuestion(q) || /^\s*why\b/i.test(q) || /\bwhat(?:'s|\s+is)\s+causing\b/i.test(q)) {
    return "root_cause"
  }
  if (
    /\b(becoming\s+(?:an?\s+)?emergenc(?:y|ies)?|risk\s+assessment|what\s+concerns|at[- ]risk)\b/i
      .test(q) ||
    (RISK_RE.test(q) && (requiresInvestigation(q) || PREDICTION_RE.test(q) || /^\s*which\b/i.test(q)))
  ) {
    return "risk_assessment"
  }
  if (PREDICTION_RE.test(q) && (requiresInvestigation(q) || RISK_RE.test(q) || isStrategicBriefingQuestion(q))) {
    return "prediction"
  }
  if (isRecommendationQuestion(q) || /\bwhat\s+should\b|\bhow\s+can\s+i\s+improve\b/i.test(q)) {
    return "recommendation"
  }
  if (isComparisonRankingQuestion(q) || /^\s*which\b/i.test(q)) {
    return "comparison"
  }
  if (SUMMARY_RE.test(q) || isStrategicBriefingQuestion(q)) {
    return "summary"
  }
  return "factual"
}

/**
 * Count distinct evidence dimensions present in the draft answer.
 */
export function collectEvidenceHits(answer: string): string[] {
  const text = answer.trim()
  if (!text) return []
  const hits: string[] = []
  for (const dim of EVIDENCE_DIMENSIONS) {
    if (dim.re.test(text)) hits.push(dim.id)
  }
  return hits
}

/**
 * True when the answer appears to address the user's ask (not just nearby stats).
 */
export function answerAppearsToAddressQuestion(question: string, answer: string): boolean {
  const q = question.trim().toLowerCase()
  const a = answer.trim()
  if (!q || !a) return false

  // Honest missing-evidence statements still address the ask.
  if (/\b(do not have|don't have|missing|unavailable|not enough)\b/i.test(a)) {
    // Still reject when the gap language is about the wrong subject entirely.
    if (hasSubjectMismatch(question, a)) return false
    return true
  }

  // Hard fail: answered a different entity type (vendors → property ranking, etc.).
  if (hasSubjectMismatch(question, a)) return false

  // Comparison / which → need ranked / named entities
  if (/^\s*which\b|becoming\s+(?:an?\s+)?emergenc|needs?\s+(?:my\s+)?attention/i.test(q)) {
    if (/\b(?:unit|apt|#)\s*[A-Za-z]?\d|WO[- ]|work\s*order|1\.|first|top\b/i.test(a)) return true
    if (/\b(none|no\s+(?:requests?|tickets?|work\s*orders?)\s+(?:are|look)|did not find|couldn't find)\b/i.test(a)) {
      return true
    }
    return false
  }

  if (/^\s*why\b|what(?:'s|\s+is)\s+causing/i.test(q)) {
    return /\b(because|driven by|root cause|this matters|caused by|due to)\b/i.test(a)
  }

  if (/\bwhat\s+should|how\s+can\s+i\s+improve|recommend/i.test(q)) {
    return /\b(i(?:'|’)?d |recommend|should|next\s+step|prioriti[sz]e|focus\s+on)\b/i.test(a)
  }

  // Default: reject pure KPI shells
  if (looksLikeGenericKpiFallback(a)) return false
  return a.length >= 40
}

/**
 * Generic Response Filter — shell phrases without answering the question → fail.
 */
export function failsGenericResponseFilter(question: string, answer: string): boolean {
  const text = answer.trim()
  if (!text) return true
  if (!GENERIC_SHELL_PHRASES_RE.test(text) && !looksLikeGenericKpiFallback(text)) {
    return false
  }
  // Shell language is OK only when the question is clearly answered.
  return !answerAppearsToAddressQuestion(question, text)
}

/**
 * Compute Response Sufficiency Score (0–100).
 */
export function computeResponseSufficiencyScore(input: {
  evidenceCount: number
  evidenceThreshold: number
  answersQuestion: boolean
  genericFilterFailed: boolean
  packetSatisfied?: boolean
}): number {
  let score = 0

  // Evidence coverage vs threshold (up to 55 pts)
  const ratio =
    input.evidenceThreshold <= 0
      ? 1
      : Math.min(1, input.evidenceCount / input.evidenceThreshold)
  score += Math.round(ratio * 55)

  // Directly answers the question (25 pts)
  if (input.answersQuestion) score += 25

  // Dedicated investigation packet available (15 pts)
  if (input.packetSatisfied) score += 15

  // Extra evidence beyond threshold (up to 5 pts)
  if (input.evidenceCount > input.evidenceThreshold) {
    score += Math.min(5, input.evidenceCount - input.evidenceThreshold)
  }

  if (input.genericFilterFailed) score = Math.min(score, 25)
  if (!input.answersQuestion) score = Math.min(score, 45)

  return Math.max(0, Math.min(100, score))
}

/**
 * Full sufficiency evaluation — gate before showing an answer.
 */
export function evaluateResponseSufficiency(input: {
  question: string
  answer: string
  /** Dedicated ranking / briefing / entity / period packet already answers. */
  packetSatisfied?: boolean
}): ResponseSufficiencyReport {
  const question = input.question.trim()
  const answer = input.answer.trim()
  const kind = classifyEvidenceQuestionKind(question)
  const evidenceThreshold = EVIDENCE_THRESHOLD[kind]
  const scoreFloor = SUFFICIENCY_SCORE_FLOOR[kind]

  // Narrow factual asks without investigation language skip the heavy gate.
  if (
    kind === "factual" &&
    !requiresInvestigation(question) &&
    !isComparisonRankingQuestion(question) &&
    !isStrategicBriefingQuestion(question)
  ) {
    const hits = collectEvidenceHits(answer)
    const answersQuestion = answerAppearsToAddressQuestion(question, answer) || answer.length >= 20
    const genericFilterFailed = failsGenericResponseFilter(question, answer)
    const score = computeResponseSufficiencyScore({
      evidenceCount: Math.max(hits.length, answersQuestion ? 1 : 0),
      evidenceThreshold,
      answersQuestion,
      genericFilterFailed,
      packetSatisfied: input.packetSatisfied,
    })
    if (genericFilterFailed && looksLikeGenericKpiFallback(answer)) {
      return {
        kind,
        evidenceThreshold,
        evidenceCount: hits.length,
        evidenceHits: hits,
        score,
        scoreFloor,
        meetsEvidenceThreshold: hits.length >= evidenceThreshold,
        meetsScoreFloor: score >= scoreFloor,
        genericFilterFailed: true,
        answersQuestion: false,
        status: "fail",
        summary: "Generic response filter failed — nearby KPIs without answering the question.",
      }
    }
    return {
      kind,
      evidenceThreshold,
      evidenceCount: Math.max(hits.length, 1),
      evidenceHits: hits,
      score: Math.max(score, scoreFloor),
      scoreFloor,
      meetsEvidenceThreshold: true,
      meetsScoreFloor: true,
      genericFilterFailed: false,
      answersQuestion,
      status: "pass",
      summary: "Factual answer — light sufficiency check passed.",
    }
  }

  if (!answer) {
    return {
      kind,
      evidenceThreshold,
      evidenceCount: 0,
      evidenceHits: [],
      score: 0,
      scoreFloor,
      meetsEvidenceThreshold: false,
      meetsScoreFloor: false,
      genericFilterFailed: true,
      answersQuestion: false,
      status: "fail",
      summary: "Empty answer — insufficient evidence; do not show.",
    }
  }

  if (input.packetSatisfied && !failsGenericResponseFilter(question, answer)) {
    const hits = collectEvidenceHits(answer)
    const evidenceCount = Math.max(hits.length, evidenceThreshold)
    const score = computeResponseSufficiencyScore({
      evidenceCount,
      evidenceThreshold,
      answersQuestion: true,
      genericFilterFailed: false,
      packetSatisfied: true,
    })
    return {
      kind,
      evidenceThreshold,
      evidenceCount,
      evidenceHits: hits,
      score,
      scoreFloor,
      meetsEvidenceThreshold: true,
      meetsScoreFloor: score >= scoreFloor,
      genericFilterFailed: false,
      answersQuestion: true,
      status: "pass",
      summary: `Investigation packet satisfied evidence threshold for ${kind} (min ${evidenceThreshold}).`,
    }
  }

  const evidenceHits = collectEvidenceHits(answer)
  const evidenceCount = evidenceHits.length
  const answersQuestion = answerAppearsToAddressQuestion(question, answer)
  const genericFilterFailed = failsGenericResponseFilter(question, answer)
  const meetsEvidenceThreshold = evidenceCount >= evidenceThreshold
  const score = computeResponseSufficiencyScore({
    evidenceCount,
    evidenceThreshold,
    answersQuestion,
    genericFilterFailed,
    packetSatisfied: input.packetSatisfied,
  })
  const meetsScoreFloor = score >= scoreFloor

  if (genericFilterFailed) {
    return {
      kind,
      evidenceThreshold,
      evidenceCount,
      evidenceHits,
      score,
      scoreFloor,
      meetsEvidenceThreshold,
      meetsScoreFloor,
      genericFilterFailed: true,
      answersQuestion,
      status: "fail",
      summary:
        "Generic Response Filter failed: shell phrases (open maintenance / portfolio health / …) without answering the question.",
    }
  }

  // Honest missing-evidence statements earn the right to report a gap.
  if (evidenceHits.includes("missing_honesty") && answersQuestion && !looksLikeGenericKpiFallback(answer)) {
    return {
      kind,
      evidenceThreshold,
      evidenceCount,
      evidenceHits,
      score: Math.max(score, scoreFloor),
      scoreFloor,
      meetsEvidenceThreshold: true,
      meetsScoreFloor: true,
      genericFilterFailed: false,
      answersQuestion: true,
      status: "pass",
      summary: "States missing evidence instead of shipping an underspecified answer.",
    }
  }

  if (!meetsEvidenceThreshold || !meetsScoreFloor || !answersQuestion) {
    return {
      kind,
      evidenceThreshold,
      evidenceCount,
      evidenceHits,
      score,
      scoreFloor,
      meetsEvidenceThreshold,
      meetsScoreFloor,
      genericFilterFailed: false,
      answersQuestion,
      status: "fail",
      summary:
        `Response Sufficiency too low for ${kind}: score ${score}/${scoreFloor}, ` +
        `evidence ${evidenceCount}/${evidenceThreshold}` +
        (answersQuestion ? "." : " — question not answered.") +
        " Keep investigating or state missing evidence.",
    }
  }

  return {
    kind,
    evidenceThreshold,
    evidenceCount,
    evidenceHits,
    score,
    scoreFloor,
    meetsEvidenceThreshold,
    meetsScoreFloor,
    genericFilterFailed: false,
    answersQuestion,
    status: "pass",
    summary:
      `Response Sufficiency ${score}/100 for ${kind} ` +
      `(evidence ${evidenceCount}/${evidenceThreshold}).`,
  }
}

/** QC wrapper matching other Ask Ulo quality checks. */
export function evaluateResponseSufficiencyQc(input: {
  question: string
  answer: string
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  report: ResponseSufficiencyReport
} {
  const report = evaluateResponseSufficiency(input)
  return { status: report.status, summary: report.summary, report }
}

/** Per-turn prompt block so the model plans criteria + meets evidence threshold. */
export function responseSufficiencyPromptBlock(question: string): string {
  const q = question.trim()
  if (!q) return ""
  const kind = classifyEvidenceQuestionKind(q)
  const threshold = EVIDENCE_THRESHOLD[kind]
  const floor = SUFFICIENCY_SCORE_FLOOR[kind]
  return (
    `RESPONSE_SUFFICIENCY: earn the right to answer.\n` +
    `pipeline: understand_success → hypotheses → investigate → evidence → challenge → confidence → answer\n` +
    `question_kind: ${kind}\n` +
    `evidence_threshold: ${threshold} distinct evidence dimensions/sources (min)\n` +
    `sufficiency_score_floor: ${floor}/100\n` +
    `FORBIDDEN: generic shells ("Open maintenance", "Portfolio health", "Based on available data", ` +
    `"Recent activity", "Maintenance summary", "Property overview", "No action needed", "Confidence") ` +
    `that never answer the question.\n` +
    `REQUIRED: criteria-first reasoning (internal), then landlord-facing findings naming specific requests/units — ` +
    `or What I know / What's missing / What happens next in property terms. ` +
    `Never say evidence, sufficiency score, or investigation mechanics to the user. Low sufficiency → do not ship.\n`
  )
}
