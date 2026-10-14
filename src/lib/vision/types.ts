import type { LabelReadability, EquipmentExtractionTrace } from '@shared/vision/equipmentLabel'
/** Shared client types for AI appliance / systems inspection assessment. */

export type VisionCategory =
  | 'appliance'
  | 'hvac'
  | 'water_heater'
  | 'boiler'
  | 'roof'
  | 'electrical_panel'
  | 'plumbing'
  | 'other'
  | 'unknown'

export type VisionHintCategory =
  | 'appliance'
  | 'hvac'
  | 'water_heater'
  | 'boiler'
  | 'roof'
  | 'other'

export type BoilerFuelType = 'gas' | 'oil' | 'electric' | 'propane' | 'unknown'

export type AgeConfidence = 'low' | 'medium' | 'high'

export type ConditionRating = 'good' | 'fair' | 'poor' | 'unsafe'

export type DeficiencySeverity =
  | 'cosmetic'
  | 'monitor'
  | 'repair_recommended'
  | 'safety_hazard'

export type RecommendationUrgency = 'routine' | 'near_term' | 'immediate'

export type InspectionPhotoStatus =
  | 'queued'
  | 'analyzing'
  | 'needs_review'
  | 'confirmed'
  | 'error'

export type VisionProviderName = 'gemini' | 'gpt4o' | 'claude'

export type ApplianceVisionResult = {
  labelReadability?: LabelReadability
  extractionTrace?: EquipmentExtractionTrace
  category: VisionCategory
  identifiedItem: {
    type: string
    brand?: string
    modelNumber?: string
    serialNumber?: string
    /** Populated when category === 'boiler' */
    fuelType?: BoilerFuelType
    /** Populated when category === 'boiler' */
    btuOutput?: number | null
  }
  estimatedAge: {
    value: number | null
    confidence: AgeConfidence
    basis: string
  }
  condition: {
    rating: ConditionRating
    summary: string
  }
  deficiencies: Array<{
    description: string
    severity: DeficiencySeverity
    location?: string
  }>
  maintenanceRecommendations: Array<{
    action: string
    urgency: RecommendationUrgency
    suggestedIntervalMonths?: number
  }>
  rawConfidenceNotes?: string
  /** Overall identification confidence, 0–100. */
  overallConfidence?: number
  /** Nameplate serial read: uncertain characters, format check, and retake prompt. */
  serialReview?: {
    serial: string | null
    readable: boolean
    formatOk: boolean
    formatReason: string | null
    uncertainCharacters: Array<{ index: number; char: string; alternatives: string[] }>
    retake: boolean
    retakePrompt: string | null
    provider: 'gemini-3.8-flash' | 'gpt-4o-mini' | null
    paired: boolean
  }
}

export type InspectionPhotoRow = {
  homeCheckId?: string | null
  id: string
  assessmentId: string
  storagePath: string | null
  hintCategory: VisionHintCategory | null
  status: InspectionPhotoStatus
  aiResult: ApplianceVisionResult | null
  confirmedResult: ApplianceVisionResult | null
  provider: VisionProviderName | null
  errorMessage: string | null
  latencyMs: number | null
  fileName: string | null
  contentType?: string | null
  createdAt?: string | null
  previewUrl?: string | null
  unitAssetId?: string | null
}
