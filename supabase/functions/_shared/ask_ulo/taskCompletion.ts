/**
 * Task Completion Contract for Ask Ulo.
 * Overrides response templates: a reply is complete only if it satisfies the user's task.
 * Ask Ulo investigates — it does not stop at the first matching metric.
 */

import { isVendorBestQuestion, isVendorCompletionQuestion, isVendorRecommendQuestion } from "./questionMetricContext.ts"
import {
  isVendorInactivityQuestion,
  isVendorOverloadQuestion,
  isVendorRankingQuestion,
  isVendorResponseSpeedQuestion,
} from "./questionSubjectMatch.ts"
import { isVendorVerificationStatusQuestion } from "./vendorVerificationStatusLookup.ts"

export type TaskSubject =
  | "work_order"
  | "unit"
  | "property"
  | "portfolio"
  | "period"
  | "vendor"
  | "lease"
  | "risk"
  | "other"

export type TaskAction =
  | "rank_oldest"
  | "rank_highest"
  | "rank_lowest"
  | "summarize"
  | "compare"
  | "predict"
  | "recommend"
  | "assess_risk"
  | "count"
  | "explain"
  | "other"

export type TaskContract = {
  subject: TaskSubject
  action: TaskAction
  /** What success looks like in one line. */
  expectedOutput: string
  /** Short investigation checklist for prompts / logs. */
  investigationPlan: string[]
  /** True when portfolio open-ticket totals / health KPIs are forbidden as the answer. */
  rejectsGenericKpis: boolean
  /** Oldest unresolved work-order ranking. */
  isOldestWaitingWorkOrder: boolean
  confidence: "high" | "medium" | "low"
}

export const TASK_COMPLETION_CONTRACT = `
## Task Completion Contract (OVERRIDES all response templates)

A response is only complete if it satisfies the user's requested task.
Do not substitute nearby metrics, dashboard cards, KPIs, or generic summaries
when the requested information cannot be found.
Instead, continue using the packets — or explain precisely what data is missing.

### Investigator loop (required)
Question → Understand what success looks like → Investigation checklist →
Gather evidence from packets → Cross-check → Confirm task completed → Generate response.
Never: Question → Find first matching data → Answer.

### Step 1 — Extract intent
Identify: primary subject, requested action/metric, expected output.
Example — "Which work order has been waiting the longest?"
- Subject: work order
- Metric: oldest waiting duration
- Output: the single oldest unresolved work order (not portfolio maintenance count)

### Step 2 — Investigation plan
Determine which evidence must be examined before answering.
For oldest-waiting work order: unresolved WOs → waiting duration → sort oldest first →
return ticket ID, property, unit, issue, status, days waiting, vendor, why still waiting.

### Step 3 — Verify before responding
Ask internally:
- Did I answer the same entity?
- Did I answer the requested metric?
- Did I complete the requested task?
If any answer is NO, do not respond with a substitute — revise using packets or state what is missing.

### Step 4 — Detect invalid generic fallbacks
These are INVALID when they do not answer the user's request:
- Open maintenance count alone
- Property Health score alone
- Portfolio summary / Current KPIs / Confidence sections / Dashboard metrics
- Generic recommendations that ignore the asked entity/metric
If any of these appear without directly answering the question, discard and rewrite.

### Step 5 — Dynamic structure
Ranking → rankings. Summary → summary. Comparison → comparison.
Prediction → forecast. Recommendation → recommendations. Timeline → timeline.
Never force one layout.

### Step 6 — Use all relevant packet domains
Continue until every relevant packet for the task has been considered
(maintenance, workflows, property, vendor, resident, lease, finance, compliance, documents, external).
Do not stop after one related metric.

### Step 7 — Final completion check
If the user read only my first paragraph, would they believe I completed the task they requested?
If not, rewrite.
`.trim()

const OLDEST_WAITING_WO_RE =
  /\b((?:which|what)\s+(?:work\s*order|ticket|maintenance\s+request|repair\s+request)\s+(?:has\s+been\s+)?(?:waiting|open|aging|outstanding)\s+(?:the\s+)?(?:longest|most)|(?:oldest|longest[- ]waiting|most[- ]aged)\s+(?:open\s+)?(?:work\s*order|ticket|maintenance\s+request)|work\s*order\s+(?:waiting|open)\s+(?:the\s+)?longest|which\s+(?:open\s+)?(?:work\s*order|ticket)\s+is\s+(?:the\s+)?(?:oldest|longest))\b/i

const GENERIC_OPEN_COUNT_LEAD_RE =
  /^\s*(?:#{1,3}\s*)?(?:quick\s+answer\s*\n+)?(?:you\s+(?:currently\s+)?have\s+)?(?:\*\*)?\d+(?:\*\*)?\s+open\s+(?:maintenance\s+)?(?:work\s*orders?|tickets?|requests?)\b/im

const GENERIC_HEALTH_LEAD_RE =
  /^\s*(?:#{1,3}\s*)?(?:portfolio\s+)?(?:property\s+)?health(?:\s+score)?\b/im

const GENERIC_KPI_ONLY_RE =
  /\b(open\s+maintenance\s+tickets?:\s*\d+|open\s+work\s+orders?:\s*\d+|health\s+score:\s*\d+)\b/i

/**
 * Detect the canonical "oldest waiting work order" investigation.
 */
export function isOldestWaitingWorkOrderQuestion(question: string): boolean {
  return OLDEST_WAITING_WO_RE.test(question.trim())
}

/**
 * Classify the user's task for investigation + verification.
 */
export function classifyTaskContract(question: string): TaskContract {
  const q = question.trim()
  if (!q) {
    return {
      subject: "other",
      action: "other",
      expectedOutput: "Clarify the question",
      investigationPlan: ["Ask what they need"],
      rejectsGenericKpis: false,
      isOldestWaitingWorkOrder: false,
      confidence: "low",
    }
  }

  if (isOldestWaitingWorkOrderQuestion(q)) {
    return {
      subject: "work_order",
      action: "rank_oldest",
      expectedOutput:
        "Single oldest unresolved work order with property, unit, issue, days waiting, vendor, status, and why it is still open",
      investigationPlan: [
        "Retrieve unresolved work orders",
        "Compute waiting duration from created/assigned date",
        "Sort oldest to newest",
        "Return the oldest with ticket, property, unit, issue, status, days waiting, vendor, reason, recommended action",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: true,
      confidence: "high",
    }
  }

  if (isVendorInactivityQuestion(q)) {
    return {
      subject: "vendor",
      action: "other",
      expectedOutput:
        "List of vendors with pending accepts or no recent accepts — never a portfolio health briefing",
      investigationPlan: [
        "Load active vendors and pending_accept assignments",
        "Flag vendors with pending accepts or zero accepted jobs",
        "Return vendor names and why they're flagged — never health scores or property hotspots",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorVerificationStatusQuestion(q)) {
    return {
      subject: "vendor",
      action: "other",
      expectedOutput:
        "Vendor verification + capacity status from vendor_verifications (same as profile chips) — never portfolio briefing",
      investigationPlan: [
        "Load vendors and vendor_verifications for the landlord",
        "Map each vendor to verification pill + capacity chip (Pending until verified)",
        "Include checklist complete/required counts and missing items when useful",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorOverloadQuestion(q)) {
    return {
      subject: "vendor",
      action: "rank_highest",
      expectedOutput:
        "Vendors ranked by open assigned jobs (overloaded / busiest) — never overall best/score",
      investigationPlan: [
        "Count open assigned maintenance_requests per vendor (pending_accept, accepted, in_progress)",
        "Rank highest open load first",
        "Recommend pausing new work for the busiest vendors — never vendor_score ranking",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorResponseSpeedQuestion(q)) {
    return {
      subject: "vendor",
      action: "rank_highest",
      expectedOutput:
        "Ranked vendors by response speed (avg minutes notify→accept/decline) — never a property priority card",
      investigationPlan: [
        "Load vendor scores for the landlord",
        "Rank by avg_response_time ascending (then response_speed_score)",
        "Return fastest vendors with times — never substitute property attention ranking",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorCompletionQuestion(q)) {
    return {
      subject: "vendor",
      action: "rank_highest",
      expectedOutput:
        "Ranked vendors by completion rate — never a property priority card or response-speed-only ranking",
      investigationPlan: [
        "Load vendor scores for the landlord",
        "Rank by completion_rate descending",
        "Return the highest-completion vendor with rate and sample size — never property attention ranking",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorRecommendQuestion(q)) {
    return {
      subject: "vendor",
      action: "rank_highest",
      expectedOutput:
        "Named alternative vendor for the asked trade — never a portfolio gap answer or response-speed-only ranking",
      investigationPlan: [
        "Infer trade from the question when present",
        "Load vendor scores for the landlord",
        "Filter to matching trade and rank by vendor_score",
        "Recommend the strongest alternative — never substitute portfolio totals",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (isVendorBestQuestion(q) || isVendorRankingQuestion(q)) {
    return {
      subject: "vendor",
      action: "rank_highest",
      expectedOutput:
        "Ranked vendors by overall vendor score for the asked trade — never response-speed-only or a property priority card",
      investigationPlan: [
        "Infer trade from the question when present",
        "Load vendor scores for the landlord",
        "Filter to matching trade and rank by vendor_score (satisfaction, completion, response, rework)",
        "Say what “best” means — never collapse to timed responses alone",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (
    /\b(which\s+units?|units?\s+with\s+the\s+(?:most|highest)|most\s+maintenance\s+(?:requests?|tickets?))\b/i
      .test(q)
  ) {
    return {
      subject: "unit",
      action: "rank_highest",
      expectedOutput: "Ranked list of units by maintenance request volume",
      investigationPlan: [
        "Scope requests to the analysis window",
        "Group by unit",
        "Rank highest to lowest",
        "Return top units with counts — never portfolio open-ticket total alone",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (
    /\b(summar(?:y|ize)|this\s+week|this\s+month|catch\s+me\s+up|what\s+happened)\b/i.test(q) &&
    !/\bhow\s+many\b/i.test(q)
  ) {
    return {
      subject: "period",
      action: "summarize",
      expectedOutput: "Narrative summary of period events across relevant domains",
      investigationPlan: [
        "Review period events (maintenance, workflows, leasing, rent signals)",
        "Synthesize a narrative — never open-ticket count alone",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "medium",
    }
  }

  if (
    /\b(what\s+should\s+i\s+(?:be\s+)?worr(?:y|ied)\s+about|what\s+am\s+i\s+missing|next\s+30\s+days|what\s+should\s+i\s+prioriti[sz]e)\b/i
      .test(q)
  ) {
    return {
      subject: "risk",
      action: "assess_risk",
      expectedOutput:
        "Prioritized operational risk assessment across maintenance, leases, rent, inspections, vendors, compliance, finances, deadlines",
      investigationPlan: [
        "Review maintenance, workflows, leases, rent, inspections, vendors, compliance, finances",
        "Rank risks and recommend actions",
        "Never answer with open-ticket count alone",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (/\b(which\s+(?:property|building)|needs?\s+(?:my\s+)?attention\s+first|performing\s+the\s+worst)\b/i.test(q)) {
    return {
      subject: "property",
      action: "rank_highest",
      expectedOutput: "Ranked properties with reasons — not portfolio totals alone",
      investigationPlan: [
        "Compare properties on open/critical/aging work, escalations, health",
        "Return ranked list with why",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  if (/\b(how\s+many|count\s+of|number\s+of)\b.+\b(open|work\s*orders?|tickets?)\b/i.test(q)) {
    return {
      subject: "work_order",
      action: "count",
      expectedOutput: "Open work-order count (factual)",
      investigationPlan: ["Count unresolved work orders in scope"],
      rejectsGenericKpis: false,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  // Why / Which / What should / What am I missing / How can I improve → never answer with one KPI.
  if (
    /\b(why\b|which\b|what\s+should\b|what(?:'s|\s+is)\s+causing\b|what(?:'s|\s+is)\s+becoming\b|what(?:'s|\s+is)\s+changing\b|what\s+concerns\b|what\s+am\s+i\s+missing\b|how\s+can\s+i\s+improve\b)/i
      .test(q)
  ) {
    return {
      subject: "other",
      action: "explain",
      expectedOutput:
        "Evidence-backed investigation with ranked findings, impact, and recommended actions — never a single dashboard metric",
      investigationPlan: [
        "Understand the objective",
        "Gather evidence across relevant packets",
        "Rank findings and explain why they matter",
        "Recommend actions — or state exact missing evidence",
      ],
      rejectsGenericKpis: true,
      isOldestWaitingWorkOrder: false,
      confidence: "high",
    }
  }

  return {
    subject: "other",
    action: "other",
    expectedOutput: "Complete the user's stated task using relevant packets",
    investigationPlan: [
      "Identify subject and metric",
      "Gather evidence from all relevant packets",
      "Verify the first paragraph completes the task",
    ],
    rejectsGenericKpis: false,
    isOldestWaitingWorkOrder: false,
    confidence: "low",
  }
}

/**
 * True when draft text looks like a forbidden generic KPI substitute
 * for a task that requires a specific deliverable.
 */
export function looksLikeGenericKpiFallback(answer: string): boolean {
  const text = answer.trim()
  if (!text) return true
  if (GENERIC_OPEN_COUNT_LEAD_RE.test(text)) return true
  if (GENERIC_HEALTH_LEAD_RE.test(text)) return true
  // Short answers that are only a KPI line
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^#{1,3}\s/.test(l) && !/^[-*]\s*$/.test(l))
  if (lines.length <= 3 && GENERIC_KPI_ONLY_RE.test(text) && !/\b(unit|property|work\s*order\s*#|waiting\s+\d+\s+days)\b/i.test(text)) {
    return true
  }
  return false
}

/**
 * Task-completion QC for a draft answer.
 * Returns fail when the draft is a generic substitute for a specific task.
 */
export function evaluateTaskCompletionQc(input: {
  question: string
  answer: string
  /** When true, a dedicated packet already answered the task. */
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  contract: TaskContract
} {
  const contract = classifyTaskContract(input.question)
  if (!contract.rejectsGenericKpis) {
    return {
      status: "skip",
      summary: "Task allows factual KPI answers when that is the request.",
      contract,
    }
  }

  if (input.packetSatisfied) {
    return {
      status: "pass",
      summary: `Task packet available for ${contract.subject}/${contract.action}.`,
      contract,
    }
  }

  const answer = input.answer.trim()
  if (!answer) {
    return {
      status: "fail",
      summary: "Empty answer — task not completed.",
      contract,
    }
  }

  // Honest missing-data explanations are valid.
  if (
    /\b(do not have|don't have|could not|couldn't|missing|unavailable|not enough data|need .+ to)\b/i
      .test(answer) &&
    !looksLikeGenericKpiFallback(answer)
  ) {
    return {
      status: "pass",
      summary: "Answer states missing data instead of substituting KPIs.",
      contract,
    }
  }

  if (looksLikeGenericKpiFallback(answer)) {
    return {
      status: "fail",
      summary:
        "Draft substitutes open-ticket / health / portfolio KPIs instead of completing the requested task.",
      contract,
    }
  }

  if (contract.isOldestWaitingWorkOrder) {
    const hasEntity =
      /\b(work\s*order|ticket|#|WO-|has been waiting|waiting\s+\d+|days?\s+waiting|oldest)\b/i.test(
        answer,
      )
    if (!hasEntity) {
      return {
        status: "fail",
        summary:
          "Oldest-waiting work-order question answered without identifying a specific work order or stating missing data.",
        contract,
      }
    }
  }

  return {
    status: "pass",
    summary: `Answer appears to address ${contract.subject} / ${contract.action}.`,
    contract,
  }
}

/** Prompt block describing the classified task for this turn. */
export function taskContractPromptBlock(question: string): string {
  const c = classifyTaskContract(question)
  return (
    `TASK_CONTRACT:\n` +
    `subject=${c.subject}; action=${c.action}; confidence=${c.confidence}\n` +
    `expected_output: ${c.expectedOutput}\n` +
    `investigation_plan:\n${c.investigationPlan.map((s) => `- ${s}`).join("\n")}\n` +
    (c.rejectsGenericKpis
      ? "FORBIDDEN: answering with open maintenance count, health score, or generic portfolio KPIs alone.\n"
      : "")
  )
}
