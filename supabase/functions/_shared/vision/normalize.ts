import type {
  AgeConfidence,
  ApplianceVisionResult,
  BoilerFuelType,
  ConditionRating,
  DeficiencySeverity,
  RecommendationUrgency,
  VisionCategory,
} from "./types.ts"

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function asCategory(value: unknown): VisionCategory {
  const v = asString(value)
  if (
    v === "appliance" ||
    v === "hvac" ||
    v === "water_heater" ||
    v === "boiler" ||
    v === "roof" ||
    v === "other" ||
    v === "unknown"
  ) {
    return v
  }
  return "unknown"
}

function asFuelType(value: unknown): BoilerFuelType | undefined {
  const v = asString(value).toLowerCase()
  if (
    v === "gas" ||
    v === "oil" ||
    v === "electric" ||
    v === "propane" ||
    v === "unknown"
  ) {
    return v
  }
  return undefined
}

function asConfidence(value: unknown): AgeConfidence {
  const v = asString(value)
  if (v === "low" || v === "medium" || v === "high") return v
  return "low"
}

function asCondition(value: unknown): ConditionRating {
  const v = asString(value)
  if (v === "good" || v === "fair" || v === "poor" || v === "unsafe") return v
  return "fair"
}

function asSeverity(value: unknown): DeficiencySeverity {
  const v = asString(value)
  if (
    v === "cosmetic" ||
    v === "monitor" ||
    v === "repair_recommended" ||
    v === "safety_hazard"
  ) {
    return v
  }
  return "monitor"
}

function asUrgency(value: unknown): RecommendationUrgency {
  const v = asString(value)
  if (v === "routine" || v === "near_term" || v === "immediate") return v
  return "routine"
}

/** Coerce model JSON into ApplianceVisionResult. */
export function normalizeApplianceVisionResult(raw: unknown): ApplianceVisionResult {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const item =
    o.identifiedItem && typeof o.identifiedItem === "object"
      ? (o.identifiedItem as Record<string, unknown>)
      : {}
  const age =
    o.estimatedAge && typeof o.estimatedAge === "object"
      ? (o.estimatedAge as Record<string, unknown>)
      : {}
  const condition =
    o.condition && typeof o.condition === "object"
      ? (o.condition as Record<string, unknown>)
      : {}

  const deficiencies = Array.isArray(o.deficiencies)
    ? o.deficiencies
        .filter((d): d is Record<string, unknown> => d != null && typeof d === "object")
        .map((d) => ({
          description: asString(d.description) || "Unspecified deficiency",
          severity: asSeverity(d.severity),
          ...(asString(d.location) ? { location: asString(d.location) } : {}),
        }))
    : []

  const maintenanceRecommendations = Array.isArray(o.maintenanceRecommendations)
    ? o.maintenanceRecommendations
        .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
        .map((r) => {
          const months = asNumberOrNull(r.suggestedIntervalMonths)
          return {
            action: asString(r.action) || "Schedule preventive service",
            urgency: asUrgency(r.urgency),
            ...(months != null && months > 0
              ? { suggestedIntervalMonths: Math.round(months) }
              : {}),
          }
        })
    : []

  const brand = asString(item.brand)
  const modelNumber = asString(item.modelNumber)
  const serialNumber = asString(item.serialNumber)
  const fuelType = asFuelType(item.fuelType)
  const btuOutput = asNumberOrNull(item.btuOutput)
  const notes = asString(o.rawConfidenceNotes)
  const category = asCategory(o.category)

  return {
    category,
    identifiedItem: {
      type: asString(item.type) || "Unknown item",
      ...(brand ? { brand } : {}),
      ...(modelNumber ? { modelNumber } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      ...(category === "boiler" && fuelType ? { fuelType } : {}),
      ...(category === "boiler" && btuOutput != null ? { btuOutput } : {}),
    },
    estimatedAge: {
      value: asNumberOrNull(age.value),
      confidence: asConfidence(age.confidence),
      basis: asString(age.basis) || "Not specified",
    },
    condition: {
      rating: asCondition(condition.rating),
      summary: asString(condition.summary) || "Condition not assessed from image.",
    },
    deficiencies,
    maintenanceRecommendations,
    ...(notes ? { rawConfidenceNotes: notes } : {}),
  }
}

export function normalizeApplianceVisionResultList(raw: unknown): ApplianceVisionResult[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeApplianceVisionResult(item))
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.items)) {
      return o.items.map((item) => normalizeApplianceVisionResult(item))
    }
    if ("identifiedItem" in o || "category" in o) {
      return [normalizeApplianceVisionResult(o)]
    }
  }
  return []
}
