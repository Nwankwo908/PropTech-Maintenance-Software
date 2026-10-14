import { INSPECTION_VISION_SYSTEM_PROMPT } from '../prompt.ts'
import { normalizeApplianceVisionResult } from '../normalize.ts'
import type { ApplianceVisionResult, EquipmentPhotoContext } from '../types.ts'
import {
  guardEquipmentLabel,
  type ManufacturerSerialRule,
} from '../../../../../shared/vision/equipmentLabel.ts'

export const GEMINI_EQUIPMENT_MODEL = 'gemini-3.8-flash'
export const CLAUDE_EQUIPMENT_MODEL = 'claude-sonnet-5-5'
export type EquipmentProviderOptions = {
  model?: string
  fetchImpl?: typeof fetch
  serialRules?: ManufacturerSerialRule[]
}

export function equipmentRequestImages(
  base64: string,
  mediaType = 'image/jpeg',
  context?: EquipmentPhotoContext,
) {
  const images = [
    { imageBase64: base64, mediaType, purpose: context?.purpose || 'general' },
    ...(context?.referenceImages || []),
  ]
  if (images.length > 2) {
    throw new Error('Equipment reading accepts the whole appliance and one data-plate photo.')
  }
  return images.map((image) => {
    const mime = image.mediaType === 'image/jpg' ? 'image/jpeg' : image.mediaType
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw new Error('Use JPEG, PNG or WebP equipment photos.')
    }
    const data = image.imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')
    if (!data || data.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new Error('Invalid equipment image data.')
    }
    return { data, mediaType: mime, purpose: image.purpose }
  })
}

export function equipmentSystemPrompt(hint?: string, context?: EquipmentPhotoContext) {
  return `${INSPECTION_VISION_SYSTEM_PROMPT}\n${
    hint ? `Equipment hint: ${hint}; infer the actual category from the images.` : ''
  }
Photo purpose: ${
    context?.purpose || 'general'
  }. When two photos are supplied, use the close-up data plate for label text and the whole appliance for visible condition. Do not assume an unrelated label belongs to the appliance. If they conflict, request a retake.
Return labelReadability with status readable / uncertain / unreadable / not_visible, modelConfidence and serialConfidence (0–100), uncertainCharacters [{field: modelNumber or serialNumber, index: zero-based character index, alternatives: e.g. ["0","O"] or ["8","B"]}], readings {modelNumber,serialNumber}, retakeRequested, retakeMessage and formatWarnings.
Copy only characters you can actually read. Keep ambiguous characters flagged; do not choose one just to fill a field. If the data plate is blurry, obscured or reflecting flash, omit unreadable model/serial numbers and request: "Label unreadable, please send a closer photo without flash." Never infer a model or serial from the appliance's appearance or a likely catalog match.
For a whole-appliance photo without a visible label, use not_visible. For manufacture-date estimates, name the basis and confidence; leave age null if the serial or date is unreadable. A model's visual guess is not a verified manufacture date.`
}

export function equipmentResult(
  raw: unknown,
  context?: EquipmentPhotoContext,
  rules: ManufacturerSerialRule[] = [],
): ApplianceVisionResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Equipment reading did not return an object.')
  }
  const input = raw as Record<string, unknown>
  if (!input.identifiedItem || !input.estimatedAge || !input.condition || !input.labelReadability) {
    throw new Error('Equipment reading omitted required evidence.')
  }
  const result = guardEquipmentLabel(normalizeApplianceVisionResult(raw), rules)
  if (context?.purpose === 'overview' && result.labelReadability?.status === 'not_visible') {
    result.labelReadability.retakeRequested = false
    delete result.labelReadability.retakeMessage
  }
  return result
}

export async function equipmentFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`Equipment vision provider returned HTTP ${response.status}`)
  return response
}
