import type { ApplianceVisionResult, VisionProvider } from "../types.ts"
import {
  INSPECTION_DOCUMENT_SYSTEM_PROMPT,
  INSPECTION_VISION_SYSTEM_PROMPT,
} from "../prompt.ts"
import {
  normalizeApplianceVisionResult,
  mergeInspectionReportExtracts,
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
import { pdfPagesToJpegDataUrls } from "../../onboarding/pdfPageImages.ts"
import {
  INSPECTION_REPORT_MAX_PAGES,
  formatInspectionPageTextsForPrompt,
  type InspectionPageImage,
} from "../inspectionPageImages.ts"

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: unknown
      refusal?: string
    }
  }>
}

export type Gpt4oVisionImage = { base64: string; mediaType: string }

export type Gpt4oVisionDetail = "high" | "low" | "auto"

/** One GPT-4o call per page so later 4-point sections are not dropped. */
export const INSPECTION_REPORT_PAGE_CHUNK = 1

export function inspectionReportPageChunks<T>(
  pages: T[],
  size = INSPECTION_REPORT_PAGE_CHUNK,
): T[][] {
  if (pages.length === 0) return []
  if (pages.length <= size) return [pages]
  const chunks: T[][] = []
  for (let i = 0; i < pages.length; i += size) {
    chunks.push(pages.slice(i, i + size))
  }
  return chunks
}

export function inspectionReportExtractUserText(input: {
  totalPages: number
  pageStart: number
  pageEnd: number
  textLayer: string
}): string {
  const range =
    input.pageStart === input.pageEnd
      ? `page ${input.pageStart}`
      : `pages ${input.pageStart}–${input.pageEnd}`
  const pagesNote =
    input.totalPages > 1
      ? `This is a ${input.totalPages}-page inspection report. You are looking at ${range}. Extract every system finding on these pages.`
      : `Read the property address printed on this inspection report, then extract all findings.`
  return (
    `${pagesNote} Return JSON with propertyAddress and items. ` +
    `A 4-point form has separate sections for electrical, HVAC, plumbing (and water heater), and roof — each is its own items[] row. ` +
    `Only extract systems shown on these pages. At most one predominant roof and one secondary roof covering. ` +
    `Do not stop after the first system or first page.` +
    (input.textLayer
      ? `\n\nUse this PDF text layer together with the page images. Prefer printed text over guesswork.\n${input.textLayer}`
      : "")
  )
}

export function buildGpt4oVisionUserContent(
  userText: string,
  images: Gpt4oVisionImage[],
  detail: Gpt4oVisionDetail = "high",
): Array<Record<string, unknown>> {
  return [
    { type: "text", text: userText },
    ...images.map((image) => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mediaType};base64,${stripVisionDataUrl(image.base64)}`,
        detail,
      },
    })),
  ]
}

function resolveGpt4oVisionImages(input: {
  images?: Gpt4oVisionImage[]
  imageBase64?: string
  mediaType?: string
}): Gpt4oVisionImage[] {
  if (input.images?.length) return input.images
  if (input.imageBase64) {
    return [{ base64: input.imageBase64, mediaType: input.mediaType || "image/jpeg" }]
  }
  return []
}

async function callGpt4oVision(input: {
  apiKey: string
  system: string
  userText: string
  images?: Gpt4oVisionImage[]
  imageBase64?: string
  mediaType?: string
  jsonObject: boolean
  maxTokens?: number
  detail?: Gpt4oVisionDetail
}): Promise<ChatCompletionResponse> {
  const images = resolveGpt4oVisionImages(input)
  if (images.length === 0) {
    throw new Error("GPT-4o vision requires at least one image.")
  }
  const body: Record<string, unknown> = {
    model: "gpt-4o",
    temperature: 0.1,
    max_tokens: input.maxTokens ?? 2500,
    messages: [
      { role: "system", content: input.system },
      {
        role: "user",
        content: buildGpt4oVisionUserContent(input.userText, images, input.detail ?? "high"),
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
  pageImages?: InspectionPageImage[],
  pageTexts?: string[],
): Promise<ReturnType<typeof normalizeInspectionReportExtract>> {
  const claimed = (mediaType ?? "").toLowerCase()
  let images: Gpt4oVisionImage[]

  if (pageImages && pageImages.length > 0) {
    images = pageImages.slice(0, INSPECTION_REPORT_MAX_PAGES).map((page) => ({
      base64: page.base64,
      mediaType: page.mediaType || "image/jpeg",
    }))
  } else if (claimed.includes("pdf")) {
    const raw = stripVisionDataUrl(imageBase64)
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const urls = await pdfPagesToJpegDataUrls(bytes, {
      maxPages: INSPECTION_REPORT_MAX_PAGES,
      maxEdge: 1400,
      quality: 0.7,
    })
    if (urls.length === 0) {
      throw new Error(
        "We couldn't read this PDF inspection report. Export the first page as a JPG and try again.",
      )
    }
    images = urls.map((u) => ({
      base64: u.replace(/^data:image\/jpeg;base64,/, ""),
      mediaType: "image/jpeg",
    }))
  } else {
    const resolved = resolveOpenAiVisionMediaType(imageBase64, mediaType)
    if ("error" in resolved) throw new Error(resolved.error)
    images = [{ base64: imageBase64, mediaType: resolved.mediaType }]
  }

  const chunks = inspectionReportPageChunks(images)
  const parts: ReturnType<typeof normalizeInspectionReportExtract>[] = []
  let pageCursor = 1
  for (const chunk of chunks) {
    const pageStart = pageCursor
    const pageEnd = pageCursor + chunk.length - 1
    pageCursor = pageEnd + 1
    const textLayer = formatInspectionPageTextsForPrompt(pageTexts ?? [], { pageStart, pageEnd })
    try {
      const json = await callGpt4oVision({
        apiKey,
        system: INSPECTION_DOCUMENT_SYSTEM_PROMPT,
        userText: inspectionReportExtractUserText({
          totalPages: images.length,
          pageStart,
          pageEnd,
          textLayer,
        }),
        images: chunk,
        jsonObject: true,
        maxTokens: 8192,
        detail: "auto",
      })
      const parsed = parsedFromCompletion(json, "GPT-4o document extract")
      parts.push(normalizeInspectionReportExtract(parsed))
    } catch (err) {
      console.error("[analyzeInspectionReportWithGpt4o] page extract failed", pageStart, pageEnd, err)
    }
  }
  if (parts.length === 0) {
    throw new Error("GPT-4o document extract returned empty content (all pages failed)")
  }
  return mergeInspectionReportExtracts(parts)
}
