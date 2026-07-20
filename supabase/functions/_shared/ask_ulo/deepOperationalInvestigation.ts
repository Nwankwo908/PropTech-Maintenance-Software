/**
 * Deep Operational Investigation Rule for Ask Ulo.
 * Full ops search before claiming information is unavailable.
 */

export const DEEP_OPERATIONAL_INVESTIGATION_GUIDE = `
## Deep Operational Investigation (critical)

Ask Ulo must perform a full operational investigation before stating that information is unavailable.

Applies to questions involving: maintenance requests, work orders, vendors, residents,
units, properties, workflow status, delays, costs, recurring issues, emergencies,
operational risk, repair estimates.

Do NOT rely only on KPI cards, portfolio totals, summary objects, or the current dashboard view.

### Required search order (do not stop after the first empty source)
1. Maintenance requests
2. Work order pipeline
3. Workflow runs
4. Property operations graph
5. Vendor assignment and response history
6. Status changes and SLA events
7. Unit and property records
8. Resident messages and notes
9. Inspection findings
10. Attachments, photos, estimates, and invoices
11. Related or duplicate work orders
12. Historical repairs for the same unit, system, or category

### Entity and category expansion
When the user references a category, search related terms and synonyms.
HVAC → heating, cooling, air conditioning, AC, furnace, heat pump, thermostat,
ventilation, condenser, compressor, air handler, no heat, no cooling, warm air,
frozen unit, refrigerant leak.
Plumbing → leak, faucet, toilet, drain, pipe, water heater, sewage, low pressure,
clogged, flooding.
Do not require the exact word from the user's prompt.

### Scope
Resolve: one unit / one property / current property / full portfolio / time period.
Use the narrowest valid scope first. For “Estimate the repair cost for the HVAC issues,”
search open and recent HVAC-related requests in the active scope before any portfolio limitation.

### Repair-cost questions
Before estimating: match work order(s), property/unit, description, equipment, symptoms,
urgency, age, vendor notes, inspection findings, prior repairs, photos, existing quote,
local/benchmark pricing when available. Classify the likely repair scenario.
Provide a range unless an actual quote exists.

### Missing detail ≠ missing records
If a matching ticket exists but lacks diagnosis/quote, say you found the request and
what is still needed — then give a typical range based on symptoms.
Never say you cannot find enough information when a relevant work order exists.
Never expose retrieval stats ("I found N matching records", "in scope") — lead with the insight.

### Invalid fallbacks (prohibited when a relevant record exists)
- “I can only see high-level activity.”
- “I do not have enough evidence.”
- “I cannot fully answer yet.”
- “The necessary history is unavailable.”
- generic portfolio totals / unrelated KPI summaries
These may only be used after every relevant source has been checked and the exact missing field is named.

### Response shape
Lead with the finding, then:
### What's going on — unit, issue, status, age, vendor, existing estimate
### Estimated cost — ranges by scenario (or actual quote)
### What would narrow the estimate
### What I'd do next

### Definition of done
1. Located the relevant operational record
2. Reconstructed useful context
3. Identified what is known
4. Identified what is still missing
5. Produced the best supported answer
6. Recommended a practical next action
`.trim()

/** Category → expansion terms for ticket matching. */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  hvac: [
    "hvac",
    "heating",
    "cooling",
    "air conditioning",
    "air-conditioning",
    "a/c",
    "ac",
    "furnace",
    "heat pump",
    "thermostat",
    "ventilation",
    "condenser",
    "compressor",
    "air handler",
    "no heat",
    "no cooling",
    "warm air",
    "frozen unit",
    "refrigerant",
    "blower",
    "capacitor",
  ],
  plumbing: [
    "plumbing",
    "plumb",
    "leak",
    "leaking",
    "faucet",
    "toilet",
    "drain",
    "pipe",
    "water heater",
    "sewage",
    "low pressure",
    "clogged",
    "flooding",
    "flood",
    "sink",
    "shower",
  ],
  electrical: [
    "electrical",
    "electric",
    "outlet",
    "spark",
    "sparking",
    "breaker",
    "wiring",
    "panel",
    "power out",
    "no power",
    "light",
    "fixture",
  ],
  pest: ["pest", "roach", "rodent", "mice", "rats", "bed bug", "insect", "infestation"],
  appliance: ["appliance", "stove", "oven", "dishwasher", "refrigerator", "washer", "dryer", "microwave"],
  roof: ["roof", "roofing", "shingle", "gutter", "leak roof"],
  mold: ["mold", "mildew", "moisture", "damp"],
}

export type OpsCategoryId = keyof typeof CATEGORY_SYNONYMS

export type OpsScope =
  | "unit"
  | "property"
  | "portfolio"
  | "period"
  | "unknown"

export type DeepOpsPlan = {
  requiresDeepOps: boolean
  isRepairCostQuestion: boolean
  categories: OpsCategoryId[]
  searchTerms: string[]
  scope: OpsScope
  searchChecklist: string[]
  confidence: "high" | "medium" | "low"
}

const OPS_TOPIC_RE =
  /\b(maintenance|work\s*orders?|vendor|resident|unit|propert(?:y|ies)|workflow|delay|cost|estimat|recurring|emergenc|risk|repair|hvac|plumb|electric|leak|ticket|request)\b/i

const REPAIR_COST_RE =
  /\b(estimat(?:e|ing|ion)?|how\s+much|repair\s+cost|cost\s+(?:to\s+)?(?:fix|repair)|quote|pricing|price\s+range|what\s+would\s+(?:it|this|that)\s+cost)\b/i

const SEARCH_CHECKLIST = [
  "Maintenance requests",
  "Work order pipeline",
  "Workflow runs",
  "Property operations graph",
  "Vendor assignment and response history",
  "Status changes and SLA events",
  "Unit and property records",
  "Resident messages and notes",
  "Inspection findings",
  "Attachments, photos, estimates, and invoices",
  "Related or duplicate work orders",
  "Historical repairs for the same unit, system, or category",
]

/** Soft / prohibited incomplete shells when records exist. */
export const INVALID_OPS_FALLBACK_RE =
  /\b(i\s+can\s+only\s+see\s+high[- ]level\s+activity|i\s+(?:do\s+not|don't)\s+have\s+enough\s+evidence|i\s+cannot\s+fully\s+answer\s+yet|i\s+can'?t\s+fully\s+answer\s+yet|the\s+necessary\s+history\s+is\s+unavailable|high[- ]level\s+(?:portfolio\s+)?activity|cannot\s+find\s+request[- ]level|don'?t\s+have\s+request[- ]level|request[- ]level\s+information\s+is\s+unavailable)\b/i

/**
 * Expand a category id into all search terms (lowercased).
 */
export function expandCategoryTerms(category: OpsCategoryId): string[] {
  return [...(CATEGORY_SYNONYMS[category] ?? [category])]
}

/**
 * Detect HVAC / plumbing / etc. categories mentioned in the question.
 */
export function detectOpsCategories(question: string): OpsCategoryId[] {
  const q = question.toLowerCase()
  const found: OpsCategoryId[] = []
  for (const [id, terms] of Object.entries(CATEGORY_SYNONYMS) as Array<[OpsCategoryId, string[]]>) {
    if (terms.some((t) => {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return new RegExp(`\\b${escaped}\\b`, "i").test(q)
    })) {
      found.push(id)
    }
  }
  return found
}

export function isRepairCostQuestion(question: string): boolean {
  return REPAIR_COST_RE.test(question.trim())
}

export function resolveOpsScope(question: string): OpsScope {
  const q = question.trim()
  if (/\b(?:unit|apt\.?|apartment|#)\s*[A-Za-z]?\d{1,5}[A-Za-z]?\b/i.test(q)) return "unit"
  if (/\b(this|the|my)\s+(building|property|complex)\b|\bat\s+[A-Z][A-Za-z0-9'’&\- ]{2,40}\b/.test(q)) {
    return "property"
  }
  if (/\b(this\s+week|last\s+week|past\s+\d+|this\s+month|next\s+\d+\s+days)\b/i.test(q)) {
    return "period"
  }
  if (/\b(portfolio|all\s+(?:my\s+)?propert|across\s+(?:my\s+)?propert)\b/i.test(q)) {
    return "portfolio"
  }
  return "unknown"
}

/**
 * True when the question requires deep ops investigation (not KPI glance).
 */
export function requiresDeepOperationalInvestigation(question: string): boolean {
  return classifyDeepOperationalInvestigation(question).requiresDeepOps
}

import { isMissingUpdatesQuestion } from "./missingUpdatesLookup.ts"
import { isVendorBestQuestion, isAnyVendorMetricQuestion } from "./questionMetricContext.ts"
import { isVendorResponseSpeedQuestion, isVendorRankingQuestion } from "./questionSubjectMatch.ts"

export function classifyDeepOperationalInvestigation(question: string): DeepOpsPlan {
  const q = question.trim()
  if (!q) {
    return {
      requiresDeepOps: false,
      isRepairCostQuestion: false,
      categories: [],
      searchTerms: [],
      scope: "unknown",
      searchChecklist: [],
      confidence: "low",
    }
  }

  // Portfolio list questions (missing updates, vendor metrics, etc.) are not single-ticket deep ops.
  if (
    isMissingUpdatesQuestion(q) ||
    isAnyVendorMetricQuestion(q) ||
    isVendorResponseSpeedQuestion(q) ||
    isVendorBestQuestion(q) ||
    isVendorRankingQuestion(q)
  ) {
    return {
      requiresDeepOps: false,
      isRepairCostQuestion: false,
      categories: [],
      searchTerms: [],
      scope: "portfolio",
      searchChecklist: [],
      confidence: "high",
    }
  }

  const categories = detectOpsCategories(q)
  const repair = isRepairCostQuestion(q)
  const opsTopic = OPS_TOPIC_RE.test(q)
  const requiresDeepOps = repair || (opsTopic && (categories.length > 0 || /\b(why|which|what(?:'s|\s+is)|how\s+much|estimat|becoming|causing|stuck|delayed)\b/i.test(q)))

  const searchTerms = Array.from(
    new Set(categories.flatMap((c) => expandCategoryTerms(c))),
  )

  return {
    requiresDeepOps,
    isRepairCostQuestion: repair,
    categories,
    searchTerms,
    scope: resolveOpsScope(q),
    searchChecklist: requiresDeepOps ? SEARCH_CHECKLIST : [],
    confidence: requiresDeepOps ? (categories.length || repair ? "high" : "medium") : "low",
  }
}

/**
 * True when text looks like a soft high-level dodge.
 */
export function looksLikeInvalidOpsFallback(answer: string): boolean {
  return INVALID_OPS_FALLBACK_RE.test(answer.trim())
}

/**
 * Does haystack (category + description) match any search term?
 */
export function textMatchesOpsTerms(
  haystack: string,
  terms: string[],
): boolean {
  const h = haystack.toLowerCase()
  if (!h.trim() || terms.length === 0) return false
  return terms.some((t) => {
    const term = t.toLowerCase()
    if (term.length <= 2) {
      // Short tokens like "ac" — word boundary only
      return new RegExp(`\\b${term}\\b`, "i").test(h)
    }
    return h.includes(term)
  })
}

/** Typical residential repair cost bands (USD) by category / scenario. */
export const TYPICAL_REPAIR_COST_BANDS: Record<
  OpsCategoryId,
  Array<{ scenario: string; rangeLabel: string }>
> = {
  hvac: [
    { scenario: "Minor repair (thermostat, capacitor, simple part)", rangeLabel: "$150–$400" },
    { scenario: "Moderate repair (refrigerant, blower motor, control board)", rangeLabel: "$400–$1,200" },
    { scenario: "Major component (compressor / heat exchanger)", rangeLabel: "$1,500–$4,000" },
    { scenario: "Full system replacement", rangeLabel: "$5,000–$12,000" },
  ],
  plumbing: [
    { scenario: "Minor fix (faucet, minor clog, valve)", rangeLabel: "$100–$350" },
    { scenario: "Moderate (water heater parts, drain line)", rangeLabel: "$350–$1,200" },
    { scenario: "Major (sewer line, slab / extensive leak)", rangeLabel: "$1,500–$6,000+" },
  ],
  electrical: [
    { scenario: "Outlet / fixture / breaker swap", rangeLabel: "$100–$400" },
    { scenario: "Circuit / panel work", rangeLabel: "$400–$2,000" },
    { scenario: "Major rewiring", rangeLabel: "$2,000–$8,000+" },
  ],
  pest: [
    { scenario: "Standard treatment", rangeLabel: "$150–$450" },
    { scenario: "Extensive / follow-up plan", rangeLabel: "$450–$1,500" },
  ],
  appliance: [
    { scenario: "Common appliance repair", rangeLabel: "$100–$400" },
    { scenario: "Major repair or replacement", rangeLabel: "$400–$1,500+" },
  ],
  roof: [
    { scenario: "Patch / minor repair", rangeLabel: "$300–$1,000" },
    { scenario: "Section repair", rangeLabel: "$1,000–$4,000" },
    { scenario: "Full reroof", rangeLabel: "$5,000–$15,000+" },
  ],
  mold: [
    { scenario: "Assessment + localized remediation", rangeLabel: "$500–$3,000" },
    { scenario: "Extensive remediation", rangeLabel: "$3,000–$10,000+" },
  ],
}

export function evaluateDeepOperationalInvestigationQc(input: {
  question: string
  answer: string
  /** Lookup found at least one matching ops ticket. */
  foundMatchingRecords?: boolean
  /** Structured work orders from operational retrieval. */
  workOrders?: Array<{
    workOrderId: string
    propertyName?: string
    unitLabel?: string | null
    estimatedCost?: number | null
  }>
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  plan: DeepOpsPlan
} {
  const plan = classifyDeepOperationalInvestigation(input.question)
  if (!plan.requiresDeepOps) {
    return {
      status: "skip",
      summary: "Not a deep operational investigation question.",
      plan,
    }
  }

  const answer = input.answer.trim()
  if (!answer) {
    return {
      status: "fail",
      summary: "Empty answer before operational investigation completed.",
      plan,
    }
  }

  if (input.foundMatchingRecords && looksLikeInvalidOpsFallback(answer)) {
    return {
      status: "fail",
      summary:
        "Invalid fallback: soft high-level / unavailable language while matching operational records exist.",
      plan,
    }
  }

  const workOrders = input.workOrders ?? []
  const primary = workOrders[0]
  if (input.foundMatchingRecords && primary) {
    const mentionsWo = new RegExp(primary.workOrderId.replace(/-/g, "[-–]?"), "i").test(
      answer,
    ) ||
      (primary.unitLabel
        ? new RegExp(`\\b${primary.unitLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
          .test(answer)
        : false) ||
      (primary.propertyName
        ? answer.toLowerCase().includes(primary.propertyName.toLowerCase())
        : false)

    if (!mentionsWo) {
      return {
        status: "fail",
        summary:
          "Matching work order was retrieved but the answer does not mention the work order, unit, or property.",
        plan,
      }
    }

    if (
      plan.isRepairCostQuestion &&
      primary.estimatedCost != null &&
      !new RegExp(
        `\\$${Math.round(primary.estimatedCost)}|\\b${Math.round(primary.estimatedCost)}\\b`,
      ).test(answer.replace(/,/g, ""))
    ) {
      return {
        status: "fail",
        summary:
          "Repair-cost question: estimated_cost was retrieved but the answer omitted the work-order estimate.",
        plan,
      }
    }

    if (
      /\b(request[- ]level|high[- ]level\s+(?:portfolio\s+)?activity|cannot\s+find\s+(?:enough\s+)?(?:request|ticket)|don't\s+have\s+request[- ]level)\b/i
        .test(answer)
    ) {
      return {
        status: "fail",
        summary:
          "Answer claims request-level data is missing while matching operational records exist.",
        plan,
      }
    }
  }

  if (
    input.foundMatchingRecords &&
    plan.isRepairCostQuestion &&
    !/\$|cost|estimate|range|quote/i.test(answer)
  ) {
    return {
      status: "warn",
      summary: "Repair-cost question with matching tickets should include a cost finding or range.",
      plan,
    }
  }

  return {
    status: "pass",
    summary: input.foundMatchingRecords
      ? "Deep ops answer acknowledges located records (or packet-backed finding)."
      : "Deep ops question — soft unavailable language allowed only if no matching records.",
    plan,
  }
}

export function deepOperationalInvestigationPromptBlock(question: string): string {
  const plan = classifyDeepOperationalInvestigation(question)
  if (!plan.requiresDeepOps) return ""
  return (
    `DEEP_OPERATIONAL_INVESTIGATION: required\n` +
    `repair_cost: ${plan.isRepairCostQuestion}\n` +
    `scope: ${plan.scope}\n` +
    `categories: ${plan.categories.join(", ") || "general_ops"}\n` +
    `search_terms: ${plan.searchTerms.slice(0, 24).join(", ") || "(from packets)"}\n` +
    `checklist:\n${plan.searchChecklist.map((s) => `- ${s}`).join("\n")}\n` +
    `RULE: Prefer DEEP OPS INVESTIGATION packet. If matching tickets exist, lead with the finding — ` +
    `never high-level portfolio dodges. Missing detail ≠ missing records.\n` +
    `For repair costs: classify scenario + give ranges unless an actual quote exists; list what would narrow the estimate.\n`
  )
}
