/**
 * Extract license / COI fields from an uploaded file via OpenAI.
 * Never invent numbers that are not on the document.
 * Avoid unpdf/PDF.js here — vendor-verification must boot without that native stack
 * so invite links can resolve.
 */

export type ExtractedLicenseFields = {
  licenseNumber: string | null
  licenseState: string | null
  licenseType: string | null
  expirationDate: string | null
  statusHint: string | null
}

export type ExtractedCoiFields = {
  carrier: string | null
  policyNumber: string | null
  generalLiability: number | null
  expirationDate: string | null
  additionalInsured: boolean
}

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

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim()
    return t.length > 0 ? t : null
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function asMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const digits = value.replace(/[^0-9.]/g, "")
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

export function parseExtractedLicenseFields(raw: unknown): ExtractedLicenseFields {
  const row = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  return {
    licenseNumber: asString(row.licenseNumber ?? row.license_number),
    licenseState: asString(row.licenseState ?? row.license_state),
    licenseType: asString(row.licenseType ?? row.license_type),
    expirationDate: asString(row.expirationDate ?? row.expiration_date),
    statusHint: asString(row.status ?? row.statusHint),
  }
}

export function parseExtractedCoiFields(raw: unknown): ExtractedCoiFields {
  const row = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  return {
    carrier: asString(row.carrier ?? row.insuranceCarrier),
    policyNumber: asString(row.policyNumber ?? row.policy_number),
    generalLiability: asMoney(
      row.generalLiability ?? row.general_liability ?? row.glLimit,
    ),
    expirationDate: asString(row.expirationDate ?? row.expiration_date),
    additionalInsured: row.additionalInsured === true ||
      row.additional_insured === true,
  }
}

function throwExtractHttpError(status: number, text: string): never {
  const lower = text.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key")
  ) {
    throw new Error("We couldn't read that document right now. Please try again in a moment.")
  }
  if (status === 429 || lower.includes("rate limit")) {
    throw new Error(
      "Document scanning is busy right now. Please wait a moment and try again.",
    )
  }
  throw new Error("We couldn't read that document. Try a clearer photo or PDF.")
}

function openaiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!key) {
    throw new Error("We couldn't read that document right now. Please try again in a moment.")
  }
  return key
}

async function completeJson(input: {
  system: string
  userContent: unknown[]
}): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.userContent },
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
  return JSON.parse(stripJsonFence(content)) as unknown
}

async function completeJsonFromPdf(input: {
  system: string
  fileName: string
  bytes: Uint8Array
}): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: input.system },
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
  const json = (await response.json()) as Record<string, unknown>
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return JSON.parse(stripJsonFence(json.output_text)) as unknown
  }
  throw new Error("We couldn't read that document. Try a clearer photo or PDF.")
}

function isPdfFile(fileName: string, contentType: string): boolean {
  if (fileName.toLowerCase().endsWith(".pdf")) return true
  const type = contentType.toLowerCase()
  return type === "application/pdf" || type === "application/x-pdf"
}

async function extractWithDocument(input: {
  system: string
  fileName: string
  contentType: string
  bytes: Uint8Array
}): Promise<unknown> {
  const intro = `File: ${input.fileName}`
  if (isPdfFile(input.fileName, input.contentType)) {
    return await completeJsonFromPdf({
      system: `${input.system}\n\n${intro}`,
      fileName: input.fileName,
      bytes: input.bytes,
    })
  }
  const mime = input.contentType || "image/jpeg"
  return await completeJson({
    system: input.system,
    userContent: [
      { type: "text", text: intro },
      {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${bytesToBase64(input.bytes)}` },
      },
    ],
  })
}

const LICENSE_SYSTEM = `Extract contractor license fields from this document.
Return JSON only with keys: licenseNumber, licenseState (2-letter US code), licenseType, expirationDate (YYYY-MM-DD), status.
Use null for anything not clearly printed. Do not invent a license number.`

const COI_SYSTEM = `Extract certificate of insurance (ACORD) fields from this document.
Return JSON only with keys: carrier, policyNumber, generalLiability (number in USD for general liability each occurrence or aggregate — prefer each occurrence), expirationDate (YYYY-MM-DD), additionalInsured (true only if an additional insured endorsement / named additional insured is clearly present, especially the property owner or Ulo).
Use null for unknown fields. Do not invent coverage amounts.`

export async function extractLicenseFieldsFromDocument(input: {
  fileName: string
  contentType: string
  bytes: Uint8Array
}): Promise<ExtractedLicenseFields> {
  const parsed = await extractWithDocument({
    system: LICENSE_SYSTEM,
    fileName: input.fileName,
    contentType: input.contentType,
    bytes: input.bytes,
  })
  return parseExtractedLicenseFields(parsed)
}

export async function extractCoiFieldsFromDocument(input: {
  fileName: string
  contentType: string
  bytes: Uint8Array
}): Promise<ExtractedCoiFields> {
  const parsed = await extractWithDocument({
    system: COI_SYSTEM,
    fileName: input.fileName,
    contentType: input.contentType,
    bytes: input.bytes,
  })
  return parseExtractedCoiFields(parsed)
}
