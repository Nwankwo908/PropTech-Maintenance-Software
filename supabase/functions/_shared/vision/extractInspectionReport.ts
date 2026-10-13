import { analyzeInspectionReportWithGpt4o } from "./providers/gpt4o.ts"
import { normalizeInspectionReportExtract } from "./normalize.ts"
import type { InspectionPageImage } from "./inspectionPageImages.ts"

export type InspectionReportExtract = ReturnType<typeof normalizeInspectionReportExtract>

export async function extractInspectionReport(input: {
  imageBase64: string
  contentType?: string
  pageImages?: InspectionPageImage[]
  pageTexts?: string[]
}): Promise<InspectionReportExtract> {
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() ?? ""
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY for document extraction")
  return await analyzeInspectionReportWithGpt4o(
    apiKey,
    input.imageBase64,
    input.contentType,
    input.pageImages,
    input.pageTexts,
  )
}
