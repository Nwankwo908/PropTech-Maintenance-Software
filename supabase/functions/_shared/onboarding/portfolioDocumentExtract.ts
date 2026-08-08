/**
 * GPT-4o portfolio extraction for onboarding fast-track uploads.
 * Extract only fields visibly present in the document — never invent demo data.
 */

export type PortfolioExtractProperty = {
  name: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  propertyType: string
  unitCount: number
  confidence: number
}

export type PortfolioExtractUnit = {
  label: string
  building: string
  confidence: number
}

export type PortfolioExtractResident = {
  fullName: string
  unit: string
  building: string
  phone: string
  email: string
  leaseStart: string
  leaseEnd: string
  monthlyRent: string
  confidence: number
}

export type PortfolioExtractVendor = {
  name: string
  category: string
  phone: string
  email: string
  confidence: number
}

export type PortfolioExtractLease = {
  residentName: string
  unit: string
  building: string
  leaseStart: string
  leaseEnd: string
  rentAmount: string
  securityDeposit: string
  confidence: number
}

export type PortfolioExtractMaintenanceIssue = {
  unit: string
  building: string
  category: string
  description: string
  priority: string
  confidence: number
}

export type PortfolioExtractFinancialRecord = {
  recordType: string
  description: string
  amount: string
  period: string
  confidence: number
}

export type PortfolioDocumentExtractPayload = {
  properties: PortfolioExtractProperty[]
  units: PortfolioExtractUnit[]
  residents: PortfolioExtractResident[]
  vendors: PortfolioExtractVendor[]
  leases: PortfolioExtractLease[]
  maintenanceIssues: PortfolioExtractMaintenanceIssue[]
  financialRecords: PortfolioExtractFinancialRecord[]
  imageLabels: string[]
  warnings: string[]
}

export const PORTFOLIO_EXTRACT_JSON_SCHEMA = {
  properties: [
    {
      name: "string",
      streetAddress: "string",
      city: "string",
      state: "string",
      zipCode: "string",
      propertyType: "string",
      unitCount: "number",
      confidence: "number 0-100",
    },
  ],
  units: [{ label: "string", building: "string", confidence: "number" }],
  residents: [
    {
      fullName: "string",
      unit: "string",
      building: "string",
      phone: "string",
      email: "string",
      leaseStart: "YYYY-MM-DD or empty",
      leaseEnd: "YYYY-MM-DD or empty",
      monthlyRent: "string",
      confidence: "number",
    },
  ],
  vendors: [
    {
      name: "string",
      category: "string",
      phone: "string",
      email: "string",
      confidence: "number",
    },
  ],
  leases: [
    {
      residentName: "string",
      unit: "string",
      building: "string",
      leaseStart: "string",
      leaseEnd: "string",
      rentAmount: "string",
      securityDeposit: "string",
      confidence: "number",
    },
  ],
  maintenanceIssues: [
    {
      unit: "string",
      building: "string",
      category: "string",
      description: "string",
      priority: "low|normal|urgent",
      confidence: "number",
    },
  ],
  financialRecords: [
    {
      recordType: "string",
      description: "string",
      amount: "string",
      period: "string",
      confidence: "number",
    },
  ],
  imageLabels: ["short visible labels from photos, if any"],
  warnings: ["extraction caveats, missing pages, illegible sections"],
}

const SYSTEM_PROMPT = `You extract structured property-management portfolio data from uploaded documents for landlord onboarding.

Rules:
- Extract ONLY information explicitly visible in the document. Never invent names, addresses, units, rents, or vendors.
- If nothing portfolio-related is present, return empty arrays and explain in warnings.
- Prefer exact text from the document over inference.
- Dates: YYYY-MM-DD when unambiguous; otherwise empty string.
- Phone numbers: include country code when shown; otherwise as printed.
- confidence: 0-100 for how clearly each row's fields appear in the document.
- Do not return placeholder or example people (no "John Doe", no sample@example.com).

Return ONLY valid JSON matching the requested schema.`

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, 50))))
}

function normalizeProperty(row: Record<string, unknown>): PortfolioExtractProperty | null {
  const name = asString(row.name)
  const streetAddress = asString(row.streetAddress ?? row.street_address ?? row.address)
  if (!name && !streetAddress) return null
  return {
    name: name || streetAddress,
    streetAddress,
    city: asString(row.city),
    state: asString(row.state).toUpperCase().slice(0, 2),
    zipCode: asString(row.zipCode ?? row.zip_code),
    propertyType: asString(row.propertyType ?? row.property_type) || "multifamily",
    unitCount: Math.max(0, Math.round(asNumber(row.unitCount ?? row.unit_count, 0))),
    confidence: clampConfidence(row.confidence),
  }
}

function normalizeArray<T>(
  value: unknown,
  map: (row: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const mapped = map(item as Record<string, unknown>)
    if (mapped) out.push(mapped)
  }
  return out
}

export function normalizePortfolioDocumentExtract(raw: unknown): PortfolioDocumentExtractPayload {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    properties: normalizeArray(root.properties, normalizeProperty),
    units: normalizeArray(root.units, (row) => {
      const label = asString(row.label)
      const building = asString(row.building)
      if (!label && !building) return null
      return {
        label,
        building,
        confidence: clampConfidence(row.confidence),
      }
    }),
    residents: normalizeArray(root.residents, (row) => {
      const fullName = asString(row.fullName ?? row.full_name ?? row.name)
      if (!fullName) return null
      return {
        fullName,
        unit: asString(row.unit),
        building: asString(row.building),
        phone: asString(row.phone),
        email: asString(row.email),
        leaseStart: asString(row.leaseStart ?? row.lease_start),
        leaseEnd: asString(row.leaseEnd ?? row.lease_end),
        monthlyRent: asString(row.monthlyRent ?? row.monthly_rent ?? row.rent),
        confidence: clampConfidence(row.confidence),
      }
    }),
    vendors: normalizeArray(root.vendors, (row) => {
      const name = asString(row.name)
      if (!name) return null
      return {
        name,
        category: asString(row.category),
        phone: asString(row.phone),
        email: asString(row.email),
        confidence: clampConfidence(row.confidence),
      }
    }),
    leases: normalizeArray(root.leases, (row) => {
      const residentName = asString(row.residentName ?? row.resident_name ?? row.name)
      if (!residentName) return null
      return {
        residentName,
        unit: asString(row.unit),
        building: asString(row.building),
        leaseStart: asString(row.leaseStart ?? row.lease_start),
        leaseEnd: asString(row.leaseEnd ?? row.lease_end),
        rentAmount: asString(row.rentAmount ?? row.rent_amount ?? row.rent),
        securityDeposit: asString(row.securityDeposit ?? row.security_deposit),
        confidence: clampConfidence(row.confidence),
      }
    }),
    maintenanceIssues: normalizeArray(root.maintenanceIssues ?? root.maintenance_issues, (row) => {
      const description = asString(row.description)
      if (!description) return null
      return {
        unit: asString(row.unit),
        building: asString(row.building),
        category: asString(row.category),
        description,
        priority: asString(row.priority) || "normal",
        confidence: clampConfidence(row.confidence),
      }
    }),
    financialRecords: normalizeArray(root.financialRecords ?? root.financial_records, (row) => {
      const description = asString(row.description)
      if (!description) return null
      return {
        recordType: asString(row.recordType ?? row.record_type),
        description,
        amount: asString(row.amount),
        period: asString(row.period),
        confidence: clampConfidence(row.confidence),
      }
    }),
    imageLabels: Array.isArray(root.imageLabels)
      ? root.imageLabels.map((v) => asString(v)).filter(Boolean).slice(0, 12)
      : [],
    warnings: Array.isArray(root.warnings)
      ? root.warnings.map((v) => asString(v)).filter(Boolean).slice(0, 8)
      : [],
  }
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function buildUserContent(
  fileName: string,
  documentCategory: string,
  contentType: string,
  bytes: Uint8Array,
): Array<Record<string, unknown>> {
  const categoryHint = documentCategory
    ? `Document category hint from filename/rules: ${documentCategory}.`
    : ""
  const intro = `File: ${fileName}\n${categoryHint}\nExtract portfolio data from this document.`

  if (contentType === "text/csv" || fileName.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(bytes).slice(0, 120_000)
    return [
      { type: "text", text: `${intro}\n\nCSV contents:\n${text}` },
    ]
  }

  const mediaType =
    contentType.startsWith("image/") || contentType === "application/pdf"
      ? contentType
      : contentType.startsWith("image/")
        ? contentType
        : fileName.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg"

  if (
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf"
  ) {
    return [
      { type: "text", text: intro },
      {
        type: "image_url",
        image_url: {
          url: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
        },
      },
    ]
  }

  return [
    {
      type: "text",
      text:
        `${intro}\n\nThis file type is not supported for automatic extraction. Upload PDF, CSV, or clear photos/scans instead.`,
    },
  ]
}

export async function extractPortfolioDocument(input: {
  apiKey: string
  fileName: string
  documentCategory: string
  contentType: string
  bytes: Uint8Array
}): Promise<PortfolioDocumentExtractPayload> {
  const lower = input.fileName.toLowerCase()
  const unsupported =
    /\.(docx?|xlsx?|xls)$/i.test(lower) &&
    input.contentType !== "text/csv" &&
    !lower.endsWith(".csv")

  if (unsupported) {
    return {
      properties: [],
      units: [],
      residents: [],
      vendors: [],
      leases: [],
      maintenanceIssues: [],
      financialRecords: [],
      imageLabels: [],
      warnings: [
        "This file type needs a PDF export or CSV rent roll for reliable extraction. Word and Excel uploads are not parsed yet.",
      ],
    }
  }

  const userContent = buildUserContent(
    input.fileName,
    input.documentCategory,
    input.contentType,
    input.bytes,
  )

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
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
            SYSTEM_PROMPT +
            `\n\nJSON schema:\n${JSON.stringify(PORTFOLIO_EXTRACT_JSON_SCHEMA, null, 2)}`,
        },
        { role: "user", content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Document extract failed (${response.status}): ${text.slice(0, 300)}`)
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = stripJsonFence(json.choices?.[0]?.message?.content ?? "")
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error("Document extract returned non-JSON content")
  }
  return normalizePortfolioDocumentExtract(parsed)
}

export function portfolioExtractHasData(payload: PortfolioDocumentExtractPayload): boolean {
  return (
    payload.properties.length > 0 ||
    payload.residents.length > 0 ||
    payload.vendors.length > 0 ||
    payload.leases.length > 0 ||
    payload.units.length > 0 ||
    payload.maintenanceIssues.length > 0 ||
    payload.financialRecords.length > 0
  )
}
