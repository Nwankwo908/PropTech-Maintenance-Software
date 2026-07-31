/**
 * Shared packet / synthesis types for Ask Ulo answer generation.
 * Kept separate so buildPrompt / synthesizeAnswer / formatAnswer can share them
 * without circular imports.
 */

import type { AskUloIntent } from "../routing/detectIntent.ts"
import type { AskUloReasoningMode } from "../routing/reasoningMode.ts"
import type { AskUloResponseFormat } from "../routing/dynamicResponse.ts"
import type { CounselExpertRoleId } from "../audit/counselHandoff.ts"
import type { FairHousingSafety } from "../guards/fairHousingSafety.ts"
import type { HumanDecisionSafety } from "../guards/humanDecisionSafety.ts"
import type { AskUloCitation } from "../retrieval/searchInternalData.ts"
import type { AskUloEvidencePacket } from "../retrieval/buildEvidencePacket.ts"
import type { PriceHistoryEvent } from "../tools/finance/propertyPriceHistory.ts"

export type AskUloHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type AskUloTokenUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export type AskUloSynthesis = {
  answer: string
  citations: AskUloCitation[]
  mode: "openai" | "fallback"
  model: string | null
  usage: AskUloTokenUsage | null
  synthesizeMs: number | null
}

export type AskUloToolPackets = {
  question: string
  history?: AskUloHistoryMessage[]
  intent: AskUloIntent
  intentLabel: string
  jurisdiction: {
    countryCode?: string | null
    stateCode: string | null
    countySlug?: string | null
    countyLabel?: string | null
    cityLabel: string | null
    citySlug: string | null
    courtSystem?: string | null
    housingProgram?: string | null
    codeSet?: string | null
  }
  /** Legal intent gate: clarify location or refuse ungrounded answers. */
  legalGate?: {
    status: "ok" | "clarify" | "refuse"
    markdown: string
    officialSourceCount: number
    primaryOfficialCount?: number
    agencyGuidanceCount?: number
    sensitiveTopics?: Array<{ id: string; label: string }>
    requireCounsel?: boolean
    counselNote?: string | null
    recommendedExpertId?: CounselExpertRoleId | null
  } | null
  /** Soft Fair Housing / screening refuse-decision (hard blocks return earlier). */
  fairHousing?: FairHousingSafety | null
  /** Soft refuse for accommodation / eviction strategy / DV / retaliation outcomes. */
  humanDecision?: HumanDecisionSafety | null
  /** When true, omit live ops packets (screening PII isolation). */
  screeningIsolation?: boolean
  ops?: { bullets: string[]; citations: AskUloCitation[] } | null
  legal?: {
    bullets: string[]
    citations: AskUloCitation[]
    mode: string
    pendingOrdinanceCount?: number
  } | null
  structured?: { bullets: string[]; citations: AskUloCitation[]; facts: unknown[] } | null
  property?: {
    bullets: string[]
    citations: AskUloCitation[]
    buildingName: string | null
  } | null
  market?: {
    available: boolean
    provider: "rentcast" | "zillow_rapidapi" | "zillow_research" | null
    bullets: string[]
    citations: AskUloCitation[]
    gapNote: string | null
    estimatedRent: number | null
    rentRangeLow: number | null
    rentRangeHigh: number | null
  } | null
  priceHistory?: {
    available: boolean
    bullets: string[]
    citations: AskUloCitation[]
    events: PriceHistoryEvent[]
    summary: {
      lastSale: number | null
      lastSaleDate: string | null
      currentEstimate: number | null
      appreciationSinceSalePct: number | null
      avgAnnualAppreciationPct: number | null
    }
    drivers: string[]
    gapNote: string | null
    needsClarification: boolean
    clarificationPrompt: string | null
    markdown: string
  } | null
  rentHistory?: {
    available: boolean
    bullets: string[]
    citations: AskUloCitation[]
    gapNote: string | null
    markdown: string
  } | null
  /** Executive portfolio briefing (broad ops / health questions). */
  portfolioBriefing?: {
    available: boolean
    assessment: string
    healthScore: number | null
    healthDelta4w: number | null
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    facts: Record<string, unknown>
  } | null
  /** Property-level ranking for comparison / prioritization / diagnosis. */
  propertyRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    portfolioOpenWorkOrders: number
    top: {
      building: string
      whyLines: string[]
      recommendedActions: string[]
      openWorkOrders: number
      criticalWorkOrders: number
      agingWorkOrders: number
      escalatedWorkflows: number
      healthScore: number | null
      healthDelta4w: number | null
    } | null
    watch: Array<{ building: string; whyLines: string[]; openWorkOrders: number }>
  } | null
  /** Unit-level maintenance request volume ranking. */
  unitMaintenanceRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    timeframeLabel: string
    timeframeDays: number
    timeframeIsDefault: boolean
    scopeLabel: string
    unlinkedRequestCount: number
    scopedRequestCount: number
    openInScope: number
    top: {
      unitLabel: string
      building: string
      totalRequests: number
      recentRequests: number
      openRequests: number
      mostCommonCategory: string | null
    } | null
    ranked: Array<{
      unitLabel: string
      building: string
      totalRequests: number
      recentRequests: number
      openRequests: number
      mostCommonCategory: string | null
    }>
  } | null
  /** Period activity summary (this week / this month). */
  periodSummary?: {
    available: boolean
    canSummarize: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    periodLabel: string
    periodDays: number
    periodIsDefault: boolean
    scopeLabel: string
    facts: Record<string, unknown>
  } | null
  /** Oldest unresolved work order (longest waiting). */
  oldestWaitingWorkOrder?: {
    available: boolean
    found: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openCount: number
    oldest: {
      displayId: string
      building: string
      unit: string | null
      issueCategory: string
      description: string | null
      status: string
      daysWaiting: number
      vendorName: string | null
      reasonWaiting: string
      recommendedAction: string
    } | null
  } | null
  /** Named-entity root-cause investigation (Unit 304, WO-1234, …). */
  entityInvestigation?: {
    available: boolean
    found: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    primary: {
      displayId: string
      building: string
      unit: string | null
      issueCategory: string
      description: string | null
      status: string
      daysOpen: number
      vendorName: string | null
      rootCause: string
      recommendedAction: string
    } | null
  } | null
  /** Category-synonym ops investigation (repair cost / HVAC / plumbing / …). */
  deepOpsInvestigation?: {
    available: boolean
    found: boolean
    missingFields: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    categories: string[]
    isRepairCostQuestion: boolean
    ticketCount: number
    /** Structured work orders — same SoT as workflow detail. */
    workOrders?: Array<{
      workOrderId: string
      maintenanceRequestId: string
      propertyName: string
      unitLabel: string | null
      category: string
      title: string
      description: string
      priority: string | null
      estimatedCost: number | null
      estimatedCostSource: string | null
      repairScope: string
      laborEstimate: string
      workflowStage: string | null
      vendorName: string | null
      slaExpired: boolean
      approvalStatus: string
    }>
    operationalEvidenceJson?: string
  } | null
  /** Overview Property Insights (Recurring / Needs Attention / Prevent). */
  propertyInsights?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    insights: Array<{
      tag: string
      text: string
      requestCount: number | null
      building: string | null
      unitLabel: string | null
      categoryLabel: string | null
    }>
    sufficientForMaintenanceRisk: boolean
  } | null
  /** Recurring repairs (repair-level open + completed 60d). */
  recurringRepairs?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ticketCount: number
    completedTicketCount: number
    completedWorkflowCount: number
    windowDays: number
    patterns: Array<{
      kind: string
      label: string
      repairTypeId?: string
      repairTypeLabel?: string
      count: number
      building: string | null
      unitLabel: string | null
      categoryFamily: string
      completedCount: number
      openCount: number
      reopenedAfterCompletion: boolean
    }>
  } | null
  /** Urgent open repairs + landlord-awaiting workflows to approve first. */
  repairsToApprove?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openUrgentCount: number
    awaitingCount: number
    items: Array<{
      kind: string
      label: string
      building: string | null
      unitLabel: string | null
      reason: string
      priority: string | null
    }>
  } | null
  /** Late-rent / arrears residents from users.balance_due + rent_collection. */
  residents?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    filter: string
    residents: Array<{
      residentId: string
      name: string
      unitLabel: string | null
      propertyName: string | null
      balanceDue: number
      daysOverdue: number | null
      moveInDate?: string | null
      awaitingReplyHours?: number | null
    }>
  } | null
  /** Open work orders stuck without progress / missing updates. */
  missingUpdates?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openCount: number
    items: Array<{
      displayId: string
      label: string
      building: string | null
      unitLabel: string | null
      whyMissing: string
      daysWaiting: number
      status: string
    }>
  } | null
  /** Vendors ranked by response speed. */
  vendorResponseSpeed?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      avgResponseMinutes: number | null
      acceptedJobs: number
      completedJobs: number
      responseSpeedScore: number | null
    }>
  } | null
  /** Best vendors by overall score (optional trade filter). */
  vendorBest?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    tradeSlug: string | null
    tradeLabel: string | null
    ranked: Array<{
      vendorId: string
      name: string
      category: string | null
      vendorScore: number | null
      residentSatisfaction: number | null
      reviewCount: number
      completedJobs: number
      acceptedJobs: number
      avgResponseMinutes: number | null
      completionRate: number | null
    }>
  } | null
  /** Vendors ranked by completion rate. */
  vendorCompletion?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      completionRate: number | null
      completedJobs: number
      acceptedJobs: number
    }>
  } | null
  /** Vendors without recent accepts / pending accept. */
  vendorInactive?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      pendingAcceptJobs: number
      acceptedJobs: number
      lastAssignedAt: string | null
      daysSinceAssigned: number | null
      reason: string
    }>
  } | null
  /** Vendors overloaded by open assigned workload. */
  vendorOverload?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      openJobs: number
      pendingAccept: number
      accepted: number
      inProgress: number
      oldestOpenDays: number | null
    }>
  } | null
  /** Vendor verification / capacity chips from vendor_verifications. */
  vendorVerification?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string | null
      name: string
      verificationStatus: string | null
      verificationLabel: string
      capacityLabel: string
      checklistComplete: number
      checklistRequired: number
      missingReasons: string[]
    }>
  } | null
  /** Knowledge hierarchy / investigation playbook for this turn. */
  investigationPlaybook?: {
    id: string
    preferTier1Answer: boolean
    consultTier1First: boolean
    deepOpsPrimary: boolean
  } | null
  /** How to reason about the answer (internal — never echo mode names to the user). */
  reasoningMode?: AskUloReasoningMode
  /** Best response shape for this question (internal). */
  responseFormat?: AskUloResponseFormat
  /** When true, prefer a short Quick Answer (narrow factual ops). */
  narrowFactual?: boolean
  /**
   * Canonical pre-synthesis organizer (internal / legal / market / missing).
   * Prefer these facts over raw specialty packet dumps when present.
   */
  evidencePacket?: AskUloEvidencePacket | null
  toolsUsed: string[]
}

