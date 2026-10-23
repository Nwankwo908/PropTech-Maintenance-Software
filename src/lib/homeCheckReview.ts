import type { ApplianceVisionResult, ConditionRating } from '@/lib/vision/types'
import {
  homeCheckAssetStatusLabel,
  homeCheckFieldBasis,
  type HomeCheckAsset,
  type HomeCheckField,
} from '@shared/homeCheck'

export const HOME_CHECK_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const CONFIDENCE_PERCENT = { high: 90, medium: 65, low: 40 } as const

export type HomeCheckLabelDraft = {
  modelNumber: string
  serialNumber: string
  manufactureMonth: string
  manufactureYear: string
}

export type HomeCheckManufactureDate = { year: number | null; month: number | null }

function fieldText(field: HomeCheckField | undefined): string {
  if (field?.value == null) return ''
  return String(field.value).trim()
}

function lowestConfidence(fields: HomeCheckField[]): HomeCheckField['confidence'] {
  const rank = { low: 0, medium: 1, high: 2 }
  return fields.reduce<HomeCheckField['confidence']>(
    (lowest, field) => (rank[field.confidence] < rank[lowest] ? field.confidence : lowest),
    'high',
  )
}

/** One tooltip for the row. Source and basis are not repeated on every field. */
export function homeCheckConfidenceNote(asset: HomeCheckAsset): string {
  const plate = [asset.fields.make, asset.fields.model, asset.fields.serial]
  const known = plate.some((field) => fieldText(field))
  const confidence = lowestConfidence(plate)
  const level = `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`
  const photo = plate.every((field) => field.source === 'photo_text')
  const entered = plate.every((field) => field.source !== 'photo_text')
  const source = photo
    ? 'Read from the photo'
    : entered
    ? 'Entered during the check'
    : 'Read from the photo and the check notes'
  const bases = [
    ...new Set(
      [asset.fields.approximateAge, asset.fields.condition, ...plate]
        .map((field) => homeCheckFieldBasis(field))
        .filter((basis): basis is string => Boolean(basis)),
    ),
  ].slice(0, 2)
  const lead = known
    ? `${source}. ${level}.`
    : 'Make, model, and serial are unknown until the label can be read.'
  return [
    lead,
    ...bases.map((basis) => (basis.endsWith('.') ? basis : `${basis}.`)),
    'Age stays an estimate until the manufacture date is confirmed.',
  ].join(' ')
}

export function homeCheckManufactureLabel(date?: HomeCheckManufactureDate | null): string {
  const month = date?.month && date.month >= 1 && date.month <= 12
    ? HOME_CHECK_MONTHS[date.month - 1]
    : null
  const year = date?.year && date.year >= 1900 && date.year <= 2100 ? date.year : null
  if (month && year) return `Made ${month} ${year}`
  if (year) return `Made ${year}`
  if (month) return `Made in ${month}`
  return 'Manufacture date unknown'
}

export function homeCheckLabelDraft(asset: HomeCheckAsset): HomeCheckLabelDraft {
  return {
    modelNumber: fieldText(asset.fields.model),
    serialNumber: fieldText(asset.fields.serial),
    manufactureMonth: asset.manufactureDate?.month ? String(asset.manufactureDate.month) : '',
    manufactureYear: asset.manufactureDate?.year ? String(asset.manufactureDate.year) : '',
  }
}

/** Omit blank dates so an unchanged confirm still sends only the plate text. */
export function homeCheckLabelCorrection(assetId: string, draft: HomeCheckLabelDraft) {
  const correction: {
    assetId: string
    modelNumber: string
    serialNumber: string
    manufactureYear?: number
    manufactureMonth?: number
  } = {
    assetId,
    modelNumber: draft.modelNumber,
    serialNumber: draft.serialNumber,
  }
  if (/^\d{4}$/.test(draft.manufactureYear.trim())) {
    correction.manufactureYear = Number(draft.manufactureYear)
  }
  if (/^(?:[1-9]|1[0-2])$/.test(draft.manufactureMonth.trim())) {
    correction.manufactureMonth = Number(draft.manufactureMonth)
  }
  return correction
}

function conditionDisplay(asset: HomeCheckAsset): {
  rating: ConditionRating
  label: string
  summary: string
} {
  const raw = fieldText(asset.fields.condition)
  const match = raw.match(/^(good|fair|poor|unsafe)\s*:\s*(.*)$/i)
  const labels: Record<ConditionRating, string> = {
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
    unsafe: 'Unsafe',
  }
  const rating = (match ? match[1].toLowerCase() : 'fair') as ConditionRating
  const summaryParts: string[] = []
  const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)
  if (match?.[2]?.trim()) summaryParts.push(sentence(match[2].trim()))
  else if (raw && !match) summaryParts.push(sentence(raw))
  else summaryParts.push('Visible condition unknown.')
  const age = asset.fields.approximateAge.value
  summaryParts.push(
    typeof age === 'number' && Number.isFinite(age)
      ? `About ${age} years (estimate).`
      : 'Age unknown.',
  )
  const service = fieldText(asset.fields.lastService)
  if (service) summaryParts.push(`Last service: ${service}.`)
  const filter = fieldText(asset.fields.lastFilterChange)
  if (filter) summaryParts.push(`Last filter change: ${filter}.`)
  return {
    rating,
    label: match ? labels[rating] : 'Unknown',
    summary: summaryParts.join(' '),
  }
}

export function homeCheckAssetPreview(
  system: HomeCheckAsset['system'],
  photos: Array<{ slot: string; previewUrl: string | null }>,
): string | null {
  const whole = system === 'water_heater' ? 'water_heater_whole' : 'heating_whole'
  const label = system === 'water_heater' ? 'water_heater_label' : 'heating_label'
  return photos.find((photo) => photo.slot === whole && photo.previewUrl)?.previewUrl
    || photos.find((photo) => photo.slot === label && photo.previewUrl)?.previewUrl
    || null
}

export function homeCheckReviewResult(
  asset: HomeCheckAsset,
  draft?: HomeCheckLabelDraft,
): ApplianceVisionResult {
  const plate = [asset.fields.make, asset.fields.model, asset.fields.serial]
  const confidence = lowestConfidence(plate)
  const condition = conditionDisplay(asset)
  const model = draft ? draft.modelNumber : fieldText(asset.fields.model)
  const serial = draft ? draft.serialNumber : fieldText(asset.fields.serial)
  const brand = fieldText(asset.fields.make)
  return {
    category: asset.system === 'water_heater' ? 'water_heater' : 'hvac',
    identifiedItem: {
      type: asset.system === 'water_heater' ? 'Water heater' : 'Heating system',
      ...(brand ? { brand } : {}),
      ...(model ? { modelNumber: model } : {}),
      ...(serial ? { serialNumber: serial } : {}),
    },
    estimatedAge: {
      value: typeof asset.fields.approximateAge.value === 'number'
        ? asset.fields.approximateAge.value
        : null,
      confidence,
      basis: homeCheckFieldBasis(asset.fields.approximateAge)
        || 'Label unreadable or manufacture date unknown',
    },
    condition: { rating: condition.rating, summary: condition.summary },
    deficiencies: [],
    maintenanceRecommendations: [],
    rawConfidenceNotes: homeCheckConfidenceNote(asset),
    overallConfidence: CONFIDENCE_PERCENT[confidence],
    ...(asset.labelReadability ? { labelReadability: asset.labelReadability } : {}),
    ...(asset.extractionTrace ? { extractionTrace: asset.extractionTrace } : {}),
  }
}

export function homeCheckReviewLabels(asset: HomeCheckAsset) {
  const condition = conditionDisplay(asset)
  return {
    categoryLabel: asset.system === 'water_heater' ? 'Water heater' : 'Heating system',
    conditionLabel: condition.label,
    actionLabel: homeCheckAssetStatusLabel(asset),
    manufactureLabel: homeCheckManufactureLabel(asset.manufactureDate),
  }
}
