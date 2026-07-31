export type VisionCategory =
  | "appliance"
  | "hvac"
  | "water_heater"
  | "boiler"
  | "roof"
  | "other"
  | "unknown"

export type VisionHintCategory =
  | "appliance"
  | "hvac"
  | "water_heater"
  | "boiler"
  | "roof"
  | "other"

export type BoilerFuelType = "gas" | "oil" | "electric" | "propane" | "unknown"

export type AgeConfidence = "low" | "medium" | "high"
export type ConditionRating = "good" | "fair" | "poor" | "unsafe"
export type DeficiencySeverity =
  | "cosmetic"
  | "monitor"
  | "repair_recommended"
  | "safety_hazard"
export type RecommendationUrgency = "routine" | "near_term" | "immediate"
export type VisionProviderName = "gemini" | "gpt4o" | "claude"

export type ApplianceVisionResult = {
  category: VisionCategory
  identifiedItem: {
    type: string
    brand?: string
    modelNumber?: string
    serialNumber?: string
    /** Populated when category === "boiler" */
    fuelType?: BoilerFuelType
    /** Populated when category === "boiler" */
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

export interface VisionProvider {
  name: VisionProviderName
  analyzeImage(
    imageBase64: string,
    hintCategory?: string,
    mediaType?: string,
  ): Promise<ApplianceVisionResult>
  analyzeDocument?(
    imageBase64: string,
    mediaType?: string,
  ): Promise<ApplianceVisionResult[]>
}

export const APPLIANCE_VISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "category",
    "identifiedItem",
    "estimatedAge",
    "condition",
    "deficiencies",
    "maintenanceRecommendations",
  ],
  properties: {
    category: {
      type: "string",
      enum: ["appliance", "hvac", "water_heater", "boiler", "roof", "other", "unknown"],
    },
    identifiedItem: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string" },
        brand: { type: "string" },
        modelNumber: { type: "string" },
        serialNumber: { type: "string" },
        fuelType: {
          type: "string",
          enum: ["gas", "oil", "electric", "propane", "unknown"],
        },
        btuOutput: { type: ["number", "null"] },
      },
    },
    estimatedAge: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "basis"],
      properties: {
        value: { type: ["number", "null"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        basis: { type: "string" },
      },
    },
    condition: {
      type: "object",
      additionalProperties: false,
      required: ["rating", "summary"],
      properties: {
        rating: { type: "string", enum: ["good", "fair", "poor", "unsafe"] },
        summary: { type: "string" },
      },
    },
    deficiencies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "severity"],
        properties: {
          description: { type: "string" },
          severity: {
            type: "string",
            enum: ["cosmetic", "monitor", "repair_recommended", "safety_hazard"],
          },
          location: { type: "string" },
        },
      },
    },
    maintenanceRecommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "urgency"],
        properties: {
          action: { type: "string" },
          urgency: {
            type: "string",
            enum: ["routine", "near_term", "immediate"],
          },
          suggestedIntervalMonths: { type: "number" },
        },
      },
    },
    rawConfidenceNotes: { type: "string" },
  },
} as const
