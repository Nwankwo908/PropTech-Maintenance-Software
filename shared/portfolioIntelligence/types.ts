/** Shared portfolio intelligence — insights (patterns) vs recommendations (actions). */

export const PORTFOLIO_INSIGHT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

export type PortfolioInsightTag =
  | 'RECURRING ISSUES'
  | 'RISK'
  | 'PREVENT FUTURE REPAIRS'
  | 'VENDOR RESPONSE'

export type PortfolioInsightFinding = {
  tag: PortfolioInsightTag
  text: string
  score: number
  building?: string | null
  categoryLabel?: string | null
  unitLabel?: string | null
  requestCount?: number | null
  responseRate?: number | null
  assignedCount?: number | null
}

export type PortfolioRecommendationKind =
  | 'priority_property'
  | 'stalled_maintenance'
  | 'escalation_stack'

export type PortfolioRecommendationConfidence = 'high' | 'medium'

export type PortfolioRecommendationSeverity = 'critical' | 'warning'

/** Action-oriented signal — not a Property Insights pattern card. */
export type PortfolioRecommendation = {
  kind: PortfolioRecommendationKind
  /** Stable id for dedupe + notification routing. */
  deduplicationKey: string
  confidence: PortfolioRecommendationConfidence
  severity: PortfolioRecommendationSeverity
  title: string
  message: string
  actionLabel: string
  building?: string | null
  unitLabel?: string | null
  /** Hash of underlying counts — re-alert when state worsens. */
  signature: string
  metadata: Record<string, unknown>
}

export type PortfolioTicketRow = {
  id?: string
  building?: string | null
  unit?: string | null
  issueCategory?: string | null
  vendorWorkStatus?: string | null
  createdAt: string
  assignedVendorId?: string | null
  urgency?: string | null
}

export type PortfolioUnitRow = {
  unitLabel?: string | null
  building?: string | null
}

export type PortfolioWorkflowRow = {
  id: string
  status: string
  building?: string | null
  templateName?: string | null
}

export type PortfolioIntelligenceInput = {
  tickets: PortfolioTicketRow[]
  units: PortfolioUnitRow[]
  vendorResponsePct?: number | null
  assignedWorkOrderCount?: number
  escalatedWorkflows?: PortfolioWorkflowRow[]
  now?: number
}

export type PortfolioIntelligenceResult = {
  insights: PortfolioInsightFinding[]
  recommendations: PortfolioRecommendation[]
}

/** Activity log event type for proactive recommendation alerts. */
export const PORTFOLIO_RECOMMENDATION_EVENT = 'portfolio.recommendation_surfaced'
