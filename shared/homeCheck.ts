import type { EquipmentExtractionTrace, LabelReadability } from './vision/equipmentLabel.ts'
import { formatLocationWithOptionalUnit } from './properties/unitLabelDisplay.ts'
/** Home Check contract shared by the dashboard, capture page and SMS workflow. */
export const HOME_CHECK_PHOTOS = [
  {
    slot: 'water_heater_label',
    title: 'Water heater label',
    detail: 'Model and serial sticker. Keep the lettering in focus.',
  },
  {
    slot: 'water_heater_whole',
    title: 'Whole water heater, including the base',
    detail: 'Include the base so leaks and rust are visible.',
  },
  {
    slot: 'heating_label',
    title: 'Furnace or boiler label',
    detail: 'Model and serial sticker. Keep the lettering in focus.',
  },
  {
    slot: 'heating_whole',
    title: 'Whole furnace or boiler',
    detail: 'Stand back to show the whole heating system.',
  },
] as const

export type HomeCheckSlot = typeof HOME_CHECK_PHOTOS[number]['slot']
export type HomeCheckRole = 'tenant' | 'contractor' | 'landlord'
export type HomeCheckSystem = 'water_heater' | 'heating'
export type HomeCheckAnswers = {
  warningSigns: boolean | null
  warningDetails: string
  lastService: string
  waterHeaterLastService?: string
  heatingLastService?: string
  lastFilterChange: string
}
export type HomeCheckField = {
  value: string | number | null
  source: HomeCheckRole | 'photo_text'
  capturedBy: HomeCheckRole
  confidence: 'low' | 'medium' | 'high'
  photoIds: string[]
  basis?: string
  estimated?: boolean
}
export type HomeCheckAsset = {
  labelReadability?: LabelReadability
  extractionTrace?: EquipmentExtractionTrace
  system: HomeCheckSystem
  verified: boolean
  manufactureDate?: { year: number | null; month: number | null }
  fields: Record<
    | 'make'
    | 'model'
    | 'serial'
    | 'approximateAge'
    | 'condition'
    | 'lastService'
    | 'lastFilterChange',
    HomeCheckField
  >
}

export function isHomeCheckSlot(value: unknown): value is HomeCheckSlot {
  return HOME_CHECK_PHOTOS.some((photo) => photo.slot === value)
}

export function homeCheckReceivedSlots(slots: readonly string[]): HomeCheckSlot[] {
  return HOME_CHECK_PHOTOS.map((photo) => photo.slot).filter((slot) => slots.includes(slot))
}

export function homeCheckReceivedCount(slots: readonly string[]): number {
  return homeCheckReceivedSlots(slots).length
}

export function homeCheckComplete(slots: readonly string[]): boolean {
  return homeCheckReceivedCount(slots) === HOME_CHECK_PHOTOS.length
}

/** Next baseline slot that does not already have a photo. Order is the four-photo contract. */
export function nextHomeCheckSlot(filled: readonly string[]): HomeCheckSlot | null {
  const have = new Set(homeCheckReceivedSlots(filled))
  return HOME_CHECK_PHOTOS.find((photo) => !have.has(photo.slot))?.slot ?? null
}

/** Explicit commands prevent property names and short replies being guessed as scope. */
export function parseHomeCheckCommand(
  body: string,
): { role: HomeCheckRole; target: string } | null {
  const match = body.trim().match(
    /^(CHECK|INSPECT|INSPECTION|HOME\s+CHECK|START\s+(?:AN?\s+)?INSPECTION)(?:\s+(TENANT|CONTRACTOR|SELF))?(?:\s+(.+))?$/i,
  )
  if (!match) return null
  const target = (match[3] || '').trim()
  return {
    role: match[2]?.toUpperCase() === 'CONTRACTOR'
      ? 'contractor'
      : match[2]?.toUpperCase() === 'SELF'
      ? 'landlord'
      : match[2]?.toUpperCase() === 'TENANT' || match[1].toUpperCase() === 'CHECK'
      ? 'tenant'
      : 'landlord',
    target: match[1].toUpperCase() === 'CHECK' ? target : target.replace(/^for\s+/i, ''),
  }
}

/**
 * Guided SMS start. INSPECT / CHECK keep their shortcut roles.
 * "home check" and "check the equipment" ask who should do it.
 */
export function parseHomeCheckGuideStart(
  body: string,
): { role: HomeCheckRole | null; target: string; window: string | null } | null {
  const trimmed = body.trim()
  const command = parseHomeCheckCommand(trimmed)
  const split = (target: string) => {
    const [place, window] = target.split('|').map((part) => part.trim())
    return { target: place || '', window: window || null }
  }
  if (command && /^(?:INSPECT|INSPECTION|START\s)/i.test(trimmed)) {
    return { role: command.role, ...split(command.target) }
  }
  if (command && /^CHECK\b/i.test(trimmed)) {
    return { role: command.role, ...split(command.target) }
  }
  if (
    command && /^HOME\s+CHECK\b/i.test(trimmed) &&
    /\b(?:TENANT|CONTRACTOR|SELF)\b/i.test(trimmed)
  ) {
    return { role: command.role, ...split(command.target) }
  }
  if (
    /\bhome\s+check\b/i.test(trimmed) ||
    /\bcheck the equipment\b/i.test(trimmed) ||
    /\bequipment check\b/i.test(trimmed)
  ) {
    const target = trimmed
      .replace(/^.*?\bhome\s+check\b/i, '')
      .replace(/^.*?\bcheck the equipment(?:\s+at)?\b/i, '')
      .replace(/^.*?\bequipment check(?:\s+at|\s+for)?\b/i, '')
      .replace(/^[\s,:-]+/, '')
      .trim()
    return { role: null, target, window: null }
  }
  return null
}

/** MMS must name both the check reference and its photo slot; never use the latest job. */
export function parseHomeCheckPhotoReply(
  body: string,
): { reference: string; slot: HomeCheckSlot } | null {
  const match = body.trim().match(/^HC-([A-F0-9]{12})\s+([1-4])$/i)
  if (!match) return null
  return {
    reference: `HC-${match[1].toUpperCase()}`,
    slot: HOME_CHECK_PHOTOS[Number(match[2]) - 1].slot,
  }
}

export function homeCheckReference(id: string): string {
  return `HC-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

export type HomeCheckTarget = {
  propertyId: string
  unitId: string | null
  propertyName: string
  address: string
  unitLabel: string | null
}
export function resolveHomeCheckTarget(
  target: string,
  candidates: HomeCheckTarget[],
): HomeCheckTarget | null {
  const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  const requested = key(target)
  const matches = candidates.filter((row) =>
    [
      row.unitLabel,
      `${row.propertyName}${row.unitLabel ? ` / ${row.unitLabel}` : ''}`,
      `${row.address}${row.unitLabel ? ` / ${row.unitLabel}` : ''}`,
    ].some((label) => label && key(label) === requested)
  )
  return matches.length === 1 ? matches[0] : null
}

type VisionResult = {
  labelReadability?: LabelReadability
  extractionTrace?: EquipmentExtractionTrace
  category: string
  identifiedItem: { type: string; brand?: string; modelNumber?: string; serialNumber?: string }
  manufactureDate?: { year: number | null; month: number | null }
  estimatedAge: { value: number | null; confidence: 'low' | 'medium' | 'high'; basis: string }
  condition: { rating: string; summary: string }
  overallConfidence?: number
}
/** Heating slot accepts the furnace, boiler, heat pump, or indoor air handler. A cooling-only condenser does not. */
export function isHeatingSystemResult(result: {
  category?: string
  identifiedItem?: { type?: string }
} | null): boolean {
  if (!result) return false
  if (result.category === 'boiler') return true
  if (result.category !== 'hvac') return false
  return /furnace|boiler|heat pump|heating|air handler|indoor/i.test(result.identifiedItem?.type || '')
}

export function homeCheckAsset(input: {
  system: HomeCheckSystem
  role: HomeCheckRole
  label: VisionResult | null
  whole: VisionResult | null
  labelPhotoId: string | null
  wholePhotoId: string | null
  answers: HomeCheckAnswers
}): HomeCheckAsset {
  const matches = (result: VisionResult | null) =>
    result &&
      (input.system === 'water_heater'
        ? result.category === 'water_heater'
        : isHeatingSystemResult(result))
      ? result
      : null
  const label = matches(input.label)
  const whole = matches(input.whole)
  const field = (
    value: string | number | null,
    photoId: string | null,
    confidence: HomeCheckField['confidence'] = 'low',
  ): HomeCheckField => ({
    value,
    source: photoId ? 'photo_text' : input.role,
    capturedBy: input.role,
    confidence,
    photoIds: photoId ? [photoId] : [],
  })
  // Never promote a serial-number date estimate into an established manufacture date.
  const identificationConfidence = (label?.overallConfidence ?? 0) >= 85
    ? 'high'
    : (label?.overallConfidence ?? 0) >= 60
    ? 'medium'
    : 'low'
  const age = label?.estimatedAge.value
  return {
    system: input.system,
    labelReadability: label?.labelReadability || input.label?.labelReadability,
    extractionTrace: label?.extractionTrace || input.label?.extractionTrace,
    verified: false,
    ...(label?.manufactureDate &&
      (label.manufactureDate.year != null || label.manufactureDate.month != null)
      ? { manufactureDate: label.manufactureDate }
      : {}),
    fields: {
      make: field(
        label?.identifiedItem.brand || null,
        input.labelPhotoId,
        identificationConfidence,
      ),
      model: field(
        label?.identifiedItem.modelNumber || null,
        input.labelPhotoId,
        label?.labelReadability
          ? (label.labelReadability.modelConfidence >= 85 ? 'high' : 'low')
          : identificationConfidence,
      ),
      serial: field(
        label?.identifiedItem.serialNumber || null,
        input.labelPhotoId,
        label?.labelReadability
          ? (label.labelReadability.serialConfidence >= 85 ? 'high' : 'low')
          : identificationConfidence,
      ),
      approximateAge: {
        ...field(
          age != null && Number.isFinite(age) && age >= 0 && age <= 100 ? age : null,
          input.labelPhotoId,
          label?.estimatedAge.confidence,
        ),
        estimated: true,
        basis: label?.estimatedAge.basis || 'Label unreadable or manufacture date unknown',
      },
      condition: {
        ...field(
          whole ? `${whole.condition.rating}: ${whole.condition.summary}` : null,
          input.wholePhotoId,
          'low',
        ),
        basis: 'Visible condition only; observation is not a functional inspection',
      },
      lastService: {
        ...field(
          (input.system === 'water_heater'
            ? input.answers.waterHeaterLastService
            : input.answers.heatingLastService) || null,
          null,
        ),
        ...(input.answers.lastService
          ? {
            basis:
              `Participant service notes (equipment unspecified): ${input.answers.lastService}`,
          }
          : {}),
      },
      lastFilterChange: field(
        input.system === 'heating' ? input.answers.lastFilterChange || null : null,
        null,
      ),
    },
  }
}

/** Property only for single-family (including the stored "Home" label); "Property · Unit N" otherwise. */
export function formatHomeCheckLocation(
  propertyLabel: string,
  unitLabel?: string | null,
): string {
  return formatLocationWithOptionalUnit({ propertyLabel, unitLabel })
}

const SUPPORTED_PHOTO_WARNING =
  /\b(?:leaks?|leaking|leaked|gas\s+smell|smells?\s+of\s+gas|smelling\s+of\s+gas|smoke|scorch(?:ed|ing|es)?|burning|burned|burns|open\s+flame)\b/i

/** A photo finding may open a follow-up only when it states one of these problems. */
export function supportedHomeCheckPhotoWarning(text: string | null | undefined): string | null {
  const trimmed = text?.replace(/\s+/g, ' ').trim() ?? ''
  if (!trimmed || !SUPPORTED_PHOTO_WARNING.test(trimmed)) return null
  return trimmed.slice(0, 500)
}

export function homeCheckFollowUpReason(input: {
  warningSigns: boolean | null
  warningDetails?: string | null
  detectedWarning?: string | null
}): string | null {
  if (input.warningSigns === true) {
    const detail = input.warningDetails?.trim()
    return detail
      ? `The check reported: ${detail}`
      : 'The check reported a leak, odd noise, or smell.'
  }
  const photo = supportedHomeCheckPhotoWarning(input.detectedWarning)
  if (!photo) return null
  return `A photo showed: ${photo}`
}

export function homeCheckFollowUpExplanation(input: {
  warningSigns?: boolean | null
  warningDetails?: string | null
  detectedWarning?: string | null
}): string {
  const reason = homeCheckFollowUpReason({
    warningSigns: input.warningSigns ?? null,
    warningDetails: input.warningDetails,
    detectedWarning: input.detectedWarning,
  })
  if (reason) {
    return `Follow-up opened because ${reason.charAt(0).toLowerCase()}${reason.slice(1)}. It is on Active Tasks. No vendor is contacted until paid work is approved.`
  }
  return 'Follow-up opened for review. It is on Active Tasks. No vendor is contacted until paid work is approved.'
}

/** Review saved is not the same as a readable plate. Unknown model and serial stay unknown. */
export function homeCheckAssetStatusLabel(asset: {
  verified: boolean
  fields: { model: { value: string | number | null }; serial: { value: string | number | null } }
}): string {
  if (!asset.verified) return 'Unverified'
  const hasPlateText = [asset.fields.model.value, asset.fields.serial.value].some((value) =>
    value != null && String(value).trim() !== ''
  )
  return hasPlateText ? 'Details verified' : 'Review confirmed · details unknown'
}

/** Hide a basis that claims the landlord supplied text when the value is still empty. */
export function homeCheckFieldBasis(field: {
  value: string | number | null
  basis?: string
}): string | null {
  const basis = field.basis?.trim() || ''
  if (!basis) return null
  const empty = field.value == null || String(field.value).trim() === ''
  if (empty && /supplied this text/i.test(basis)) return null
  return basis
}

/** Observation and follow-up tickets keep their own titles instead of a trade inferred from the photo list. */
export function homeCheckWorkOrderTitle(
  description: string | null | undefined,
  issueCategory?: string | null,
): string | null {
  if (issueCategory === 'home_check_warning' || /home check follow-up/i.test(description || '')) {
    return 'Home Check follow-up'
  }
  if (/home check/i.test(description || '') && /observation only/i.test(description || '')) {
    return 'Home Check'
  }
  return null
}

export function homeCheckSummary(assets: HomeCheckAsset[], answers: HomeCheckAnswers): string {
  const describe = (system: HomeCheckSystem, title: string) => {
    const fields = assets.find((asset) => asset.system === system)?.fields
    const age = fields?.approximateAge.value
    return `${title}: ${fields?.make.value || 'make unreadable'}, ${
      age == null ? 'age unknown' : `about ${age} years old`
    }.`
  }
  return `${describe('water_heater', 'Water heater')} ${describe('heating', 'Heating system')} ${
    answers.warningSigns === true
      ? 'Warning signs reported; a follow-up needs review.'
      : answers.warningSigns === false
      ? 'No issues reported.'
      : 'Warning signs not yet reported.'
  }`
}

export type HomeCheckMetricRow = {
  role: HomeCheckRole
  sent_at: string | null
  opened_at: string | null
  completed_at: string | null
  confirmed_at: string | null
  labels_readable: boolean
  issue_ticket_id: string | null
  created_at: string
  approved?: boolean
}
export function homeCheckMetrics(rows: HomeCheckMetricRow[]) {
  return (['tenant', 'contractor', 'landlord'] as const).map((role) => {
    const cohort = rows.filter((row) => row.role === role)
    const completed = cohort.filter((row) => row.completed_at)
    const issues = completed.filter((row) => row.issue_ticket_id)
    return {
      role,
      sent: cohort.filter((row) => row.sent_at).length,
      opened: cohort.filter((row) => row.opened_at).length,
      completed: completed.length,
      labelReadable: completed.filter((row) => row.labels_readable).length,
      confirmed: cohort.filter((row) => row.confirmed_at).length,
      averageMinutes: completed.length
        ? completed.reduce(
          (sum, row) =>
            sum +
            Math.max(
              0,
              (Date.parse(row.completed_at!) - Date.parse(row.sent_at || row.created_at)) / 60000,
            ),
          0,
        ) / completed.length
        : null,
      issueShare: completed.length ? issues.length / completed.length : null,
      approvedJobShare: issues.length
        ? issues.filter((row) => row.approved).length / issues.length
        : null,
    }
  })
}

export function nearestHomeCheckVendors<
  T extends { id: string; latitude: number | null; longitude: number | null },
>(property: { latitude: number | null; longitude: number | null }, vendors: T[]) {
  const valid = (lat: number | null, lng: number | null) =>
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  if (!valid(property.latitude, property.longitude)) return []
  const rad = (n: number) => n * Math.PI / 180
  return vendors.filter((vendor) => valid(vendor.latitude, vendor.longitude)).map((vendor) => {
    const a = Math.sin(rad(vendor.latitude! - property.latitude!) / 2) ** 2 +
      Math.cos(rad(property.latitude!)) * Math.cos(rad(vendor.latitude!)) *
        Math.sin(rad(vendor.longitude! - property.longitude!) / 2) ** 2
    return {
      ...vendor,
      distanceKm: 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))),
    }
  }).sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id))
}
