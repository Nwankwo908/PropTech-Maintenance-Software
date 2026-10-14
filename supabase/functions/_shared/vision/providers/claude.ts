import { APPLIANCE_VISION_JSON_SCHEMA, type VisionProvider } from '../types.ts'
import {
  CLAUDE_EQUIPMENT_MODEL,
  equipmentFetch,
  type EquipmentProviderOptions,
  equipmentRequestImages,
  equipmentResult,
  equipmentSystemPrompt,
} from './equipmentRequest.ts'

export function createClaudeVisionProvider(
  apiKey: string,
  options: EquipmentProviderOptions = {},
): VisionProvider {
  const model = options.model || CLAUDE_EQUIPMENT_MODEL
  if (!/^claude-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid Claude equipment model ID.')
  return {
    name: 'claude',
    async analyzeImage(base64, hint, mediaType, context) {
      if (!apiKey.trim()) {
        throw new Error('Configure ANTHROPIC_API_KEY for the equipment reading backup.')
      }
      const images = equipmentRequestImages(base64, mediaType, context)
      const response = await equipmentFetch(
        options.fetchImpl || fetch,
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            temperature: 0,
            system: equipmentSystemPrompt(hint, context),
            messages: [{
              role: 'user',
              content: images.flatMap((
                image,
              ) => [{ type: 'text', text: `Photo: ${image.purpose}` }, {
                type: 'image',
                source: { type: 'base64', media_type: image.mediaType, data: image.data },
              }]),
            }],
            tools: [{
              name: 'record_equipment',
              description:
                'Return equipment readings, including ambiguous characters and retake requests.',
              input_schema: APPLIANCE_VISION_JSON_SCHEMA,
            }],
            tool_choice: { type: 'tool', name: 'record_equipment' },
          }),
        },
      )
      const payload = await response.json()
      if (payload.stop_reason !== 'tool_use') {
        throw new Error('Claude equipment reading was blocked or incomplete.')
      }
      const output = payload.content?.find((block: { type?: string; name?: string }) =>
        block.type === 'tool_use' && block.name === 'record_equipment'
      )
      if (!output?.input) throw new Error('Claude returned no structured equipment reading.')
      return {
        ...equipmentResult(output.input, context, options.serialRules),
        extractionTrace: {
          selectedProvider: 'claude',
          selectedModel: model,
          attempts: [{ provider: 'claude', model, outcome: 'read' }],
        },
      }
    },
  }
}
