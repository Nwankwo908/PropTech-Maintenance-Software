/**
 * Maintenance classification contracts — shared client + edge.
 */
import type { VendorTrade } from './vendorTradeDefinitions.ts'
import type { PrimaryCategory } from './primaryCategories.ts'
import type { UrgencyBand } from './urgencyPolicy.ts'
import type { ConfidenceBand } from './confidencePolicy.ts'

export type { VendorTrade, VendorTradeSlug } from './vendorTradeDefinitions.ts'

export type IssueType =
  | 'leak'
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'lock'
  | 'pest'
  | 'roofing'
  | 'general'
  | 'other'

export type SeverityLevel = 'low' | 'normal' | 'urgent' | 'critical'

export type EmergencyType =
  | 'gas'
  | 'fire'
  | 'electrical'
  | 'flood'
  | 'lockout'
  | 'habitability'
  | 'none'

export type ClassificationEntities = {
  issueType: IssueType | null
  vendorTrade: VendorTrade | null
  affectedObject: string | null
  location: string | null
  propertyHint: string | null
  buildingHint: string | null
  unitHint: string | null
  severityIndicators: string[]
  safetyRisks: string[]
  activeDamage: boolean
  damageType: string | null
  duration: string | null
  recurring: boolean
  accessConstraints: string | null
  residentAvailability: string | null
  photoMentioned: boolean
  missingInfo: string[]
  emergencyType: EmergencyType
}

export type SemanticMatch = {
  label: string
  trade: VendorTrade
  issueType: IssueType
  score: number
}

export type ClarificationPrompt = {
  question: string
  reason: string
  field: string
}

export const PIPELINE_VERSION = 'maintenance_classification_v5'

export type ClassificationResult = {
  pipelineVersion: string
  rawDescription: string
  sanitizedDescription: string
  entities: ClassificationEntities
  ticketCategory: VendorTrade
  issueType: IssueType
  vendorTrade: VendorTrade
  /** User-facing bucket (7). Matching uses vendorTrade, not this. */
  primaryCategory: PrimaryCategory
  secondaryTrade: VendorTrade | null
  classificationReason: string
  severity: SeverityLevel
  urgencyBand: UrgencyBand
  urgencyReason: string
  slaMinutes: number
  photoRequested: boolean
  photoRequestReason: string
  confidenceBand: ConfidenceBand
  emergencyType: EmergencyType
  classificationConfidence: number
  categoryConfidence: number
  tradeConfidence: number
  severityConfidence: number
  matchedKeywords: string[]
  matchedEntities: string[]
  semanticMatches: SemanticMatch[]
  modelReasoningSummary: string
  clarificationRequired: boolean
  clarification: ClarificationPrompt | null
  otherPostcheckRan: boolean
  otherPostcheckPassed: boolean
  signals: string[]
  audit: Record<string, unknown>
}

/** Optional SMS thread context — widens the existing LLM call; does not change fuse order. */
export type ClassifyMaintenanceSmsContext = {
  pendingStep?: string | null
  pendingQuestion?: string | null
  recentTurns?: string | null
}

export type ClassifyMaintenanceInput = {
  rawDescription: string
  residentPriority?: string | null
  clarificationAnswers?: string[]
  skipLlm?: boolean
  skipEmbeddings?: boolean
  smsContext?: ClassifyMaintenanceSmsContext | null
  /** Outdoor temperature at the property (°F), when known. */
  outdoorTempF?: number | null
  /** How long the issue has been going on, when known. */
  durationHours?: number | null
}
