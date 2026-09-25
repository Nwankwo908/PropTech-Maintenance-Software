/** Shared portfolio intelligence — insights (patterns) vs recommendations (actions). */

export const PORTFOLIO_INSIGHT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

export type PortfolioInsightTag =
  | 'RECURRING ISSUES'
  | 'RISK'
  | 'PREVENT FUTURE REPAIRS'
  | 'VENDOR RESPONSE'

export type PortfolioInsightTicketSummary = {
  id: string
  description: string
}

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
  /** Underlying tickets that produced this aggregate (for grounding + deep links). */
  ticketIds?: string[]
  ticketSummaries?: PortfolioInsightTicketSummary[]
  unitId?: string | null
}

/** Suggested next step from the Property Insights recommendation layer. */
export type InsightRecommendationActionType =
  | 'schedule_inspection'
  | 'schedule_building_inspection'
  | 'schedule_unit_walkthrough'
  | 'request_diagnostic'
  | 'nudge_vendor'
  | 'flag_for_review'
  | 'none'

/** Outcome of an insight-triggered inspector scheduling attempt (card UI). */
export type InsightSchedulingStatus =
  | 'idle'
  | 'probing'
  | 'accepted'
  | 'needs_external'

export type InsightSchedulingScope = 'building' | 'unit' | 'diagnostic'

/** Client-visible scheduling state for a Recommended Actions card. */
export type InsightSchedulingCardState = {
  status: InsightSchedulingStatus
  ticketId: string | null
  targetDay: string | null
  /** Withheld until the inspector accepts. */
  inspectorName: string | null
  confirmedWindow: string | null
  holdId: string | null
  requestId: string | null
}

/**
 * One ranked Property Insights card after synthesis (or deterministic fallback).
 * `aggregateText` preserves the plain aggregate sentence for fallback display.
 */
export type SynthesizedInsightCard = {
  id: string
  sourceTags: PortfolioInsightTag[]
  tag: PortfolioInsightTag
  /** Grounded recommendation (or plain aggregate when mode is fallback). */
  text: string
  aggregateText: string
  urgency: number
  confidence: number
  actionType: InsightRecommendationActionType
  actionLabel: string | null
  ticketIds: string[]
  ticketSummaries: PortfolioInsightTicketSummary[]
  unitId: string | null
  unitLabel: string | null
  categoryLabel: string | null
  building: string | null
  requestCount: number | null
  responseRate: number | null
  assignedCount: number | null
  mode: 'openai' | 'fallback'
}

/** Below this confidence, synthesis text is discarded in favor of the plain aggregate. */
export const INSIGHT_SYNTHESIS_LOW_CONFIDENCE = 40

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
  unitId?: string | null
  issueCategory?: string | null
  description?: string | null
  vendorWorkStatus?: string | null
  createdAt: string
  assignedVendorId?: string | null
  urgency?: string | null
}

export type PortfolioUnitRow = {
  id?: string | null
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
