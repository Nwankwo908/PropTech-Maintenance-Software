import type { ApplianceVisionResult, VisionProvider } from "../types.ts"
import {
  INSPECTION_DOCUMENT_SYSTEM_PROMPT,
  INSPECTION_VISION_SYSTEM_PROMPT,
} from "../prompt.ts"
import {
  normalizeApplianceVisionResult,
  normalizeInspectionReportExtract,
} from "../normalize.ts"
import { parseModelJsonContent } from "../parseModelJson.ts"
import {
  chatCompletionFailureDetail,
  extractChatCompletionText,
} from "../openaiChatContent.ts"
import {
  resolveOpenAiVisionMediaType,
  stripVisionDataUrl,
} from "../openaiVisionMedia.ts"

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: unknown
      refusal?: string
    }
  }>
}

async function callGpt4oVision(input: {
  apiKey: string
  system: string
  userText: string
  imageBase64: string
  mediaType: string
  jsonObject: boolean
}): Promise<ChatCompletionResponse> {
  const body: Record<string, unknown> = {
    model: "gpt-4o",
    temperature: 0.1,
    max_tokens: 2500,
    messages: [
      { role: "system", content: input.system },
      {
        role: "user",
        content: [
          { type: "text", text: input.userText },
          {
            type: "image_url",
            image_url: {
              url: `data:${input.mediaType};base64,${stripVisionDataUrl(input.imageBase64)}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  }
  if (input.jsonObject) {
    body.response_format = { type: "json_object" }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`GPT-4o vision failed (${response.status}): ${text.slice(0, 300)}`)
  }

  return (await response.json()) as ChatCompletionResponse
}

function parsedFromCompletion(json: ChatCompletionResponse, label: string): unknown {
  const message = json.choices?.[0]?.message
  const content = extractChatCompletionText(message)
  if (!content) {
    throw new Error(
      `${label} returned empty content (${chatCompletionFailureDetail(json)})`,
    )
  }
  return parseModelJsonContent(content, label)
}

export function createGpt4oVisionProvider(apiKey: string): VisionProvider {
  return {
    name: "gpt4o",

    async analyzeImage(
      imageBase64: string,
      hintCategory?: string,
      mediaType?: string,
    ): Promise<ApplianceVisionResult> {
      const resolved = resolveOpenAiVisionMediaType(imageBase64, mediaType)
      if ("error" in resolved) throw new Error(resolved.error)

      const hint = hintCategory?.trim()
        ? `\nInspector pre-tag (optional hint): ${hintCategory.trim()}. Infer the true category if the hint seems wrong.`
        : ""
      const system =
        INSPECTION_VISION_SYSTEM_PROMPT +
        hint +
        `\nJSON keys: category, identifiedItem{type,brand,modelNumber,serialNumber,fuelType?,btuOutput?}, estimatedAge{value,confidence,basis}, condition{rating,summary}, deficiencies[{description,severity,location}], maintenanceRecommendations[{action,urgency,suggestedIntervalMonths}], overallConfidence (0-100), rawConfidenceNotes. For category "boiler", include fuelType and btuOutput when visible.`

      const userText = "Analyze this inspection photo and return structured JSON."
      let json = await callGpt4oVision({
        apiKey,
        system,
        userText,
        imageBase64,
        mediaType: resolved.mediaType,
        jsonObject: true,
      })

      try {
        const parsed = parsedFromCompletion(json, "GPT-4o")
        return normalizeApplianceVisionResult(parsed)
      } catch (firstErr) {
        json = await callGpt4oVision({
          apiKey,
          system,
          userText,
          imageBase64,
          mediaType: resolved.mediaType,
          jsonObject: false,
        })
        try {
          const parsed = parsedFromCompletion(json, "GPT-4o")
          return normalizeApplianceVisionResult(parsed)
        } catch {
          throw firstErr instanceof Error ? firstErr : new Error(String(firstErr))
        }
      }
    },

    async analyzeDocument(
      imageBase64: string,
      mediaType?: string,
    ): Promise<ApplianceVisionResult[]> {
      const extracted = await analyzeInspectionReportWithGpt4o(
        apiKey,
        imageBase64,
        mediaType,
      )
      return extracted.items
    },
  }
}

export async function analyzeInspectionReportWithGpt4o(
  apiKey: string,
  imageBase64: string,
  mediaType?: string,
): Promise<ReturnType<typeof normalizeInspectionReportExtract>> {
  const resolved = resolveOpenAiVisionMediaType(imageBase64, mediaType)
  if ("error" in resolved) throw new Error(resolved.error)

  const json = await callGpt4oVision({
    apiKey,
    system: INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    userText:
      "Read the property address printed on this inspection report, then extract all appliance and systems findings. Return JSON with propertyAddress and items.",
    imageBase64,
    mediaType: resolved.mediaType,
    jsonObject: true,
  })
  const parsed = parsedFromCompletion(json, "GPT-4o document extract")
  return normalizeInspectionReportExtract(parsed)
}
