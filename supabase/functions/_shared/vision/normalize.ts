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
    v === "electrical_panel" ||
    v === "plumbing" ||
    v === "other" ||
    v === "unknown"
  ) {
    return v
  }
  const lower = v.toLowerCase()
  if (lower.includes("electrical") && (lower.includes("panel") || lower.includes("breaker"))) {
    return "electrical_panel"
  }
  if (lower === "electrical") return "electrical_panel"
  if (lower.includes("plumb") || lower.includes("supply line") || lower.includes("drain")) {
    return "plumbing"
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

function percentFromAgeBand(confidence: AgeConfidence): number {
  if (confidence === "high") return 90
  if (confidence === "medium") return 65
  return 40
}

function asOverallConfidence(value: unknown, ageBand: AgeConfidence): number {
  const n = asNumberOrNull(value)
  if (n == null) return percentFromAgeBand(ageBand)
  if (n >= 0 && n <= 1) return Math.round(n * 100)
  return Math.min(100, Math.max(0, Math.round(n)))
}

function asCondition(value: unknown): ConditionRating {
  const v = asString(value).toLowerCase()
  if (v === "good" || v === "satisfactory") return "good"
  if (v === "fair" || v === "poor" || v === "unsafe") return v
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
  const identifiedRaw = o.identifiedItem ?? o.identified_item
  const item =
    identifiedRaw && typeof identifiedRaw === "object"
      ? (identifiedRaw as Record<string, unknown>)
      : typeof identifiedRaw === "string"
        ? { type: identifiedRaw }
        : {}
  const ageRaw = o.estimatedAge ?? o.estimated_age ?? o.age
  const age =
    ageRaw && typeof ageRaw === "object"
      ? (ageRaw as Record<string, unknown>)
      : typeof ageRaw === "number" && Number.isFinite(ageRaw)
        ? { value: ageRaw, confidence: "medium", basis: "Report stated age" }
        : typeof o.ageYears === "number" || typeof o.estimated_age_years === "number"
          ? {
              value: o.ageYears ?? o.estimated_age_years,
              confidence: "medium",
              basis: "Report stated age",
            }
          : {}
  const condition =
    o.condition && typeof o.condition === "object"
      ? (o.condition as Record<string, unknown>)
      : typeof o.condition === "string"
        ? { rating: o.condition }
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

  const brand = asString(item.brand) || asString(o.brand)
  const modelNumber = asString(item.modelNumber)
  const serialNumber = asString(item.serialNumber)
  const fuelType = asFuelType(item.fuelType)
  const btuOutput = asNumberOrNull(item.btuOutput)
  const notes = asString(o.rawConfidenceNotes)
  const category = asCategory(o.category)
  const typeFallback =
    category === "electrical_panel"
      ? "Electrical panel"
      : category === "hvac"
        ? "HVAC system"
        : category === "water_heater"
          ? "Water heater"
          : category === "boiler"
            ? "Boiler"
            : category === "roof"
              ? "Roof"
              : category === "plumbing"
                ? "Plumbing system"
                : ""
  const ageConfidence = asConfidence(age.confidence)
  const overallConfidence = asOverallConfidence(o.overallConfidence ?? o.overall_confidence, ageConfidence)

  return {
    category,
    identifiedItem: {
      type:
        asString(item.type) ||
        asString(item.name) ||
        asString(o.type) ||
        asString(o.itemType) ||
        asString(o.name) ||
        typeFallback ||
        "Unknown item",
      ...(brand ? { brand } : {}),
      ...(modelNumber ? { modelNumber } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      ...(category === "boiler" && fuelType ? { fuelType } : {}),
      ...(category === "boiler" && btuOutput != null ? { btuOutput } : {}),
    },
    estimatedAge: {
      value: asNumberOrNull(age.value),
      confidence: ageConfidence,
      basis: asString(age.basis) || "Not specified",
    },
    condition: {
      rating: asCondition(condition.rating),
      summary: asString(condition.summary) || "Condition not assessed from image.",
    },
    deficiencies,
    maintenanceRecommendations,
    overallConfidence,
    ...(notes ? { rawConfidenceNotes: notes } : {}),
  }
}

export function normalizeInspectionPropertyAddress(raw: unknown): {
  street: string
  city: string
  state: string
  zip: string
  raw: string
} {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const str = (key: string) => (typeof o[key] === "string" ? o[key].trim() : "")
  return {
    street: str("street"),
    city: str("city"),
    state: str("state"),
    zip: str("zip"),
    raw: str("raw") || [str("street"), str("city"), str("state"), str("zip")].filter(Boolean).join(", "),
  }
}

export function normalizeInspectionReportExtract(raw: unknown): {
  propertyAddress: ReturnType<typeof normalizeInspectionPropertyAddress>
  items: ApplianceVisionResult[]
} {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const address = normalizeInspectionPropertyAddress(o.propertyAddress ?? o.address ?? o.property_address)
  const itemSource = o.items ?? o.findings ?? o.systems ?? o.equipment ?? o.assets
  return {
    propertyAddress: address,
    items: normalizeApplianceVisionResultList(itemSource ?? o),
  }
}

/** Predominant vs secondary covering — a 4-point form has at most two roofs. */
export function roofCoveringIdentity(itemType: string | null | undefined): "secondary" | "predominant" {
  const t = (itemType ?? "").trim().toLowerCase()
  if (/\b(second(ary)?|other covering|additional roof)\b/.test(t)) return "secondary"
  return "predominant"
}

export function inspectionFindingMergeKey(item: ApplianceVisionResult): string {
  const type = (item.identifiedItem.type ?? "").trim().toLowerCase()
  if (item.category === "roof" || /\broof\b/.test(type)) {
    return `roof:${roofCoveringIdentity(type)}`
  }
  if (item.category === "electrical_panel" || type.includes("panel")) {
    if (/\b(second|sub-?panel|auxiliary)\b/.test(type)) return "electrical_panel:secondary"
    return "electrical_panel:main"
  }
  if (
    item.category === "hvac" ||
    item.category === "water_heater" ||
    item.category === "plumbing" ||
    item.category === "boiler"
  ) {
    return item.category
  }
  return `${item.category}:${type}`
}

function inspectionItemSpecificity(item: ApplianceVisionResult): number {
  let score = item.overallConfidence ?? 0
  if (item.identifiedItem.brand?.trim()) score += 20
  if (item.estimatedAge.value != null) score += 20
  score += Math.min(40, (item.identifiedItem.type ?? "").trim().length)
  return score
}

/** Combine per-page extract calls into one report (later pages must not be dropped). */
export function mergeInspectionReportExtracts(
  parts: Array<ReturnType<typeof normalizeInspectionReportExtract>>,
): ReturnType<typeof normalizeInspectionReportExtract> {
  const propertyAddress =
    parts.find((part) => part.propertyAddress.street || part.propertyAddress.raw)?.propertyAddress ??
    parts[0]?.propertyAddress ??
    normalizeInspectionPropertyAddress({})
  const byKey = new Map<string, ApplianceVisionResult>()
  const order: string[] = []
  for (const part of parts) {
    for (const item of part.items) {
      const key = inspectionFindingMergeKey(item)
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, item)
        order.push(key)
        continue
      }
      if (inspectionItemSpecificity(item) > inspectionItemSpecificity(existing)) {
        byKey.set(key, item)
      }
    }
  }
  return { propertyAddress, items: order.map((key) => byKey.get(key)!) }
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
    if (Array.isArray(o.findings)) {
      return o.findings.map((item) => normalizeApplianceVisionResult(item))
    }
    if ("identifiedItem" in o || "identified_item" in o || "category" in o || "type" in o) {
      if (!("street" in o || "propertyAddress" in o)) {
        return [normalizeApplianceVisionResult(o)]
      }
    }
    const nested = Object.entries(o)
      .filter(([key, value]) => {
        if (key === "propertyAddress" || key === "address" || key === "property_address") return false
        return Boolean(value) && typeof value === "object" && !Array.isArray(value)
      })
      .map(([, value]) => value as Record<string, unknown>)
      .filter((row) =>
        "identifiedItem" in row ||
        "identified_item" in row ||
        "category" in row ||
        "type" in row
      )
    if (nested.length > 0) {
      return nested.map((item) => normalizeApplianceVisionResult(item))
    }
  }
  return []
}
