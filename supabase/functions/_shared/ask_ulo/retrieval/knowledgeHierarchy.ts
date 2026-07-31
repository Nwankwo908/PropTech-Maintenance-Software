/**
 * Ask Ulo Knowledge Hierarchy — operational decision-support priority.
 *
 * Existing Ulo intelligence (Property Insights, Health, Awaiting Decision, …)
 * is Tier 1 evidence — not optional context.
 */

export type KnowledgeTier = 1 | 2 | 3 | 4

export type KnowledgeSourceId =
  | "property_insights"
  | "property_health"
  | "awaiting_decision"
  | "active_tasks"
  | "workflow_priorities"
  | "risk_scores"
  | "work_orders"
  | "workflow_pipeline"
  | "workflow_runs"
  | "vendor_activity"
  | "operations_graph"
  | "notes"
  | "photos"
  | "messages"
  | "attachments"
  | "invoices"
  | "repair_pricing"
  | "regulations"
  | "weather"
  | "local_market"

export const KNOWLEDGE_HIERARCHY: Array<{
  tier: KnowledgeTier
  label: string
  sources: KnowledgeSourceId[]
  description: string
}> = [
  {
    tier: 1,
    label: "Derived intelligence",
    sources: [
      "property_insights",
      "property_health",
      "awaiting_decision",
      "active_tasks",
      "workflow_priorities",
      "risk_scores",
    ],
    description:
      "Ulo-generated analysis already shown on Overview / Health / Awaiting Decision.",
  },
  {
    tier: 2,
    label: "Operational records",
    sources: [
      "work_orders",
      "workflow_pipeline",
      "workflow_runs",
      "vendor_activity",
      "operations_graph",
    ],
    description: "Live work orders, workflows, vendors, operations graph.",
  },
  {
    tier: 3,
    label: "Supporting evidence",
    sources: ["notes", "photos", "messages", "attachments", "invoices"],
    description: "Messages, photos, invoices that explain or validate findings.",
  },
  {
    tier: 4,
    label: "External knowledge",
    sources: ["repair_pricing", "regulations", "weather", "local_market"],
    description: "Benchmarks, law, weather, market — after Ulo intelligence.",
  },
]

export const NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE = `
## Never Ignore Existing Ulo Intelligence (critical)

Before investigating raw operational data, Ask Ulo must determine whether another
Ulo subsystem has already analyzed the problem.

Examples of Tier 1 intelligence:
- Property Insights (Recurring Issues, Needs Attention, Prevent Future Repairs)
- Property Health
- Awaiting Your Decision / Needs Your Attention
- Workflow Priorities / Active Tasks
- Risk scores and maintenance trends

If these systems already contain a relevant finding, treat them as trusted evidence.

Do NOT tell the user there is insufficient information when a Ulo-generated insight
already answers all or part of the question.

Only investigate deeper (work orders, graph, vendor timeline) to explain, validate,
or expand upon those findings.

Existing Ulo intelligence is part of the assistant's knowledge, not optional context.
`.trim()

/** Soft unavailable language that is invalid when Tier 1 findings exist. */
export const INVALID_WHEN_TIER1_EXISTS_RE =
  /\b(i\s+can'?t\s+(?:tell|answer|find)|i\s+cannot\s+(?:tell|answer|find)|insufficient\s+information|don'?t\s+have\s+enough|request[- ]level\s+(?:history|information)\s+is\s+unavailable|high[- ]level\s+activity|missing\s+the\s+request[- ]level)\b/i

export function looksLikeIgnoringTier1Intelligence(answer: string): boolean {
  return INVALID_WHEN_TIER1_EXISTS_RE.test(answer.trim())
}

export function tierForSource(source: KnowledgeSourceId): KnowledgeTier {
  for (const row of KNOWLEDGE_HIERARCHY) {
    if (row.sources.includes(source)) return row.tier
  }
  return 4
}
