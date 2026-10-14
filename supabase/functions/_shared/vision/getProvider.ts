import type { VisionProvider, VisionProviderName } from './types.ts'
import { createGeminiVisionProvider } from './providers/gemini.ts'
import { createOpenAiVisionProvider } from './providers/openai.ts'
import { withEquipmentBackup } from './providers/equipmentFallback.ts'
import type { ManufacturerSerialRule } from '../../../../shared/vision/equipmentLabel.ts'

export function equipmentSerialFormatRules(): ManufacturerSerialRule[] {
  const value = Deno.env.get('EQUIPMENT_SERIAL_FORMAT_RULES')?.trim()
  if (!value) return []
  const rules = JSON.parse(value)
  if (
    !Array.isArray(rules) ||
    rules.some((rule) =>
      typeof rule.manufacturer !== 'string' || typeof rule.pattern !== 'string' ||
      typeof rule.source !== 'string' || typeof rule.description !== 'string'
    )
  ) throw new Error('Invalid EQUIPMENT_SERIAL_FORMAT_RULES configuration.')
  return rules
}

/** Equipment photos use Gemini Flash, then the OpenAI equipment backup. */
export function getVisionProvider(): VisionProvider {
  const options = { serialRules: equipmentSerialFormatRules() }
  const openai = createOpenAiVisionProvider(Deno.env.get('OPENAI_API_KEY')?.trim() || '', options)
  const gemini = createGeminiVisionProvider(Deno.env.get('GEMINI_API_KEY')?.trim() || '', {
    ...options,
    model: Deno.env.get('GEMINI_VISION_MODEL')?.trim(),
  })
  return withEquipmentBackup(gemini, openai, {
    primaryModel: Deno.env.get('GEMINI_VISION_MODEL')?.trim(),
  })
}

export function getVisionProviderName(): VisionProviderName {
  return 'gemini'
}
