import { APPLIANCE_VISION_JSON_SCHEMA, type VisionProvider } from '../types.ts'
import {
  equipmentFetch,
  type EquipmentProviderOptions,
  equipmentRequestImages,
  equipmentResult,
  equipmentSystemPrompt,
  OPENAI_EQUIPMENT_MODEL,
} from './equipmentRequest.ts'

export function createOpenAiVisionProvider(
  apiKey: string,
  options: EquipmentProviderOptions = {},
): VisionProvider {
  const model = options.model || OPENAI_EQUIPMENT_MODEL
  if (model !== OPENAI_EQUIPMENT_MODEL) throw new Error('Invalid equipment backup model ID.')
  return {
    name: 'gpt4o',
    async analyzeImage(base64, hint, mediaType, context) {
      if (!apiKey.trim()) {
        throw new Error('Configure OPENAI_API_KEY for the equipment reading backup.')
      }
      const images = equipmentRequestImages(base64, mediaType, context)
      const response = await equipmentFetch(
        options.fetchImpl || fetch,
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            temperature: 0,
            messages: [
              { role: 'system', content: equipmentSystemPrompt(hint, context) },
              {
                role: 'user',
                content: images.flatMap((image) => [
                  { type: 'text', text: `Photo: ${image.purpose}` },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${image.mediaType};base64,${image.data}` },
                  },
                ]),
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'equipment_reading',
                strict: false,
                schema: APPLIANCE_VISION_JSON_SCHEMA,
              },
            },
          }),
        },
      )
      const payload = await response.json()
      const choice = payload.choices?.[0]
      const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
      if (!text || choice?.finish_reason === 'length') {
        throw new Error('Equipment backup reading was blocked or incomplete.')
      }
      return {
        ...equipmentResult(JSON.parse(text), context, options.serialRules),
        extractionTrace: {
          selectedProvider: 'openai',
          selectedModel: model,
          attempts: [{ provider: 'openai', model, outcome: 'read' }],
        },
      }
    },
  }
}
