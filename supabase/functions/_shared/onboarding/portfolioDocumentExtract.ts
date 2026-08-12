/**
 * GPT-4o portfolio extraction for onboarding fast-track uploads.
 * Extract only fields visibly present in the document — never invent demo data.
 */
import * as XLSX from "npm:xlsx@0.18.5"
import {
  isWordFile,
  wordBytesToPlainText,
  WORD_TEXT_LIMIT,
} from "./wordDocumentText.ts"

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
      fullName: "first and last name combined (never first name only when last name is visible)",
      firstName: "optional when columns are split",
      lastName: "optional when columns are split",
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
      residentName: "first and last name combined (never first name only when last name is visible)",
      firstName: "optional when columns are split",
      lastName: "optional when columns are split",
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
- For residents/tenants/lessees: always return the full person name (first and last) in fullName or residentName.
- When a rent roll or spreadsheet has separate first/last name columns (e.g. First Name, Last Name, Tenant First, Tenant Last), combine them into one full name. Never return only a first name if a last name appears in the same row.
- For every tenant/resident/lease row, include unit and building from the same row when shown (unit may appear as Unit, Apt, Suite, or Unit #; building may appear as Building, Property, or Property Name).
- Keep each tenant linked to the unit and building on their row — do not list tenants without their unit when the document shows both on the same line.
- On rent rolls and unit rosters, also populate the units array with one entry per distinct unit number, each with its building/property when shown.
- On rent rolls, populate the properties array with one entry per distinct property or building name/address shown in the document header, Property column, or Building column.
- Dates: YYYY-MM-DD when unambiguous; otherwise empty string.
- Phone numbers: include country code when shown; otherwise as printed.
- confidence: 0-100 for how clearly each row's fields appear in the document.
- Do not return placeholder or example people (no "John Doe", no sample@example.com).
- propertyType: use one of these exact values when the document states or clearly implies the type: single_family_home, multifamily, condo, townhouse, commercial. Map synonyms (e.g. "Single Family", "SFR", "Apartment Building", "Duplex") to the closest value. If property type is not stated or is ambiguous, use single_family_home unless the document clearly indicates a multifamily/apartment building or commercial use.

Return ONLY valid JSON matching the requested schema.`

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key])
    if (value) return value
  }
  return ""
}

export function resolveExtractedUnit(row: Record<string, unknown>): string {
  return readField(row, [
    "unit",
    "unitNumber",
    "unit_number",
    "unitLabel",
    "unit_label",
    "unitNo",
    "unit_no",
    "apt",
    "apartment",
    "suite",
    "flat",
    "space",
  ])
}

export function resolveExtractedBuilding(row: Record<string, unknown>): string {
  return readField(row, [
    "building",
    "buildingName",
    "building_name",
    "property",
    "propertyName",
    "property_name",
    "site",
    "community",
    "address",
    "location",
  ])
}

function readNameField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key])
    if (value) return value
  }
  return ""
}

/** Combine direct full-name fields with split first/last columns from rent rolls and leases. */
export function resolveExtractedPersonName(row: Record<string, unknown>): string {
  const first = readNameField(row, [
    "firstName",
    "first_name",
    "givenName",
    "given_name",
    "tenantFirstName",
    "tenant_first_name",
    "residentFirstName",
    "resident_first_name",
    "first",
  ])
  const middle = readNameField(row, ["middleName", "middle_name", "middle", "mi"])
  const last = readNameField(row, [
    "lastName",
    "last_name",
    "surname",
    "familyName",
    "family_name",
    "tenantLastName",
    "tenant_last_name",
    "residentLastName",
    "resident_last_name",
    "last",
  ])

  if (first && last) {
    return [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
  }

  const direct = readNameField(row, [
    "fullName",
    "full_name",
    "tenantName",
    "tenant_name",
    "residentName",
    "resident_name",
    "occupantName",
    "occupant_name",
    "lessee",
    "lessee_name",
    "name",
  ])

  if (direct && last && direct.split(/\s+/).length === 1 && !direct.toLowerCase().includes(last.toLowerCase())) {
    return `${direct} ${last}`.trim()
  }
  if (direct && first && direct.split(/\s+/).length === 1 && !direct.toLowerCase().includes(first.toLowerCase())) {
    return `${first} ${direct}`.trim()
  }
  if (direct) return direct
  if (first && last) return `${first} ${last}`.trim()
  if (first) return first
  if (last) return last
  return ""
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, 50))))
}

import { normalizeExtractedPropertyType } from "./propertyType.ts"

function normalizeProperty(row: Record<string, unknown>): PortfolioExtractProperty | null {
  const name = readField(row, [
    "name",
    "propertyName",
    "property_name",
    "buildingName",
    "building_name",
    "building",
    "site",
  ])
  const streetAddress = readField(row, [
    "streetAddress",
    "street_address",
    "address",
    "propertyAddress",
    "property_address",
    "location",
  ])
  if (!name && !streetAddress) return null
  return {
    name: name || streetAddress,
    streetAddress,
    city: asString(row.city),
    state: asString(row.state).toUpperCase().slice(0, 2),
    zipCode: asString(row.zipCode ?? row.zip_code),
    propertyType: normalizeExtractedPropertyType(
      readField(row, [
        "propertyType",
        "property_type",
        "type",
        "buildingType",
        "building_type",
        "assetType",
        "asset_type",
      ]) || row.propertyType || row.property_type,
    ),
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
      const label = resolveExtractedUnit(row) || asString(row.label)
      const building = resolveExtractedBuilding(row)
      if (!label && !building) return null
      return {
        label,
        building,
        confidence: clampConfidence(row.confidence),
      }
    }),
    residents: normalizeArray(root.residents, (row) => {
      const fullName = resolveExtractedPersonName(row)
      if (!fullName) return null
      return {
        fullName,
        unit: resolveExtractedUnit(row),
        building: resolveExtractedBuilding(row),
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
      const residentName = resolveExtractedPersonName(row)
      if (!residentName) return null
      return {
        residentName,
        unit: resolveExtractedUnit(row),
        building: resolveExtractedBuilding(row),
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
        unit: resolveExtractedUnit(row),
        building: resolveExtractedBuilding(row),
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

const TABULAR_TEXT_LIMIT = WORD_TEXT_LIMIT

function normalizeSpreadsheetHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
}

function isFullNameSpreadsheetHeader(header: string): boolean {
  const normalized = normalizeSpreadsheetHeader(header)
  if (!normalized || normalized === "name") return false
  return (
    normalized.includes("full name") ||
    normalized.includes("tenant name") ||
    normalized.includes("resident name") ||
    normalized.includes("occupant name") ||
    normalized.includes("lessee name") ||
    normalized === "tenant" ||
    normalized === "resident" ||
    normalized === "occupant" ||
    normalized === "lessee"
  )
}

function isFirstNameSpreadsheetHeader(header: string): boolean {
  const normalized = normalizeSpreadsheetHeader(header)
  if (!normalized || isFullNameSpreadsheetHeader(header)) return false
  return (
    normalized === "first" ||
    normalized === "fname" ||
    normalized === "given name" ||
    normalized === "given" ||
    /^first name$/.test(normalized) ||
    /^tenant first name$/.test(normalized) ||
    /^tenant first$/.test(normalized) ||
    /^resident first name$/.test(normalized) ||
    /^resident first$/.test(normalized) ||
    /^occupant first name$/.test(normalized) ||
    /^occupant first$/.test(normalized)
  )
}

function isLastNameSpreadsheetHeader(header: string): boolean {
  const normalized = normalizeSpreadsheetHeader(header)
  if (!normalized || isFullNameSpreadsheetHeader(header)) return false
  return (
    normalized === "last" ||
    normalized === "lname" ||
    normalized === "surname" ||
    normalized === "family name" ||
    normalized === "family" ||
    /^last name$/.test(normalized) ||
    /^tenant last name$/.test(normalized) ||
    /^tenant last$/.test(normalized) ||
    /^resident last name$/.test(normalized) ||
    /^resident last$/.test(normalized) ||
    /^occupant last name$/.test(normalized) ||
    /^occupant last$/.test(normalized)
  )
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === "," && !inQuotes) {
      out.push(current)
      current = ""
      continue
    }
    current += char
  }
  out.push(current)
  return out
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatCsvRow(values: string[]): string {
  return values.map((value) => escapeCsvField(value)).join(",")
}

/** Merge split first/last name columns so GPT always sees a single tenant name column. */
export function mergeSplitNameColumnsInCsv(csv: string): string {
  const lines = csv.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim().length > 0)
  if (headerIndex < 0) return csv

  const headers = parseCsvLine(lines[headerIndex] ?? "")
  if (headers.length === 0) return csv

  const firstIndex = headers.findIndex((header) => isFirstNameSpreadsheetHeader(header))
  const lastIndex = headers.findIndex((header) => isLastNameSpreadsheetHeader(header))
  if (firstIndex < 0 || lastIndex < 0) return csv

  const mergedHeader = "Tenant Name"
  const mergedHeaders = headers.filter((_, index) => index !== firstIndex && index !== lastIndex)
  mergedHeaders.splice(Math.min(firstIndex, lastIndex), 0, mergedHeader)

  const mergedLines = [formatCsvRow(mergedHeaders)]
  for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ""
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    if (cells.length === 0) continue

    const first = (cells[firstIndex] ?? "").trim()
    const last = (cells[lastIndex] ?? "").trim()
    const fullName = [first, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
    const mergedCells = cells.filter((_, index) => index !== firstIndex && index !== lastIndex)
    mergedCells.splice(Math.min(firstIndex, lastIndex), 0, fullName)
    mergedLines.push(formatCsvRow(mergedCells))
  }

  return mergedLines.join("\n")
}

export function mergeSplitNameColumnsInTabularText(text: string): string {
  if (!text.trim()) return text
  const sections = text.split(/\n\n---\n\n/)
  const merged = sections.map((section) => {
    const lines = section.split(/\r?\n/)
    const headerLineIndex = lines.findIndex((line) => line.trim().startsWith("Sheet:"))
    if (headerLineIndex < 0) {
      return mergeSplitNameColumnsInCsv(section)
    }
    const prefix = lines.slice(0, headerLineIndex + 1).join("\n")
    const csv = lines.slice(headerLineIndex + 1).join("\n")
    const mergedCsv = mergeSplitNameColumnsInCsv(csv)
    return mergedCsv.trim() ? `${prefix}\n${mergedCsv}` : prefix
  })
  return merged.join("\n\n---\n\n")
}

function isExcelFile(fileName: string, contentType: string): boolean {
  const lower = fileName.toLowerCase()
  if (/\.(xlsx?|xls)$/i.test(lower)) return true
  const type = contentType.toLowerCase()
  return (
    type.includes("spreadsheetml") ||
    type === "application/vnd.ms-excel" ||
    type === "application/excel"
  )
}

/** Convert workbook sheets to CSV-like text for GPT (same path as rent-roll CSV). */
export function excelBytesToTabularText(bytes: Uint8Array): string {
  try {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true, dense: true })
    const parts: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      if (!csv.trim()) continue
      parts.push(`Sheet: ${sheetName}\n${mergeSplitNameColumnsInCsv(csv)}`)
    }
    return mergeSplitNameColumnsInTabularText(parts.join("\n\n---\n\n")).slice(0, TABULAR_TEXT_LIMIT)
  } catch {
    return ""
  }
}

function buildUserContent(
  fileName: string,
  documentCategory: string,
  contentType: string,
  bytes: Uint8Array,
  options?: { spreadsheetText?: string; wordText?: string },
): Array<Record<string, unknown>> {
  const categoryHint = documentCategory
    ? `Document category hint from filename/rules: ${documentCategory}.`
    : ""
  const rentRollNameHint =
    documentCategory === "rent_roll" ||
    /rent\s*roll|tenant\s*list|resident\s*list/i.test(fileName)
      ? "Rent rolls often split tenant names into First Name and Last Name columns — combine both into fullName/residentName for each row. Also add one properties entry per distinct property/building name or address, plus one units entry per distinct unit number."
      : ""
  const intro = `File: ${fileName}\n${categoryHint}${rentRollNameHint ? `\n${rentRollNameHint}` : ""}\nExtract portfolio data from this document.`

  if (contentType === "text/csv" || fileName.toLowerCase().endsWith(".csv")) {
    const rawText = new TextDecoder().decode(bytes)
    const text = mergeSplitNameColumnsInCsv(rawText).slice(0, TABULAR_TEXT_LIMIT)
    return [
      { type: "text", text: `${intro}\n\nCSV contents:\n${text}` },
    ]
  }

  if (isExcelFile(fileName, contentType)) {
    const text = options?.spreadsheetText ?? excelBytesToTabularText(bytes)
    if (!text.trim()) {
      return [
        {
          type: "text",
          text:
            `${intro}\n\nCould not read rows from this spreadsheet. Try saving as CSV or check that the file is not empty or password-protected.`,
        },
      ]
    }
    return [
      {
        type: "text",
        text:
          `${intro}\n\nSpreadsheet contents (all sheets as tabular rows):\n${text}`,
      },
    ]
  }

  if (isWordFile(fileName, contentType)) {
    const text = options?.wordText ?? ""
    if (!text.trim()) {
      return [
        {
          type: "text",
          text:
            `${intro}\n\nCould not read text from this Word document. Check that the file is not empty or password-protected.`,
        },
      ]
    }
    return [
      {
        type: "text",
        text: `${intro}\n\nWord document text:\n${text}`,
      },
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
        `${intro}\n\nThis file type is not supported for automatic extraction. Upload PDF, CSV, Excel (.xlsx), Word (.doc/.docx), or clear photos/scans instead.`,
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
  let spreadsheetText: string | undefined
  if (isExcelFile(input.fileName, input.contentType)) {
    spreadsheetText = excelBytesToTabularText(input.bytes)
    if (!spreadsheetText.trim()) {
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
          "Could not read rows from this spreadsheet. Try saving as CSV or check that the file is not empty or password-protected.",
        ],
      }
    }
  }

  let wordText: string | undefined
  if (isWordFile(input.fileName, input.contentType)) {
    wordText = await wordBytesToPlainText(
      input.bytes,
      input.fileName,
      input.contentType,
    )
    if (!wordText.trim()) {
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
          "Could not read text from this Word document. Check that the file is not empty or password-protected.",
        ],
      }
    }
  }

  const userContent = buildUserContent(
    input.fileName,
    input.documentCategory,
    input.contentType,
    input.bytes,
    { spreadsheetText, wordText },
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
    const lower = text.toLowerCase()
    if (
      response.status === 401 ||
      response.status === 403 ||
      lower.includes("incorrect api key") ||
      lower.includes("invalid_api_key")
    ) {
      throw new Error(
        "Document scanning is not configured. Set a valid OPENAI_API_KEY on Supabase Edge secrets.",
      )
    }
    if (response.status === 429 || lower.includes("rate limit")) {
      throw new Error("Document scanning is busy right now. Please wait a moment and try again.")
    }
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
