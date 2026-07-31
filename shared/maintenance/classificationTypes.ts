/**
 * Maintenance classification contracts — shared client + edge.
 */
import type { VendorTrade } from './vendorTradeDefinitions.ts'

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

export const PIPELINE_VERSION = 'maintenance_classification_v1'

export type ClassificationResult = {
  pipelineVersion: string
  rawDescription: string
  sanitizedDescription: string
  entities: ClassificationEntities
  ticketCategory: VendorTrade
  issueType: IssueType
  vendorTrade: VendorTrade
  severity: SeverityLevel
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

export type ClassifyMaintenanceInput = {
  rawDescription: string
  residentPriority?: string | null
  clarificationAnswers?: string[]
  skipLlm?: boolean
  skipEmbeddings?: boolean
}
