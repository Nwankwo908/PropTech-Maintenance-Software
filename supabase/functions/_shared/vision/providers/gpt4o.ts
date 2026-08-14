import type { ApplianceVisionResult, VisionProvider } from "../types.ts"
import {
  INSPECTION_DOCUMENT_SYSTEM_PROMPT,
  INSPECTION_VISION_SYSTEM_PROMPT,
} from "../prompt.ts"
import {
  normalizeApplianceVisionResult,
  normalizeApplianceVisionResultList,
} from "../normalize.ts"
import { parseModelJsonContent } from "../parseModelJson.ts"

function stripDataUrl(imageBase64: string): string {
  return imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
}

function mediaTypeOrJpeg(mediaType?: string): string {
  const t = (mediaType ?? "").trim().toLowerCase()
  if (t.startsWith("image/") || t === "application/pdf") return t
  return "image/jpeg"
}

export function createGpt4oVisionProvider(apiKey: string): VisionProvider {
  return {
    name: "gpt4o",

    async analyzeImage(
      imageBase64: string,
      hintCategory?: string,
      mediaType?: string,
    ): Promise<ApplianceVisionResult> {
      const hint = hintCategory?.trim()
        ? `\nInspector pre-tag (optional hint): ${hintCategory.trim()}. Infer the true category if the hint seems wrong.`
        : ""

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                INSPECTION_VISION_SYSTEM_PROMPT +
                hint +
                `\nJSON keys: category, identifiedItem{type,brand,modelNumber,serialNumber,fuelType?,btuOutput?}, estimatedAge{value,confidence,basis}, condition{rating,summary}, deficiencies[{description,severity,location}], maintenanceRecommendations[{action,urgency,suggestedIntervalMonths}], rawConfidenceNotes. For category "boiler", include fuelType and btuOutput when visible.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this inspection photo and return structured JSON.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mediaTypeOrJpeg(mediaType)};base64,${stripDataUrl(imageBase64)}`,
                  },
                },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`GPT-4o vision failed (${response.status}): ${text.slice(0, 300)}`)
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = json.choices?.[0]?.message?.content ?? ""
      const parsed = parseModelJsonContent(content, "GPT-4o")
      return normalizeApplianceVisionResult(parsed)
    },

    async analyzeDocument(
      imageBase64: string,
      mediaType?: string,
    ): Promise<ApplianceVisionResult[]> {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: INSPECTION_DOCUMENT_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all appliance and systems findings from this inspection report page/document.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mediaTypeOrJpeg(mediaType)};base64,${stripDataUrl(imageBase64)}`,
                  },
                },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(
          `GPT-4o document extract failed (${response.status}): ${text.slice(0, 300)}`,
        )
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = json.choices?.[0]?.message?.content ?? ""
      const parsed = parseModelJsonContent(content, "GPT-4o document extract")
      return normalizeApplianceVisionResultList(parsed)
    },
  }
}
