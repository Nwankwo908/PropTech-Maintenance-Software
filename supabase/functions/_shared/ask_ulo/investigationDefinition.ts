/**
 * Ask Ulo Definition of Investigation.
 * Analytical / investigative / predictive / diagnostic / recommendation questions
 * must never be answered with a single dashboard metric.
 */

import { looksLikeGenericKpiFallback } from "./taskCompletion.ts"

export const INVESTIGATION_DEFINITION_GUIDE = `
## Definition of Investigation (critical — OVERRIDES single-metric answers)

Ask Ulo is prohibited from answering analytical, investigative, predictive,
diagnostic, or recommendation questions using a single dashboard metric.

Questions beginning with (or whose core ask is):
- Why
- Which
- What should
- What's causing / What’s causing
- What's becoming / What’s becoming
- What's changing / What’s changing
- What concerns
- What am I missing
- How can I improve

must trigger an investigation.

### An investigation consists of
1. Understanding the user's objective
2. Building an investigation plan
3. Gathering evidence from all relevant systems / packets
4. Finding relationships between evidence
5. Ranking findings
6. Explaining why they matter
7. Recommending actions

### Missing evidence
If you cannot produce evidence-backed findings, state exactly which evidence is missing.
Never substitute unrelated dashboard metrics.

### Incomplete tasks
Returning nearby statistics is an incomplete task.
An incomplete task must never be shown to the user.
Rewrite using packets, or say what is unavailable — do not ship a KPI substitute.
`.trim()

/** Phrases that force an investigation (not a single-metric glance). */
const INVESTIGATION_TRIGGER_RE =
  /^\s*(?:#{1,3}\s*)?(?:hey[, ]+|hi[, ]+|ulo[, ]+|please\s+)?(?:why|which|what\s+should|what(?:'s|\s+is)\s+causing|what(?:'s|\s+is)\s+becoming|what(?:'s|\s+is)\s+changing|what\s+concerns|what\s+am\s+i\s+missing|how\s+can\s+i\s+improve)\b/i

/**
 * Pure count / lookup asks that may answer with a number
 * even if they contain "which" in other senses (rare).
 */
const FACTUAL_COUNT_RE =
  /^\s*(?:how\s+many|what(?:'s|\s+is)\s+(?:the\s+)?(?:count|total|number)|count\s+(?:of\s+)?(?:my\s+)?|do\s+i\s+have\s+\d*)\b/i

export type InvestigationPlan = {
  requiresInvestigation: boolean
  trigger: string | null
  objective: string
  investigationSteps: string[]
  forbidsSingleMetric: boolean
  confidence: "high" | "medium" | "low"
}

const DEFAULT_STEPS = [
  "Understand the user's objective",
  "Build an investigation plan from available packets",
  "Gather evidence from all relevant systems",
  "Find relationships between evidence",
  "Rank findings by risk / impact",
  "Explain why each finding matters",
  "Recommend clear next actions",
]

function detectTrigger(question: string): string | null {
  const q = question.trim()
  if (!q) return null
  if (
    FACTUAL_COUNT_RE.test(q) &&
    !/\b(why|what\s+should|what\s+am\s+i\s+missing|how\s+can\s+i\s+improve)\b/i.test(q)
  ) {
    return null
  }
  if (/\bwhat\s+am\s+i\s+missing\b/i.test(q)) return "what am i missing"
  if (/\bhow\s+can\s+i\s+improve\b/i.test(q)) return "how can i improve"
  if (/\bwhat\s+should\b/i.test(q)) return "what should"
  if (/\bwhat(?:'s|\s+is)\s+causing\b/i.test(q)) return "what's causing"
  if (/\bwhat(?:'s|\s+is)\s+becoming\b/i.test(q)) return "what's becoming"
  if (/\bwhat(?:'s|\s+is)\s+changing\b/i.test(q)) return "what's changing"
  if (/\bwhat\s+concerns\b/i.test(q)) return "what concerns"
  if (/^\s*why\b/i.test(q) || /\bwhy\s+(?:is|are|has|have|did|does|hasn't|haven't|won't|cant|can't)\b/i.test(q)) {
    return "why"
  }
  if (/^\s*which\b/i.test(q)) return "which"
  if (INVESTIGATION_TRIGGER_RE.test(q)) {
    const m = q.match(INVESTIGATION_TRIGGER_RE)
    return (m?.[0] ?? "investigation").trim().toLowerCase().slice(0, 40)
  }
  return null
}

/**
 * True when this question must run as a full investigation
 * (never a single dashboard metric).
 */
export function requiresInvestigation(question: string): boolean {
  return classifyInvestigation(question).requiresInvestigation
}

/**
 * Classify whether / how this turn must investigate.
 */
export function classifyInvestigation(question: string): InvestigationPlan {
  const q = question.trim()
  if (!q) {
    return {
      requiresInvestigation: false,
      trigger: null,
      objective: "",
      investigationSteps: [],
      forbidsSingleMetric: false,
      confidence: "low",
    }
  }

  const trigger = detectTrigger(q)
  if (!trigger) {
    return {
      requiresInvestigation: false,
      trigger: null,
      objective: "",
      investigationSteps: [],
      forbidsSingleMetric: false,
      confidence: "low",
    }
  }

  return {
    requiresInvestigation: true,
    trigger,
    objective: `Complete an evidence-backed investigation for: ${q.slice(0, 200)}`,
    investigationSteps: DEFAULT_STEPS,
    forbidsSingleMetric: true,
    confidence: "high",
  }
}

/**
 * Answers that look like a single dashboard metric with little/no analysis.
 */
export function looksLikeSingleMetricInvestigationFailure(answer: string): boolean {
  if (looksLikeGenericKpiFallback(answer)) return true
  const text = answer.trim()
  if (!text) return true

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^#{1,3}\s/.test(l))

  // Short KPI-only responses
  if (
    lines.length <= 4 &&
    /\b(\d+\s+open\s+(?:maintenance\s+)?(?:work\s*orders?|tickets?)|health\s+score|portfolio\s+(?:summary|totals?)|current\s+kpis?)\b/i
      .test(text) &&
    !/\b(because|this matters|i(?:'|’)?d|recommend|root cause|driven by|risk|watch|priority|missing)\b/i
      .test(text)
  ) {
    return true
  }

  // Nearby-stats only — no why / action
  if (
    /\b(across\s+(?:your|the)\s+portfolio|open\s+maintenance\s+tickets?:\s*\d+|you\s+currently\s+have\s+\d+)\b/i
      .test(text) &&
    !/\b(because|this matters|i(?:'|’)?d |recommend|root cause|what's missing|what is missing|findings)\b/i
      .test(text)
  ) {
    return true
  }

  return false
}

/**
 * QC: investigation questions must not ship incomplete single-metric answers.
 */
export function evaluateInvestigationDefinitionQc(input: {
  question: string
  answer: string
  /** Dedicated investigation packet already answers (ranking / briefing / entity / period). */
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  plan: InvestigationPlan
} {
  const plan = classifyInvestigation(input.question)
  if (!plan.requiresInvestigation) {
    return {
      status: "skip",
      summary: "Not an investigation-trigger question.",
      plan,
    }
  }

  if (input.packetSatisfied) {
    return {
      status: "pass",
      summary: `Investigation packet available (trigger: ${plan.trigger}).`,
      plan,
    }
  }

  const answer = input.answer.trim()
  if (!answer) {
    return {
      status: "fail",
      summary: "Empty answer — incomplete investigation must not be shown.",
      plan,
    }
  }

  // Honest missing-info statements (landlord language) are complete enough to show.
  if (
    (/\b(do not have|don't have|could not|couldn't|missing|unavailable|not enough|need .+ to|what(?:'s| is) missing|what\s+i\s+know|what\s+happens\s+next|i\s+can'?t\s+(?:tell|say|see|explain))\b/i
      .test(answer) &&
      !looksLikeSingleMetricInvestigationFailure(answer))
  ) {
    return {
      status: "pass",
      summary: "Answer states what's missing in plain language instead of substituting a dashboard metric.",
      plan,
    }
  }

  if (looksLikeSingleMetricInvestigationFailure(answer)) {
    return {
      status: "fail",
      summary:
        "Incomplete investigation: substituted a single dashboard metric / nearby statistics for an analytical question.",
      plan,
    }
  }

  // Prefer answers that show at least one investigation signal.
  const hasInvestigationSignal =
    /\b(because|this matters|risk|priority|i(?:'|’)?d |recommend|driven by|findings|evidence|watch|miss(?:ing)?|root cause)\b/i
      .test(answer)
  if (!hasInvestigationSignal && answer.length < 280) {
    return {
      status: "warn",
      summary:
        "Investigation answer may lack ranked findings, impact, or recommended actions.",
      plan,
    }
  }

  return {
    status: "pass",
    summary: `Investigation answer appears evidence-backed (trigger: ${plan.trigger}).`,
    plan,
  }
}

/** Per-turn prompt block for investigation definition. */
export function investigationDefinitionPromptBlock(question: string): string {
  const plan = classifyInvestigation(question)
  if (!plan.requiresInvestigation) return ""
  return (
    `INVESTIGATION_REQUIRED: true\n` +
    `trigger: ${plan.trigger}\n` +
    `objective: ${plan.objective}\n` +
    `steps:\n${plan.investigationSteps.map((s) => `- ${s}`).join("\n")}\n` +
    `FORBIDDEN: answering with a single dashboard metric, nearby portfolio totals, ` +
    `health scores alone, or unrelated KPIs.\n` +
    `REQUIRED: evidence-backed findings + why they matter + recommended actions — ` +
    `OR a landlord-facing gap explanation (What I know / What's missing / What happens next). ` +
    `Never mention evidence, investigation pipelines, or AI process. Incomplete tasks must never be shown.\n`
  )
}
