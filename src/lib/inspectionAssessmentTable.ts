import type { ApplianceVisionResult, ConditionRating, VisionCategory } from '@/lib/vision/types'

const CATEGORY_LABELS: Record<VisionCategory, string> = {
  appliance: 'Appliance',
  hvac: 'HVAC',
  water_heater: 'Water heater',
  boiler: 'Boiler',
  roof: 'Roof',
  other: 'Other',
  unknown: 'Unknown',
}

const CONDITION_LABELS: Record<ConditionRating, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  unsafe: 'Unsafe',
}

export function assessmentCategoryLabel(category: VisionCategory): string {
  return CATEGORY_LABELS[category] ?? 'Unknown'
}

export function assessmentConditionLabel(rating: ConditionRating): string {
  return CONDITION_LABELS[rating] ?? rating
}

export function assessmentBrandModel(result: ApplianceVisionResult): string {
  const brand = result.identifiedItem.brand?.trim() || 'Unknown'
  const model = result.identifiedItem.modelNumber?.trim() || '-'
  return `${brand} / ${model}`
}

export function assessmentDescription(result: ApplianceVisionResult): string {
  const summary = result.condition.summary.trim()
  if (summary) return summary
  const type = result.identifiedItem.type.trim()
  return type || '—'
}

export function assessmentSerial(result: ApplianceVisionResult): string {
  return result.identifiedItem.serialNumber?.trim() ?? ''
}

const AGE_BAND_PERCENT: Record<ApplianceVisionResult['estimatedAge']['confidence'], number> = {
  high: 90,
  medium: 65,
  low: 40,
}

export function assessmentConfidencePercent(result: ApplianceVisionResult): number {
  const raw = result.overallConfidence
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 0 && raw <= 1) return Math.round(raw * 100)
    return Math.min(100, Math.max(0, Math.round(raw)))
  }
  return AGE_BAND_PERCENT[result.estimatedAge.confidence]
}

export function assessmentConfidenceReason(result: ApplianceVisionResult): string {
  const notes = result.rawConfidenceNotes?.trim()
  if (notes) return notes
  const basis = result.estimatedAge.basis.trim()
  if (basis && basis.toLowerCase() !== 'not specified') return basis
  return 'Identification is based on what is visible in this photo.'
}

export function parseBrandModelField(value: string): { brand: string; modelNumber: string } {
  const trimmed = value.trim()
  const sep = trimmed.indexOf(' / ')
  if (sep < 0) {
    return { brand: trimmed, modelNumber: '' }
  }
  return {
    brand: trimmed.slice(0, sep).trim(),
    modelNumber: trimmed.slice(sep + 3).trim(),
  }
}

const ACTION_PRIORITY = [
  'safety_hazard',
  'repair_recommended',
  'monitor',
  'cosmetic',
] as const

const ACTION_LABELS: Record<(typeof ACTION_PRIORITY)[number], string> = {
  safety_hazard: 'Safety hazard',
  repair_recommended: 'Repair recommended',
  monitor: 'Monitor',
  cosmetic: 'Cosmetic',
}

export function assessmentActionSeverity(
  result: ApplianceVisionResult,
): (typeof ACTION_PRIORITY)[number] {
  const found = new Set(result.deficiencies.map((d) => d.severity))
  for (const severity of ACTION_PRIORITY) {
    if (found.has(severity)) return severity
  }
  return 'monitor'
}

export function assessmentActionLabel(result: ApplianceVisionResult): string {
  return ACTION_LABELS[assessmentActionSeverity(result)]
}

const VISION_CATEGORIES: VisionCategory[] = [
  'appliance',
  'hvac',
  'water_heater',
  'boiler',
  'roof',
  'other',
  'unknown',
]

function asVisionCategory(value: unknown): VisionCategory {
  return VISION_CATEGORIES.includes(value as VisionCategory)
    ? (value as VisionCategory)
    : 'other'
}

const CONDITION_RATINGS: ConditionRating[] = ['good', 'fair', 'poor', 'unsafe']

function asConditionRating(value: unknown): ConditionRating {
  return CONDITION_RATINGS.includes(value as ConditionRating)
    ? (value as ConditionRating)
    : 'fair'
}

/** Rebuild a review-table row from a saved unit_assets record. */
export function visionResultFromSavedInspectionAsset(asset: {
  appliance_type: string
  brand: string | null
  model: string | null
  metadata: Record<string, unknown> | null
}): ApplianceVisionResult {
  const meta = asset.metadata ?? {}
  const raw = meta.rawAiResult
  if (raw && typeof raw === 'object' && raw !== null && 'identifiedItem' in raw) {
    return raw as ApplianceVisionResult
  }
  const deficiencies = Array.isArray(meta.deficiencies)
    ? (meta.deficiencies as ApplianceVisionResult['deficiencies'])
    : []
  const maintenanceRecommendations = Array.isArray(meta.maintenanceRecommendations)
    ? (meta.maintenanceRecommendations as ApplianceVisionResult['maintenanceRecommendations'])
    : []
  return {
    category: asVisionCategory(meta.category),
    identifiedItem: {
      type: asset.appliance_type || 'Equipment',
      brand: asset.brand ?? undefined,
      modelNumber: asset.model ?? undefined,
      serialNumber:
        typeof meta.serialNumber === 'string' ? meta.serialNumber : undefined,
    },
    estimatedAge: {
      value: null,
      confidence: 'medium',
      basis:
        typeof meta.rawConfidenceNotes === 'string' ? meta.rawConfidenceNotes : '',
    },
    condition: {
      rating: asConditionRating(meta.conditionRating),
      summary:
        typeof meta.conditionSummary === 'string'
          ? meta.conditionSummary
          : asset.appliance_type,
    },
    deficiencies,
    maintenanceRecommendations,
    rawConfidenceNotes:
      typeof meta.rawConfidenceNotes === 'string' ? meta.rawConfidenceNotes : undefined,
  }
}

/** One table row per detected item. Document extracts may pack several items on one photo. */
export function visionResultsFromInspectionPhoto(photo: {
  aiResult?: ApplianceVisionResult | null
  confirmedResult?: ApplianceVisionResult | null
}): ApplianceVisionResult[] {
  const primary = photo.confirmedResult ?? photo.aiResult ?? null
  const packed = photo.aiResult as (ApplianceVisionResult & { _extractedItems?: unknown }) | null
  const extras = packed?._extractedItems
  if (Array.isArray(extras) && extras.length > 0) {
    return extras.map((item, index) =>
      index === 0 && primary
        ? primary
        : (item as ApplianceVisionResult),
    )
  }
  return primary ? [primary] : []
}
