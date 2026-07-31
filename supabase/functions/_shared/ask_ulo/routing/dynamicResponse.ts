/**
 * Dynamic response formatting for Ask Ulo.
 * Choose format from the request — never force a universal template.
 */

export type AskUloResponseFormat =
  | "summary"
  | "ranking"
  | "comparison"
  | "calculation"
  | "explanation"
  | "legal"
  | "maintenance_diagnosis"
  | "recommendation"
  | "executive_briefing"
  | "short_factual"
  | "adaptive"

const SUMMARY_RE =
  /\b((?:give\s+me\s+(?:a\s+)?|provide\s+(?:a\s+)?|write\s+(?:a\s+)?)?summar(?:y|ize|ise)|what\s+happened|everything\s+that\s+happened|rundown\s+of\s+(?:this|the|last)|recap\s+(?:of\s+)?(?:this|the|last)|what\s+went\s+on)\b/i

const PERIOD_RE =
  /\b(this\s+week|last\s+week|past\s+week|this\s+month|last\s+month|past\s+month|today|yesterday|last\s+\d+\s+days?|past\s+\d+\s+days?|this\s+quarter)\b/i

const COMPARISON_RE =
  /\b(compar(?:e|ison)|versus|\bvs\.?\b|side[- ]by[- ]side|difference\s+between)\b/i

const CALC_RE =
  /\b(calculat|how\s+much\s+(?:would|will|should|can)|what\s+(?:is|would\s+be)\s+(?:my\s+)?(?:noi|cap\s*rate|cash\s*flow|roi)|estimate\s+(?:the\s+)?(?:cost|rent|income))\b/i

const SHORT_RE =
  /\b(in\s+(?:one|a)\s+(?:sentence|word)|briefly|just\s+the\s+(?:number|total|count)|short\s+answer|yes\s+or\s+no)\b/i

const EXEC_BRIEF_FORMAT_RE =
  /\b(what\s+should\s+i\s+(?:be\s+)?worr(?:y|ied)\s+about|what\s+am\s+i\s+missing|what\s+would\s+you\s+do|what\s+should\s+i\s+prioriti[sz]e|how\s+healthy|catch\s+me\s+up|executive\s+brief|over\s+the\s+next\s+\d+\s+days|next\s+30\s+days)\b/i

/**
 * Best response format for this question (internal — never echo to the landlord).
 */
export function classifyResponseFormat(question: string): AskUloResponseFormat {
  const q = question.trim()
  if (!q) return "adaptive"
  if (SHORT_RE.test(q)) return "short_factual"
  // Named-entity root-cause questions → diagnosis story, not portfolio briefing
  if (
    /\b(?:unit|apt\.?|apartment|#)\s*[A-Za-z]?\d{1,5}[A-Za-z]?\b/i.test(q) &&
    /\b(why|hasn'?t|stall|delay|status|resolv|fix|investigat)\b/i.test(q)
  ) {
    return "maintenance_diagnosis"
  }
  // Require WO- / WO  separator so words like "worry" never match as work orders.
  if (/\bWO[- ][A-Za-z0-9]{3,}\b/i.test(q) || /\bwork\s*order\s+#?[A-Za-z0-9-]+\b/i.test(q)) {
    return "maintenance_diagnosis"
  }
  if (SUMMARY_RE.test(q) || (PERIOD_RE.test(q) && /\b(summar|happened|recap|rundown|went\s+on)\b/i.test(q))) {
    return "summary"
  }
  if (COMPARISON_RE.test(q) && !/\bnearby\s+rentals?|comparable\s*rentals?|comp\s+set\b/i.test(q)) {
    return "comparison"
  }
  if (CALC_RE.test(q)) return "calculation"
  if (/\b(which|rank|most|least|highest|lowest|top\s+\d)\b/i.test(q)) return "ranking"
  if (EXEC_BRIEF_FORMAT_RE.test(q)) return "executive_briefing"
  if (/\b(what\s+should\s+i|recommend|next\s+step)\b/i.test(q)) return "recommendation"
  if (/\b(why|what\s+caused|what\s+is\s+driving|diagnos)\b/i.test(q)) {
    return "maintenance_diagnosis"
  }
  if (/\b(evict|deposit|fair\s*housing|statute|legal|notice\s*period|ors\b)\b/i.test(q)) {
    return "legal"
  }
  return "adaptive"
}

/** True when the user wants an activity summary over a calendar period. */
export function isPeriodSummaryQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (SUMMARY_RE.test(q) && PERIOD_RE.test(q)) return true
  if (/\b(weekly\s+summary|week\s+in\s+review|monthly\s+summary|what\s+happened\s+(?:this|last)\s+week)\b/i.test(q)) {
    return true
  }
  if (
    /\b(give\s+me\s+(?:a\s+)?summary\s+of\s+everything|summarize\s+everything|everything\s+that\s+happened)\b/i.test(
      q,
    )
  ) {
    return true
  }
  return false
}

/** Parse summary window; default this week = last 7 days ending now. */
export function parsePeriodSummaryWindow(question: string): {
  days: number
  label: string
  isDefault: boolean
} {
  const q = question.toLowerCase()
  const nMatch = q.match(/\b(?:last|past)\s+(\d+)\s+days?\b/)
  if (nMatch) {
    const days = Math.min(90, Math.max(1, Number(nMatch[1])))
    return { days, label: `last ${days} days`, isDefault: false }
  }
  if (/\btoday\b/.test(q)) return { days: 1, label: "today", isDefault: false }
  if (/\byesterday\b/.test(q)) return { days: 2, label: "yesterday / last 2 days", isDefault: false }
  if (/\b(this|last|past)\s+week\b/.test(q) || /\bweekly\b/.test(q)) {
    return { days: 7, label: "this week", isDefault: false }
  }
  if (/\b(this|last|past)\s+month\b/.test(q) || /\bmonthly\b/.test(q)) {
    return { days: 30, label: "this month", isDefault: false }
  }
  if (/\bthis\s+quarter\b/.test(q)) {
    return { days: 90, label: "this quarter", isDefault: false }
  }
  // "summary of everything that happened" without window → this week
  if (isPeriodSummaryQuestion(question)) {
    return { days: 7, label: "this week", isDefault: true }
  }
  return { days: 7, label: "this week", isDefault: true }
}

/**
 * System-prompt: dynamic response + instruction following.
 * Supersedes "always use Why I reached / Confidence / Next Steps".
 */
export const DYNAMIC_RESPONSE_GUIDE = `
## Dynamic response (critical — read before writing)
Respond to the user's actual request. Do NOT force every answer into the same fixed template.

Before writing, identify:
1. What the user is asking you to do (request type)
2. What data is required
3. The requested scope (property vs portfolio)
4. The requested timeframe
5. The best response format for THAT question

The final answer must directly complete the requested task.
The first sentence must answer or begin completing the user's request.

### Do NOT use a universal template
Do not automatically include:
- Quick Answer
- Why I Reached This Conclusion / Why I reached this conclusion
- Confidence
- Recommended Next Steps

Only include a section when it improves THAT specific answer.

Format by request type:
- Summary → overview with grouped highlights (e.g. This Week at a Glance)
- Ranking → ordered list (top units/properties)
- Comparison → side-by-side comparison
- Calculation → result + important assumptions
- Explanation → plain-language paragraphs
- Legal → direct answer, jurisdiction, rule, source, effective date, caution when needed
- Maintenance diagnosis → likely cause, urgency, checks, next action
  (for named entities like Unit 304 / WO-1234: root-cause story — never portfolio KPIs)
- Recommendation → recommendation, reasoning, risks, alternatives
- Executive briefing / prioritization / "what should I worry about" → risk-ranked briefing
  (Overall Risk, Highest Priority, watches, Recommended Actions) — not a single KPI
- Short factual → one short answer; stop

Do not substitute a nearby dashboard metric for the answer
(e.g. do not answer a weekly summary with only the current open-ticket count;
 do not answer "why hasn't Unit 304…" with portfolio open-ticket totals;
 do not answer Why / Which / What should / What am I missing with a single KPI).

Questions that trigger an investigation (Why, Which, What should, What's causing,
What's becoming, What's changing, What concerns, What am I missing, How can I improve)
must gather the needed detail internally, then either deliver ranked findings with impact
and actions — or explain the gap with What I know / What's missing / What happens next
in plain property language. Incomplete KPI substitutes must never be shown.

### Intent validation (before you finish)
Confirm internally:
- Same subject the user asked about?
- Correct metric?
- Correct timeframe?
- Correct property or portfolio scope?
- Format matches the requested task?
If any answer is no, revise before responding.

### When information is missing
Never claim you reviewed data you did not have.
Never describe AI process (evidence, investigation, retrieval, packets).
Use the landlord 3-part model: What I know → What's missing → What happens next.
Example: "I can see current maintenance totals, but I do not have the event history needed to create a reliable weekly summary."
Do not fabricate activity, rankings, causes, confidence levels, or recommendations.

### Evidence language (when you explain)
Name the actual data used — avoid generic filler like
"That conclusion comes from the maintenance and property activity available for this analysis."
Prefer: "I reviewed 18 workflow events, 12 maintenance requests, and 6 vendor updates recorded between July 6 and July 12."

Use concise human headings only when they make the answer easier to scan
(Why it matters, What I'd do, Worth watching — never Analysis / Confidence / Reasoning).
A busy landlord should get the answer from the first sentence + bold text + headings + bullets alone.
`.trim()
