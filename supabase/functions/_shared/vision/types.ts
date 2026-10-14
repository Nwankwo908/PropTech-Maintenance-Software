import type { LabelReadability, EquipmentExtractionTrace, EquipmentPhotoContext } from '../../../../shared/vision/equipmentLabel.ts'
export type VisionCategory =
  | "appliance"
  | "hvac"
  | "water_heater"
  | "boiler"
  | "roof"
  | "electrical_panel"
  | "plumbing"
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
  labelReadability?: LabelReadability
  extractionTrace?: EquipmentExtractionTrace
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
  /** Overall identification confidence, 0–100. */
  overallConfidence?: number
}

export type { EquipmentPhotoContext }

export interface VisionProvider {
  name: VisionProviderName
  analyzeImage(
    imageBase64: string,
    hintCategory?: string,
    mediaType?: string,
    context?: EquipmentPhotoContext,
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
    "labelReadability",
  ],
  properties: {
    labelReadability: {
      type: 'object', additionalProperties: false,
      required: ['status', 'modelConfidence', 'serialConfidence', 'uncertainCharacters', 'retakeRequested', 'formatWarnings'],
      properties: {
        status: { type: 'string', enum: ['readable', 'uncertain', 'unreadable', 'not_visible'] },
        modelConfidence: { type: 'number', minimum: 0, maximum: 100 },
        serialConfidence: { type: 'number', minimum: 0, maximum: 100 },
        uncertainCharacters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'index', 'alternatives'], properties: {
          field: { type: 'string', enum: ['modelNumber', 'serialNumber'] }, index: { type: 'integer', minimum: 0, maximum: 79 }, alternatives: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
        } } },
        readings: { type: 'object', additionalProperties: false, properties: { modelNumber: { type: 'string' }, serialNumber: { type: 'string' } } },
        retakeRequested: { type: 'boolean' }, retakeMessage: { type: 'string' }, formatWarnings: { type: 'array', items: { type: 'string' } },
      },
    },
    category: {
      type: "string",
      enum: ["appliance", "hvac", "water_heater", "boiler", "roof", "electrical_panel", "plumbing", "other", "unknown"],
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
    overallConfidence: { type: "number" },
  },
} as const
