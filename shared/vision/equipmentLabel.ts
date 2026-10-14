export type LabelField = 'modelNumber' | 'serialNumber'
export type LabelReadability = {
  status: 'readable' | 'uncertain' | 'unreadable' | 'not_visible'
  modelConfidence: number
  serialConfidence: number
  uncertainCharacters: Array<{
    field: LabelField
    index: number
    alternatives: string[]
  }>
  readings?: Partial<Record<LabelField, string>>
  retakeRequested: boolean
  retakeMessage?: string
  formatWarnings: string[]
}
export type EquipmentExtractionTrace = {
  selectedProvider: 'gemini' | 'claude'
  selectedModel: string
  attempts: Array<{ provider: 'gemini' | 'claude'; model: string; outcome: string }>
  fallbackReason?: string
}
export type EquipmentPhotoContext = {
  purpose?: 'label' | 'overview' | 'general'
  referenceImages?: Array<{ imageBase64: string; mediaType: string; purpose: 'label' | 'overview' }>
}
export const EQUIPMENT_PHOTO_TIPS = [
  'Take two photos per appliance: the whole appliance and a close-up of its data plate.',
  'Fill the frame with the label, keep it in focus, and avoid glare or flash.',
  'If the label is unreadable, send a closer photo without flash. Missing numbers stay unknown.',
  'Check flagged characters such as 0 / O and 8 / B before confirming the record.',
] as const
export const LABEL_RETAKE_MESSAGE = 'Label unreadable, please send a closer photo without flash.'

export type ManufacturerSerialRule = {
  manufacturer: string
  category?: string
  pattern: string
  description: string
  source: string
}
type LabelResult = {
  category: string
  identifiedItem: { brand?: string; modelNumber?: string; serialNumber?: string }
  estimatedAge: { value: number | null; confidence: 'low' | 'medium' | 'high'; basis: string }
  labelReadability?: LabelReadability
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const percent = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0

export function normalizeLabelReadability(raw: unknown): LabelReadability | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const statuses = ['readable', 'uncertain', 'unreadable', 'not_visible']
  const status = statuses.includes(String(input.status))
    ? input.status as LabelReadability['status']
    : 'unreadable'
  const uncertainCharacters: LabelReadability['uncertainCharacters'] = []
  for (
    const value of Array.isArray(input.uncertainCharacters)
      ? input.uncertainCharacters.slice(0, 80)
      : []
  ) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (!['modelNumber', 'serialNumber'].includes(String(item.field))) continue
    const index = Number(item.index)
    if (!Number.isInteger(index) || index < 0 || index > 79) continue
    const alternatives = [
      ...new Set((Array.isArray(item.alternatives) ? item.alternatives : [])
        .filter((char): char is string => typeof char === 'string' && /^[A-Za-z0-9]$/.test(char))),
    ].slice(0, 4)
    if (alternatives.length < 2) continue
    uncertainCharacters.push({ field: item.field as LabelField, index, alternatives })
  }
  const readings = input.readings && typeof input.readings === 'object'
    ? input.readings as Record<string, unknown>
    : {}
  return {
    status,
    modelConfidence: percent(input.modelConfidence),
    serialConfidence: percent(input.serialConfidence),
    uncertainCharacters,
    readings: {
      modelNumber: text(readings.modelNumber).slice(0, 160),
      serialNumber: text(readings.serialNumber).slice(0, 160),
    },
    retakeRequested: input.retakeRequested === true,
    ...(text(input.retakeMessage)
      ? { retakeMessage: text(input.retakeMessage).slice(0, 240) }
      : {}),
    formatWarnings: Array.isArray(input.formatWarnings)
      ? input.formatWarnings.filter((value): value is string => typeof value === 'string').slice(
        0,
        10,
      )
      : [],
  }
}

/** Format validation detects misreads; it never silently repairs a serial or
 * treats a pattern match as proof of manufacture date. Manufacturer-specific
 * rules must name their documented source and apply to an explicitly scoped family. */
export function hasLabelPlaceholder(value: string): boolean {
  return [...value].some((character) => '?[]{}'.includes(character))
}

export function serialFormatWarnings(
  serial: string,
  brand: string,
  category: string,
  rules: ManufacturerSerialRule[] = [],
): string[] {
  if (!serial) return []
  const warnings: string[] = []
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]{3,39}$/.test(serial) || hasLabelPlaceholder(serial)) {
    warnings.push(
      'Serial contains an unreadable character or an unexpected format. Check the original label.',
    )
  }
  for (const rule of rules) {
    if (
      !rule.source || rule.manufacturer.trim().toLowerCase() !== brand.trim().toLowerCase() ||
      (rule.category && rule.category !== category)
    ) continue
    try {
      if (!new RegExp(`^(?:${rule.pattern})$`).test(serial)) {
        warnings.push(
          `${rule.description} Verify the serial against the label. Source: ${rule.source}`,
        )
      }
    } catch {
      throw new Error(`Invalid serial format rule for ${rule.manufacturer}`)
    }
  }
  return warnings
}

export function guardEquipmentLabel<T extends LabelResult>(
  result: T,
  rules: ManufacturerSerialRule[] = [],
): T {
  if (!result.labelReadability) return result
  const quality = { ...result.labelReadability, readings: { ...result.labelReadability.readings } }
  const item = { ...result.identifiedItem }
  quality.formatWarnings = [
    ...new Set([
      ...quality.formatWarnings,
      ...serialFormatWarnings(item.serialNumber || '', item.brand || '', result.category, rules),
    ]),
  ]
  for (const field of ['modelNumber', 'serialNumber'] as const) {
    const value = item[field]
    const uncertain = quality.uncertainCharacters.filter((char) => char.field === field)
    const confidence = field === 'modelNumber' ? quality.modelConfidence : quality.serialConfidence
    const modelUnreadable = field === 'modelNumber' && hasLabelPlaceholder(value || '')
    const blocked = modelUnreadable || ['unreadable', 'not_visible'].includes(quality.status) ||
      (quality.status === 'uncertain' && quality.uncertainCharacters.length === 0) ||
      uncertain.length > 0 || confidence < 85 ||
      (field === 'serialNumber' && quality.formatWarnings.length > 0)
    if (blocked) {
      if (field === 'modelNumber') quality.modelConfidence = Math.min(quality.modelConfidence, 49)
      else quality.serialConfidence = Math.min(quality.serialConfidence, 49)
    }
    if (blocked && value) {
      quality.readings[field] ||= value
      delete item[field]
    }
    if (uncertain.length && quality.readings[field] && !quality.readings[field]!.includes('[')) {
      const chars = [...quality.readings[field]!]
      for (const char of [...uncertain].sort((a, b) => b.index - a.index)) {
        if (char.index < chars.length) chars[char.index] = `[${char.alternatives.join('/')}]`
      }
      quality.readings[field] = chars.join('')
    }
  }
  if (
    quality.status !== 'readable' || !item.modelNumber || !item.serialNumber ||
    quality.formatWarnings.length
  ) {
    quality.retakeRequested = true
    quality.retakeMessage = LABEL_RETAKE_MESSAGE
  }
  const age = !item.serialNumber
    ? {
      value: null,
      confidence: 'low' as const,
      basis: 'Manufacture date cannot be read reliably; age remains unknown.',
    }
    : result.estimatedAge
  return { ...result, identifiedItem: item, estimatedAge: age, labelReadability: quality }
}

export function needsLabelBackup(result: LabelResult, purpose = 'general'): boolean {
  const quality = result.labelReadability
  if (!quality) return true
  if (quality.status === 'not_visible') return false
  if (purpose === 'overview' && result.category === 'roof') return false
  return quality.status !== 'readable' || quality.retakeRequested || quality.modelConfidence < 85 ||
    quality.serialConfidence < 85 || !result.identifiedItem.modelNumber ||
    !result.identifiedItem.serialNumber || quality.uncertainCharacters.length > 0 ||
    quality.formatWarnings.length > 0
}
