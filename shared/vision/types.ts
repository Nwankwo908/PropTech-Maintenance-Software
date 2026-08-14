export type VisionCategory =
  | "appliance"
  | "hvac"
  | "water_heater"
  | "boiler"
  | "roof"
  | "other"
  | "unknown"

export type AgeConfidence = "low" | "medium" | "high"
export type ConditionRating = "good" | "fair" | "poor" | "unsafe"
export type DeficiencySeverity =
  | "cosmetic"
  | "monitor"
  | "repair_recommended"
  | "safety_hazard"
export type RecommendationUrgency = "routine" | "near_term" | "immediate"

export type ApplianceVisionResult = {
  category: VisionCategory
  identifiedItem: {
    type: string
    brand?: string
    modelNumber?: string
    serialNumber?: string
    fuelType?: "gas" | "oil" | "electric" | "propane" | "unknown"
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

export type DibIdentification = {
  category: VisionCategory
  type: string
  brand?: string
  modelNumber?: string
  serialNumber?: string
  confidence: number | null
  dibItemId?: string
  dibCategory?: string | null
  dibSubCategory?: string | null
}
