import type { ApplianceVisionResult, DibIdentification, VisionCategory } from "./types.ts"

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeConfidence(raw: number | null): number | null {
  if (raw == null) return null
  if (raw > 1) return Math.min(1, Math.max(0, raw / 100))
  return Math.min(1, Math.max(0, raw))
}

/** Map Dib inventory category labels onto Ulo vision categories. */
export function mapDibCategoryToVisionCategory(
  category: string | null | undefined,
  subCategory?: string | null,
  name?: string | null,
): VisionCategory {
  const parts = [category, subCategory, name]
    .map((v) => asString(v).toLowerCase())
    .filter(Boolean)
    .join(" ")

  if (!parts) return "unknown"

  if (parts.includes("boiler") || parts.includes("combi")) return "boiler"
  if (
    parts.includes("water heater") ||
    parts.includes("water-heater") ||
    parts.includes("waterheater") ||
    parts.includes("tankless") ||
    (parts.includes("heater") && !parts.includes("space"))
  ) {
    return "water_heater"
  }
  if (
    parts.includes("hvac") ||
    parts.includes("furnace") ||
    parts.includes("condenser") ||
    parts.includes("heat pump") ||
    parts.includes("air condition") ||
    parts.includes("air handler")
  ) {
    return "hvac"
  }
  if (parts.includes("roof") || parts.includes("shingle") || parts.includes("gutter")) {
    return "roof"
  }
  if (
    parts.includes("appliance") ||
    parts.includes("dishwasher") ||
    parts.includes("refrigerator") ||
    parts.includes("washer") ||
    parts.includes("dryer") ||
    parts.includes("range") ||
    parts.includes("oven") ||
    parts.includes("microwave")
  ) {
    return "appliance"
  }
  if (parts.includes("plumbing") || parts.includes("electrical") || parts.includes("system")) {
    return "other"
  }
  return "unknown"
}

type RawRecord = Record<string, unknown>

function unwrapDibItem(raw: unknown): RawRecord | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as RawRecord
  if (record.item && typeof record.item === "object") return record.item as RawRecord
  if (record.inventory_item && typeof record.inventory_item === "object") {
    return record.inventory_item as RawRecord
  }
  if (record.data && typeof record.data === "object") return record.data as RawRecord
  return record
}

function pickConfidence(record: RawRecord): number | null {
  for (const key of [
    "confidence",
    "confidence_score",
    "score",
    "extraction_confidence",
    "match_confidence",
  ]) {
    const normalized = normalizeConfidence(asNumber(record[key]))
    if (normalized != null) return normalized
  }
  return null
}

function collectCandidateLists(payload: unknown): unknown[] {
  const root = (payload && typeof payload === "object" ? payload : {}) as RawRecord
  const data =
    root.data && typeof root.data === "object" ? (root.data as RawRecord) : root
  const lists: unknown[] = []

  for (const source of [data, root]) {
    for (const key of [
      "candidates",
      "items",
      "saved",
      "saved_items",
      "results",
      "detected_items",
      "inventory_items",
    ]) {
      const value = source[key]
      if (Array.isArray(value)) lists.push(...value)
    }
  }

  if (unwrapDibItem(data)?.name || unwrapDibItem(data)?.brand) {
    lists.unshift(data)
  }

  return lists
}

function dibItemToIdentification(
  item: RawRecord,
  confidence: number | null,
): DibIdentification | null {
  const name = asString(item.name) || asString(item.title) || asString(item.type)
  const brand = asString(item.brand) || undefined
  const modelNumber =
    asString(item.model) ||
    asString(item.model_number) ||
    asString(item.modelNumber) ||
    undefined
  const serialNumber =
    asString(item.serial_number) ||
    asString(item.serialNumber) ||
    undefined
  const dibCategory = asString(item.category) || null
  const dibSubCategory = asString(item.sub_category) || asString(item.subCategory) || null
  const category = mapDibCategoryToVisionCategory(dibCategory, dibSubCategory, name)
  const type = name || brand || modelNumber || "Identified item"

  if (!name && !brand && !modelNumber && !serialNumber && category === "unknown") {
    return null
  }

  return {
    category,
    type,
    brand,
    modelNumber,
    serialNumber,
    confidence,
    dibItemId: asString(item.id) || undefined,
    dibCategory,
    dibSubCategory,
  }
}

/** Parse Dib smart-add JSON and pick the best candidate above threshold (0–100). */
export function parseDibSmartAddResponse(
  payload: unknown,
  confidenceThresholdPercent = 75,
): DibIdentification | null {
  const threshold = normalizeConfidence(confidenceThresholdPercent) ?? 0.75
  const scored: Array<{ identification: DibIdentification; confidence: number }> = []

  for (const entry of collectCandidateLists(payload)) {
    const wrapper = entry && typeof entry === "object" ? (entry as RawRecord) : null
    const item = unwrapDibItem(entry)
    if (!item) continue

    const confidence =
      pickConfidence(wrapper ?? {}) ??
      pickConfidence(item) ??
      null

    const identification = dibItemToIdentification(item, confidence)
    if (!identification) continue

    if (confidence == null || confidence >= threshold) {
      scored.push({
        identification,
        confidence: confidence ?? threshold,
      })
    }
  }

  if (!scored.length) return null
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored[0]!.identification
}

export function mergeDibIdentificationWithVisionAssessment(
  dib: DibIdentification | null,
  vision: ApplianceVisionResult,
): ApplianceVisionResult {
  if (!dib) return vision

  const notes = [
    vision.rawConfidenceNotes,
    dib.confidence != null
      ? `Dib identification (${Math.round(dib.confidence * 100)}% confidence).`
      : "Dib identification applied.",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    ...vision,
    category: dib.category !== "unknown" ? dib.category : vision.category,
    identifiedItem: {
      ...vision.identifiedItem,
      type: dib.type || vision.identifiedItem.type,
      brand: dib.brand || vision.identifiedItem.brand,
      modelNumber: dib.modelNumber || vision.identifiedItem.modelNumber,
      serialNumber: dib.serialNumber || vision.identifiedItem.serialNumber,
    },
    rawConfidenceNotes: notes,
  }
}

export function buildHybridVisionProviderLabel(visionProvider: string): string {
  const base = visionProvider.trim() || "gpt4o"
  return `dib+${base}`
}
