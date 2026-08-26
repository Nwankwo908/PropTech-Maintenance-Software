/**
 * Extract structured maintenance history jobs from invoices / receipts / work orders.
 * Prefer PDF text; fall back to GPT-4o PDF file / vision. Never invent sample jobs.
 */
import {
  isPdfFile,
  MIN_PDF_TEXT_CHARS,
  pdfBytesToPlainText,
} from "../onboarding/pdfDocumentText.ts"

export type MaintenanceHistoryExtractedJob = {
  vendorName: string
  vendorPhone: string
  vendorEmail: string
  tradeCategory: string
  serviceDate: string
  invoiceNumber: string
  totalAmount: string
  laborCost: string
  partsCost: string
  issueType: string
  workPerformed: string
  unitLabel: string
  assetInvolved: string
  paymentStatus: string
  warrantyInfo: string
  notes: string
  confidence: number
}

export type MaintenanceHistoryExtractResult = {
  records: MaintenanceHistoryExtractedJob[]
  warnings: string[]
  method: "pdf_text" | "pdf_file" | "image" | "csv_text" | "plain_text"
}

const TRADE_CATEGORIES = [
  "Appliance Repair",
  "Carpentry",
  "Cleaning",
  "Electrical",
  "Flooring",
  "General / Handyman",
  "HVAC",
  "Landscaping",
  "Locksmith",
  "Painting",
  "Pest Control",
  "Plumbing",
  "Roofing",
  "Windows",
  "Other",
] as const

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function asConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return 0.75
  if (n > 1 && n <= 100) return Math.min(1, Math.max(0, n / 100))
  return Math.min(1, Math.max(0, n))
}

function normalizeJob(raw: unknown): MaintenanceHistoryExtractedJob | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const vendorName = asString(row.vendorName ?? row.vendor)
  const workPerformed = asString(row.workPerformed ?? row.description ?? row.work)
  const issueType = asString(row.issueType ?? row.issue)
  const totalAmount = asString(row.totalAmount ?? row.amount ?? row.total)
  if (!vendorName && !workPerformed && !issueType && !totalAmount) return null
  return {
    vendorName,
    vendorPhone: asString(row.vendorPhone ?? row.phone),
    vendorEmail: asString(row.vendorEmail ?? row.email),
    tradeCategory: asString(row.tradeCategory ?? row.trade ?? row.category) || "Other",
    serviceDate: asString(row.serviceDate ?? row.date ?? row.service_date),
    invoiceNumber: asString(row.invoiceNumber ?? row.invoice ?? row.invoice_number),
    totalAmount,
    laborCost: asString(row.laborCost ?? row.labor),
    partsCost: asString(row.partsCost ?? row.parts ?? row.materials),
    issueType,
    workPerformed,
    unitLabel: asString(row.unitLabel ?? row.unit ?? row.unit_label),
    assetInvolved: asString(row.assetInvolved ?? row.asset ?? row.equipment),
    paymentStatus: asString(row.paymentStatus ?? row.payment ?? row.status),
    warrantyInfo: asString(row.warrantyInfo ?? row.warranty),
    notes: asString(row.notes),
    confidence: asConfidence(row.confidence ?? 0.82),
  }
}

function parseJobsPayload(
  content: string,
  method: MaintenanceHistoryExtractResult["method"],
): MaintenanceHistoryExtractResult {
  const parsed = JSON.parse(stripJsonFence(content)) as unknown
  const root =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  const list = Array.isArray(root.records)
    ? root.records
    : Array.isArray(root.jobs)
      ? root.jobs
      : Array.isArray(parsed)
        ? parsed
        : []
  const records = list
    .map(normalizeJob)
    .filter((row): row is MaintenanceHistoryExtractedJob => row != null)
  const warnings = Array.isArray(root.warnings)
    ? root.warnings.map(asString).filter(Boolean)
    : []
  return { records, warnings, method }
}

function throwExtractHttpError(status: number, text: string): never {
  const lower = text.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key")
  ) {
    throw new Error(
      "Document scanning is not configured. Set a valid OPENAI_API_KEY on Supabase Edge secrets.",
    )
  }
  if (status === 429 || lower.includes("rate limit")) {
    throw new Error(
      "Document scanning is busy right now. Please wait a moment and try again.",
    )
  }
  throw new Error(
    `Maintenance history extract failed (${status}): ${text.slice(0, 300)}`,
  )
}

const SYSTEM_PROMPT =
  `You extract historical maintenance / repair invoice data for a property landlord.
Return JSON only: { "records": [ ... ], "warnings": [string] }.
Each record fields (use empty string when not visible — never invent demo vendors or amounts):
vendorName, vendorPhone, vendorEmail, tradeCategory, serviceDate (YYYY-MM-DD when possible),
invoiceNumber, totalAmount, laborCost, partsCost, issueType, workPerformed, unitLabel,
assetInvolved, paymentStatus, warrantyInfo, notes, confidence (0-1).
tradeCategory must be one of: ${TRADE_CATEGORIES.join(", ")}.
If the file is not a maintenance invoice/receipt/work order, return records: [] and explain in warnings.
Extract every distinct job/invoice visible. Do not fabricate sample jobs.`

async function extractWithChatCompletions(
  apiKey: string,
  userContent: Array<Record<string, unknown>>,
  method: MaintenanceHistoryExtractResult["method"],
): Promise<MaintenanceHistoryExtractResult> {
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
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  })
  if (!response.ok) {
    throwExtractHttpError(response.status, await response.text().catch(() => ""))
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content ?? ""
  try {
    return parseJobsPayload(content, method)
  } catch {
    throw new Error("Maintenance history extract returned non-JSON content")
  }
}

function readResponsesOutputText(json: unknown): string {
  if (!json || typeof json !== "object") return ""
  const root = json as Record<string, unknown>
  if (typeof root.output_text === "string" && root.output_text.trim()) {
    return root.output_text
  }
  const output = Array.isArray(root.output) ? root.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const text = (part as { text?: unknown }).text
      if (typeof text === "string" && text.trim()) chunks.push(text)
    }
  }
  return chunks.join("\n")
}

async function extractWithResponsesPdf(input: {
  apiKey: string
  fileName: string
  introText: string
  bytes: Uint8Array
}): Promise<MaintenanceHistoryExtractResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: `${SYSTEM_PROMPT}\n\n${input.introText}` },
            {
              type: "input_file",
              filename: input.fileName,
              file_data: `data:application/pdf;base64,${bytesToBase64(input.bytes)}`,
            },
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    }),
  })
  if (!response.ok) {
    throwExtractHttpError(response.status, await response.text().catch(() => ""))
  }
  const content = readResponsesOutputText(await response.json())
  try {
    return parseJobsPayload(content, "pdf_file")
  } catch {
    throw new Error("Maintenance history extract returned non-JSON content")
  }
}

export async function extractMaintenanceHistoryFromDocument(input: {
  apiKey: string
  fileName: string
  contentType: string
  bytes: Uint8Array
  buildingName?: string
}): Promise<MaintenanceHistoryExtractResult> {
  const building = (input.buildingName ?? "").trim()
  const intro =
    `File: ${input.fileName}` +
    (building ? `\nProperty / building context: ${building}` : "")

  const lowerName = input.fileName.toLowerCase()
  const contentType = input.contentType.toLowerCase()
  const isCsv =
    lowerName.endsWith(".csv") ||
    contentType.includes("csv") ||
    contentType.startsWith("text/")

  if (isCsv) {
    const text = new TextDecoder().decode(input.bytes).slice(0, 120_000)
    const method: MaintenanceHistoryExtractResult["method"] =
      lowerName.endsWith(".csv") || contentType.includes("csv")
        ? "csv_text"
        : "plain_text"
    return await extractWithChatCompletions(
      input.apiKey,
      [{ type: "text", text: `${intro}\n\nDocument text:\n${text}` }],
      method,
    )
  }

  if (isPdfFile(input.fileName, input.contentType)) {
    const pdfText = await pdfBytesToPlainText(input.bytes)
    if (pdfText.replace(/\s+/g, " ").trim().length >= MIN_PDF_TEXT_CHARS) {
      return await extractWithChatCompletions(
        input.apiKey,
        [{ type: "text", text: `${intro}\n\nPDF text:\n${pdfText}` }],
        "pdf_text",
      )
    }
    return await extractWithResponsesPdf({
      apiKey: input.apiKey,
      fileName: input.fileName,
      introText: intro,
      bytes: input.bytes,
    })
  }

  const mime = input.contentType || "image/jpeg"
  return await extractWithChatCompletions(
    input.apiKey,
    [
      { type: "text", text: intro },
      {
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${bytesToBase64(input.bytes)}`,
        },
      },
    ],
    "image",
  )
}
