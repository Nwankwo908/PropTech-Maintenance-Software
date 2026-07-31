/** Shared client types for AI appliance / systems inspection assessment. */

export type VisionCategory =
  | 'appliance'
  | 'hvac'
  | 'water_heater'
  | 'boiler'
  | 'roof'
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
}

export type InspectionPhotoRow = {
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
  previewUrl?: string | null
  unitAssetId?: string | null
}
