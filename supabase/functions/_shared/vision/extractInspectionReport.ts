import { analyzeInspectionReportWithGpt4o } from "./providers/gpt4o.ts"
import { normalizeInspectionReportExtract } from "./normalize.ts"

export type InspectionReportExtract = ReturnType<typeof normalizeInspectionReportExtract>

export async function extractInspectionReport(input: {
  imageBase64: string
  contentType?: string
}): Promise<InspectionReportExtract> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? ""
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for GPT-4o vision")
  return await analyzeInspectionReportWithGpt4o(
    apiKey,
    input.imageBase64,
    input.contentType,
  )
}
