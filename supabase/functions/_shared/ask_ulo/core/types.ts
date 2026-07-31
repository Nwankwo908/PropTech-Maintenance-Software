/**
 * Shared Ask Ulo response / audit types used by the orchestrator and UI.
 */

import type { AskUloAgentMode } from "../routing/selectMode.ts"
import type { CounselExpertRoleId } from "../audit/counselHandoff.ts"
import type { AskUloCitation } from "../retrieval/searchInternalData.ts"
import type { AnswerConfidence, SourceUsedItem } from "../retrieval/rankEvidence.ts"

export type AskUloSafetyBoundary = {
  blocked: true
  /** Distinguishes auto-execute blocks from Fair Housing / screening refusals. */
  kind?: "action_boundary" | "fair_housing"
  actions: Array<{ id: string; label: string }>
  fairHousingFlags?: Array<{ id: string; label: string }>
}

export type AskUloLegalAudit = {
  gateStatus: "ok" | "clarify" | "refuse" | null
  sensitiveTopics: Array<{ id: string; label: string }>
  requireCounsel: boolean
  counselNote: string | null
  officialSourceCount: number
  primaryOfficialCount: number
  agencyGuidanceCount: number
  discoveryMirrorCount: number
  /** Newly adopted ordinances not yet in the published online code. */
  pendingOrdinanceCount: number
  /** Suggested human expert for handoff. */
  recommendedExpertId: CounselExpertRoleId
  /** Concrete expert roles landlords can flag for review. */
  handoffExperts: Array<{
    id: CounselExpertRoleId
    label: string
    shortLabel: string
    description: string
    whenToUse: string
  }>
  /** When gate is clarify for property scope — clickable building names in UI. */
  propertyClarifyOptions: string[]
  /** Answer confidence from trusted source hierarchy. */
  answerConfidence: AnswerConfidence
  answerConfidenceLabel: string
  /** Transparent checklist of sources that grounded this answer. */
  sourcesUsed: SourceUsedItem[]
  /** Five-check quality gate (location → topic → scope → sources → grounding + safety QC). */
  qualityChecks: Array<{
    id: string
    step: number | null
    label: string
    status: "pass" | "fail" | "warn" | "skip"
    summary: string
  }>
}

export type AskUloMarketCompVisual = {
  address: string
  rent: number | null
  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  distanceMiles: number | null
  source: string
  listingUrl: string | null
}

export type AskUloHistoryChartPoint = {
  date: string
  value: number
}

export type AskUloVisualContext =
  | {
    kind: "market_analysis" | "comparable_rentals"
    buildingName: string | null
    address: string | null
    cityLabel: string | null
    stateCode: string | null
    lat: number | null
    lng: number | null
    comps: AskUloMarketCompVisual[]
    showStreetView: boolean
  }
  | {
    kind: "price_history" | "rent_history"
    buildingName: string | null
    title: string
    changeLabel: string | null
    /** 'value' = property $, 'rent' = $/mo */
    valueKind: "value" | "rent"
    series: AskUloHistoryChartPoint[]
  }

export type AskUloHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

/** Soft permission stubs — Edge auth already gated the call; refine later by role. */
export type AskUloPermissions = {
  canAskLegal: boolean
  canSeeResidents: boolean
  canSeeVendors: boolean
  canSeeFinance: boolean
}

export type AskUloRunInput = {
  question: string
  landlordId: string
  /** Authenticated staff user (optional until Edge always forwards it). */
  userId?: string | null
  history?: AskUloHistoryMessage[]
  conversationId?: string | null
  agentMode?: string | null
  /** Optional permission overrides (tests / restricted roles). */
  permissions?: Partial<AskUloPermissions>
}

export type AskUloResponse = {
  answer: string
  citations: AskUloCitation[]
  toolsUsed: string[]
  mode: "openai" | "fallback"
  model: string | null
  intent: string
  agentMode: AskUloAgentMode | null
  /** Continuous-eval row id for feedback / dashboards. */
  evalId: string | null
  jurisdiction: {
    countryCode: string
    stateCode: string | null
    countySlug: string | null
    countyLabel: string | null
    citySlug: string | null
    cityLabel: string | null
    courtSystem: string | null
    housingProgram: string | null
    codeSet: string | null
  }
  /** Rich UI payload for market / rental / neighborhood / investment analyses. */
  visualContext: AskUloVisualContext | null
  /** Audit / transparency for legal answers (also persisted on messages). */
  legalAudit: AskUloLegalAudit | null
  /** Set when the user asked Ulo to auto-execute a blocked consequential action. */
  safetyBoundary: AskUloSafetyBoundary | null
}
