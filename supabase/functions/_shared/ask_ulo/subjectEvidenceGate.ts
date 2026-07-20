/**
 * Hard subject → evidence gating for Ask Ulo.
 *
 * Prevents cross-subject dashboard fallbacks (e.g. vendor → property ranking,
 * resident late-rent → Oakwood priority) before synthesis.
 */

import {
  detectQuestionSubject,
  isHonestGapSubjectQuestion,
  type AskUloQuestionSubject,
} from "./questionSubjectMatch.ts"

/** Packet families that may be included in the evidence bundle. */
export type AskUloEvidencePacketFamily =
  | "property_ranking"
  | "portfolio_briefing"
  | "property_insights"
  | "unit_ranking"
  | "period_summary"
  | "vendor_metrics"
  | "work_order_ops"
  | "awaiting_decisions"
  | "market"
  | "legal"
  | "document"
  | "ops_graph"
  | "property_snapshot"
  | "weather"
  | "incentives"

const PROPERTY_DASHBOARD_PACKETS: AskUloEvidencePacketFamily[] = [
  "property_ranking",
  "portfolio_briefing",
]

/**
 * Subjects that must never fall back to Property Health / property priority /
 * portfolio briefing as the primary answer.
 */
const BLOCKS_PROPERTY_DASHBOARD: ReadonlySet<AskUloQuestionSubject> = new Set([
  "vendor",
  "resident",
  "work_order",
  "maintenance",
  "workflow",
  "lease",
  "finance",
  "unit",
  "document",
  "legal",
  "local_regulation",
  "market_intelligence",
  "weather",
  "incentives",
])

/** Which packet families are allowed as primary evidence per subject. */
const ALLOWED_PRIMARY: Record<AskUloQuestionSubject, AskUloEvidencePacketFamily[]> = {
  vendor: ["vendor_metrics", "ops_graph", "work_order_ops", "property_snapshot"],
  resident: ["work_order_ops", "ops_graph", "property_snapshot"],
  work_order: [
    "work_order_ops",
    "awaiting_decisions",
    "property_insights",
    "ops_graph",
    "unit_ranking",
  ],
  maintenance: [
    "work_order_ops",
    "awaiting_decisions",
    "property_insights",
    "ops_graph",
    "unit_ranking",
  ],
  workflow: ["work_order_ops", "awaiting_decisions", "ops_graph", "property_insights"],
  lease: ["property_snapshot", "document", "ops_graph"],
  finance: ["work_order_ops", "document", "property_snapshot", "ops_graph"],
  unit: ["unit_ranking", "work_order_ops", "ops_graph", "property_insights"],
  property: [
    "property_ranking",
    "portfolio_briefing",
    "property_insights",
    "ops_graph",
    "work_order_ops",
    "property_snapshot",
  ],
  portfolio: [
    "portfolio_briefing",
    "property_ranking",
    "property_insights",
    "period_summary",
    "ops_graph",
  ],
  period: ["period_summary", "portfolio_briefing", "ops_graph", "work_order_ops"],
  document: ["document", "property_snapshot"],
  legal: ["legal"],
  local_regulation: ["legal", "property_snapshot"],
  market_intelligence: ["market", "property_snapshot"],
  weather: ["weather", "property_snapshot"],
  incentives: ["incentives", "property_snapshot"],
  other: [
    "ops_graph",
    "work_order_ops",
    "property_insights",
    "portfolio_briefing",
    "property_ranking",
    "vendor_metrics",
    "market",
    "legal",
  ],
}

export function subjectBlocksPropertyDashboardFallback(
  subject: AskUloQuestionSubject,
): boolean {
  return BLOCKS_PROPERTY_DASHBOARD.has(subject)
}

export function isEvidencePacketAllowedForSubject(
  subject: AskUloQuestionSubject,
  packet: AskUloEvidencePacketFamily,
): boolean {
  const allowed = ALLOWED_PRIMARY[subject] ?? ALLOWED_PRIMARY.other
  return allowed.includes(packet)
}

export type SubjectEvidencePlan = {
  subject: AskUloQuestionSubject
  /** Do not fetch or synthesize from property ranking / portfolio briefing. */
  blockPropertyDashboard: boolean
  allowPropertyRanking: boolean
  allowPortfolioBriefing: boolean
  allowPropertyInsights: boolean
  allowVendorMetrics: boolean
  allowWorkOrderOps: boolean
}

export function planEvidenceForQuestion(question: string): SubjectEvidencePlan {
  const subject = detectQuestionSubject(question)
  const honestGap = isHonestGapSubjectQuestion(question)
  const blockPropertyDashboard =
    subjectBlocksPropertyDashboardFallback(subject) || honestGap
  return {
    subject,
    blockPropertyDashboard,
    allowPropertyRanking:
      !blockPropertyDashboard &&
      isEvidencePacketAllowedForSubject(subject, "property_ranking"),
    allowPortfolioBriefing:
      !blockPropertyDashboard &&
      isEvidencePacketAllowedForSubject(subject, "portfolio_briefing"),
    allowPropertyInsights: isEvidencePacketAllowedForSubject(
      subject,
      "property_insights",
    ),
    allowVendorMetrics: isEvidencePacketAllowedForSubject(subject, "vendor_metrics"),
    allowWorkOrderOps: isEvidencePacketAllowedForSubject(subject, "work_order_ops"),
  }
}

/** True when a property-dashboard packet would be an illegal primary answer. */
export function isCrossSubjectPropertyPacket(input: {
  question: string
  packet: "property_ranking" | "portfolio_briefing"
}): boolean {
  const subject = detectQuestionSubject(input.question)
  if (!subjectBlocksPropertyDashboardFallback(subject)) return false
  return PROPERTY_DASHBOARD_PACKETS.includes(input.packet)
}
