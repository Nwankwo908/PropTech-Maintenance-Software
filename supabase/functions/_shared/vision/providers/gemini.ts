import { APPLIANCE_VISION_JSON_SCHEMA, type VisionProvider } from '../types.ts'
import {
  equipmentFetch,
  type EquipmentProviderOptions,
  equipmentRequestImages,
  equipmentResult,
  equipmentSystemPrompt,
  GEMINI_EQUIPMENT_MODEL,
} from './equipmentRequest.ts'

export function createGeminiVisionProvider(
  apiKey: string,
  options: EquipmentProviderOptions = {},
): VisionProvider {
  const model = options.model || GEMINI_EQUIPMENT_MODEL
  if (!/^gemini-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini equipment model ID.')
  return {
    name: 'gemini',
    async analyzeImage(base64, hint, mediaType, context) {
      if (!apiKey.trim()) throw new Error('Configure GEMINI_API_KEY to read equipment photos.')
      const images = equipmentRequestImages(base64, mediaType, context)
      const response = await equipmentFetch(
        options.fetchImpl || fetch,
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: equipmentSystemPrompt(hint, context) }] },
            contents: [{
              role: 'user',
              parts: images.flatMap((
                image,
              ) => [{ text: `Photo: ${image.purpose}` }, {
                inlineData: { mimeType: image.mediaType, data: image.data },
              }]),
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseJsonSchema: APPLIANCE_VISION_JSON_SCHEMA,
            },
          }),
        },
      )
      const payload = await response.json()
      const candidate = payload.candidates?.[0]
      if (!candidate || candidate.finishReason !== 'STOP') {
        throw new Error('Gemini equipment reading was blocked or incomplete.')
      }
      const content = candidate.content?.parts?.filter((
        part: { thought?: boolean; text?: string },
      ) => !part.thought && typeof part.text === 'string').map((part: { text: string }) =>
        part.text
      ).join('')
      if (!content) throw new Error('Gemini returned no equipment reading.')
      return {
        ...equipmentResult(JSON.parse(content), context, options.serialRules),
        extractionTrace: {
          selectedProvider: 'gemini',
          selectedModel: model,
          attempts: [{ provider: 'gemini', model, outcome: 'read' }],
        },
      }
    },
  }
}
