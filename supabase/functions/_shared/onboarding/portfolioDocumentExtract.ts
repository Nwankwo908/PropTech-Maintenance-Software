/**
 * GPT-4o portfolio extraction for onboarding fast-track uploads.
 * Extract only fields visibly present in the document — never invent demo data.
 */
import * as XLSX from "npm:xlsx@0.18.5"
import {
  isPdfFile,
  MIN_PDF_TEXT_CHARS,
  pdfBytesToPageTexts,
} from "./pdfDocumentText.ts"
import { shrinkPdfForExtract } from "./pdfShrink.ts"
import { pdfPagesToJpegDataUrls } from "./pdfPageImages.ts"
import {
  isWordFile,
  wordBytesToPlainText,
  WORD_TEXT_LIMIT,
} from "./wordDocumentText.ts"
import {
  parseClassifierResponse,
  resolveTypedExtractKind,
  CLASSIFY_SYSTEM_PROMPT,
} from "../../../../shared/onboarding/typedDocumentExtract/classify.ts"
import {
  CLASSIFY_INSURANCE_SYSTEM_PROMPT,
  findRelevantInsurancePages,
  parseInsuranceTypeClassifierResponse,
  refineInsuranceExtractKind,
  slicePageTexts,
  insuranceDocumentTypeToKind,
} from "../../../../shared/onboarding/typedDocumentExtract/insuranceClassify.ts"
import { parseAndMapTypedExtract } from "../../../../shared/onboarding/typedDocumentExtract/parseAndMap.ts"
import {
  typedExtractIntro,
  typedExtractSystemPrompt,
} from "../../../../shared/onboarding/typedDocumentExtract/prompts.ts"
import {
  isTypedExtractKind,
  type TypedOrGenericExtractKind,
} from "../../../../shared/onboarding/typedDocumentExtract/types.ts"

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

export type PortfolioExtractAccount = {
  companyName: string
  contactName: string
  email: string
  phone: string
}

export type PortfolioExtractRoleFact = {
  role: string
  label: string
  value: string
  confidence: number
  needsReview: boolean
}

export type PortfolioExtractInsuranceCertificate = {
  document_type?: "certificate_of_liability_insurance"
  named_insured: string | null
  certificate_holder: string | null
  additional_insured: string[]
  producer_agency: string | null
  insurers: Array<{ name: string; policy_number: string | null }>
  policy_number: string | null
  effective_date: string | null
  expiration_date: string | null
  certificate_date: string | null
  general_liability?: string | null
  automobile_liability?: string | null
  workers_compensation?: string | null
  confidence: number
  warnings: string[]
}

export type PortfolioExtractDwellingPolicy = {
  document_type:
    | "dwelling_policy_declarations"
    | "homeowners_policy_declarations"
    | "commercial_property_policy"
  insurer_name: string | null
  policy_number: string | null
  policy_form: string | null
  transaction_type: string | null
  date_issued: string | null
  policy_effective_date: string | null
  policy_expiration_date: string | null
  named_insured_primary: string | null
  named_insured_secondary: string | null
  insured_mailing_address: string | null
  producer_agency_name: string | null
  insured_property_address: string | null
  total_annual_premium: number | null
  coverage_a_dwelling_limit: number | null
  coverage_c_personal_property_limit: number | null
  coverage_d_fair_rental_value_limit: number | null
  coverage_l_liability_limit: number | null
  deductible_all_other_perils: number | null
  hurricane_deductible_percent: number | null
  hurricane_deductible_amount: number | null
  mortgagee_name: string | null
  mortgagee_address: string | null
  loan_number: string | null
  occupancy_type: string | null
  property_use: string | null
  confidence?: number
  warnings?: string[]
}

export type PortfolioDocumentExtractPayload = {
  account: PortfolioExtractAccount
  properties: PortfolioExtractProperty[]
  units: PortfolioExtractUnit[]
  residents: PortfolioExtractResident[]
  vendors: PortfolioExtractVendor[]
  leases: PortfolioExtractLease[]
  maintenanceIssues: PortfolioExtractMaintenanceIssue[]
  financialRecords: PortfolioExtractFinancialRecord[]
  imageLabels: string[]
  warnings: string[]
  extractKind?: TypedOrGenericExtractKind
  roleFacts?: PortfolioExtractRoleFact[]
  insuranceCertificate?: PortfolioExtractInsuranceCertificate | null
  dwellingPolicy?: PortfolioExtractDwellingPolicy | null
}

export const PORTFOLIO_EXTRACT_JSON_SCHEMA = {
  account: {
    companyName: "landlord, lessor, owner, or management company as printed — not the tenant, not a street address",
    contactName: "business owner, landlord, or property manager person name — look in signature blocks, letterhead, 'Owner:', 'Landlord:', 'Lessor:', or party sections; empty only if truly absent",
    email: "landlord/owner/management email if shown, else empty",
    phone: "landlord/owner/management phone or contact number if shown anywhere in the document (header, footer, signature, contact section), else empty",
  },
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
- If the document is a vendor roster, preferred vendor list, contractor list, W-9, certificate of insurance, or vendor invoice, populate vendors[] with each company: name, trade/category, phone, and email. Do not put those companies in residents[] or properties[].
- If the document is an inspection report, walkthrough, or maintenance history, populate maintenanceIssues[] with each finding: description, unit, building, trade/category, and priority. Do not put those findings in residents[] or properties[].
- If the document is a P&L, operating statement, expense report, tax bill, or similar financial file, populate financialRecords[] with each line: recordType, description, amount, and period. Do not invent tenants from those rows.
- Extract ONLY information explicitly visible in the document. Never invent names, addresses, units, rents, or vendors.
- If nothing portfolio-related is present, return empty arrays and explain in warnings.
- Prefer exact text from the document over inference.
- For residents/tenants/lessees: always return the full person name (first and last) in fullName or residentName.
- When a rent roll or spreadsheet has separate first/last name columns (e.g. First Name, Last Name, Tenant First, Tenant Last), combine them into one full name. Never return only a first name if a last name appears in the same row.
- For every tenant/resident/lease row, include unit and building from the same row when shown (unit may appear as Unit, Apt, Suite, or Unit #; building may appear as Building, Property, or Property Name).
- Keep each tenant linked to the unit and building on their row — do not list tenants without their unit when the document shows both on the same line.
- On rent rolls and unit rosters, also populate the units array with one entry per distinct unit number, each with its building/property when shown.
- On rent rolls, populate the properties array with one entry per distinct property or building name/address shown in the document header, Property column, or Building column.
- If the document is a residential lease or occupancy agreement, populate properties[] with the premises (street address, city, state, zip), units[] with the leased unit, and residents[] plus leases[] with the tenant(s). Do not leave properties[] empty when the premises address is printed.
- account.companyName: the landlord / lessor / management company / property management firm as printed (letterhead, "Landlord:", "Lessor:", "Managed by:", LLC/Inc legal name). Never use a tenant name, unit number, or street address. Leave empty if the document does not show a company.
- account.contactName: the business owner, landlord, lessor, or property manager. Look in signature blocks, party definitions ("Landlord:", "Lessor:", "Owner:"), letterhead, and contact sections. Return the person's full name. Never copy tenant/lessee names into account.
- account.phone: the owner/landlord/management phone number. Look in headers, footers, letterhead, signature blocks, and contact sections. Never copy tenant phone numbers into account.
- Each real tenant belongs in residents[] once. If the same person appears on multiple pages, a rent roll, and a lease, return one resident row (and one leases[] row) and fill missing fields from all sources. Never duplicate a tenant because they showed up in more than one place.
- Dates: YYYY-MM-DD when unambiguous; otherwise empty string.
- Phone numbers: include country code when shown; otherwise as printed.
- confidence: 0-100 for how clearly each row's fields appear in the document.
- Do not return placeholder or example people (no "John Doe", no sample@example.com).
- Never put status labels, error copy, or commentary in data fields (no "needs attention", "needs review", "unknown", "n/a", "string"). Those are not tenants, properties, or leases.
- warnings: only real document caveats (illegible page, missing signature). Leave warnings empty when extraction succeeded. Do not echo schema examples into warnings.
- propertyType: use one of these exact values when the document states or clearly implies the type: single_family_home, multifamily, condo, townhouse, commercial. Map synonyms (e.g. "Single Family", "SFR", "Apartment Building", "Duplex") to the closest value. If property type is not stated or is ambiguous, use single_family_home unless the document clearly indicates a multifamily/apartment building or commercial use.

Return ONLY valid JSON matching the requested schema.`

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Drop model/status leftovers that are not real portfolio values. */
export function isExtractedPlaceholderValue(value: string): boolean {
  const lower = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
  if (!lower) return true
  if (
    /^(needs attention|needs review|ready for review|failed|error|n\/a|na|none|null|undefined|unknown|string|number|boolean|extraction note|not available|not found|not provided|not specified|unable to extract|unable to read|could not extract|could not read|see warning|see warnings)$/
      .test(lower)
  ) {
    return true
  }
  if (
    /extraction caveats|illegible sections|short visible labels from photos/.test(lower)
  ) {
    return true
  }
  return false
}

function cleanExtractedText(value: unknown): string {
  const text = asString(value)
  return isExtractedPlaceholderValue(text) ? "" : text
}

function readField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = cleanExtractedText(row[key])
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

export function resolveExtractedVendorName(row: Record<string, unknown>): string {
  return readField(row, [
    "name",
    "vendorName",
    "vendor_name",
    "companyName",
    "company_name",
    "company",
    "businessName",
    "business_name",
    "contractorName",
    "contractor_name",
    "vendor",
  ])
}

function readNameField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = cleanExtractedText(row[key])
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
  if (value == null || value === "") return 80
  return Math.max(0, Math.min(100, Math.round(asNumber(value, 80))))
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
    city: cleanExtractedText(row.city),
    state: cleanExtractedText(row.state).toUpperCase().slice(0, 2),
    zipCode: cleanExtractedText(row.zipCode ?? row.zip_code),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeExtractedAccount(root: Record<string, unknown>): PortfolioExtractAccount {
  const fromObject =
    asRecord(root.account) ??
    asRecord(root.landlord) ??
    asRecord(root.managementCompany) ??
    asRecord(root.management_company) ??
    asRecord(root.company)
  const nested = fromObject ?? root
  const companyName = readField(nested, [
    "companyName",
    "company_name",
    "legalName",
    "legal_name",
    "landlordName",
    "landlord_name",
    "landlord",
    "lessor",
    "lessorName",
    "lessor_name",
    "managementCompany",
    "management_company",
    "managedBy",
    "managed_by",
    "organization",
    "organisation",
    ...(fromObject ? ["name"] : []),
  ])
  return {
    companyName,
    contactName: readField(nested, [
      "contactName",
      "contact_name",
      "ownerName",
      "owner_name",
      "businessOwnerName",
      "business_owner_name",
      "landlordName",
      "landlord_name",
      "lessorName",
      "lessor_name",
      "propertyManager",
      "property_manager",
      "managerName",
      "manager_name",
      "signatoryName",
      "signatory_name",
    ]),
    email: readField(nested, [
      "email",
      "contactEmail",
      "contact_email",
      "ownerEmail",
      "owner_email",
    ]),
    phone: readField(nested, [
      "phone",
      "contactPhone",
      "contact_phone",
      "ownerPhone",
      "owner_phone",
      "contactNumber",
      "contact_number",
      "phoneNumber",
      "phone_number",
      "telephone",
      "tel",
    ]),
  }
}

export function normalizePortfolioDocumentExtract(raw: unknown): PortfolioDocumentExtractPayload {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    account: normalizeExtractedAccount(root),
    properties: normalizeArray(root.properties, normalizeProperty),
    units: normalizeArray(root.units, (row) => {
      const label = resolveExtractedUnit(row) || cleanExtractedText(row.label)
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
        phone: cleanExtractedText(row.phone),
        email: cleanExtractedText(row.email),
        leaseStart: cleanExtractedText(row.leaseStart ?? row.lease_start),
        leaseEnd: cleanExtractedText(row.leaseEnd ?? row.lease_end),
        monthlyRent: cleanExtractedText(row.monthlyRent ?? row.monthly_rent ?? row.rent),
        confidence: clampConfidence(row.confidence),
      }
    }),
    vendors: normalizeArray(
      root.vendors ?? root.contractors ?? root.preferredVendors ?? root.preferred_vendors,
      (row) => {
      const name = resolveExtractedVendorName(row)
      if (!name) return null
      return {
        name,
        category: cleanExtractedText(row.category ?? row.trade ?? row.service),
        phone: cleanExtractedText(row.phone ?? row.phoneNumber ?? row.phone_number),
        email: cleanExtractedText(row.email),
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
        leaseStart: cleanExtractedText(row.leaseStart ?? row.lease_start),
        leaseEnd: cleanExtractedText(row.leaseEnd ?? row.lease_end),
        rentAmount: cleanExtractedText(row.rentAmount ?? row.rent_amount ?? row.rent),
        securityDeposit: cleanExtractedText(row.securityDeposit ?? row.security_deposit),
        confidence: clampConfidence(row.confidence),
      }
    }),
    maintenanceIssues: normalizeArray(root.maintenanceIssues ?? root.maintenance_issues, (row) => {
      const description = cleanExtractedText(
        row.description ?? row.issue ?? row.finding ?? row.notes ?? row.problem ?? row.workPerformed,
      )
      if (!description) return null
      return {
        unit: resolveExtractedUnit(row),
        building: resolveExtractedBuilding(row),
        category: cleanExtractedText(row.category ?? row.trade ?? row.issueType),
        description,
        priority: cleanExtractedText(row.priority) || "normal",
        confidence: clampConfidence(row.confidence),
      }
    }),
    financialRecords: normalizeArray(root.financialRecords ?? root.financial_records ?? root.expenses, (row) => {
      const recordType = cleanExtractedText(row.recordType ?? row.record_type ?? row.type ?? row.category)
      const amount = cleanExtractedText(row.amount ?? row.total ?? row.value)
      const description = cleanExtractedText(
        row.description ?? row.lineItem ?? row.line_item ?? row.item ?? row.memo ?? row.category,
      ) || recordType
      if (!description && !amount) return null
      return {
        recordType,
        description: description || amount,
        amount,
        period: cleanExtractedText(row.period ?? row.date ?? row.month),
        confidence: clampConfidence(row.confidence),
      }
    }),
    imageLabels: Array.isArray(root.imageLabels)
      ? root.imageLabels.map((v) => cleanExtractedText(v)).filter(Boolean).slice(0, 12)
      : [],
    warnings: Array.isArray(root.warnings)
      ? root.warnings.map((v) => cleanExtractedText(v)).filter(Boolean).slice(0, 8)
      : [],
    extractKind: "generic",
    roleFacts: [],
    insuranceCertificate: null,
    dwellingPolicy: null,
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

export function pdfNeedsNativeFileRead(pdfText: string | undefined): boolean {
  return (pdfText ?? "").trim().length < MIN_PDF_TEXT_CHARS
}

export function classifyOpenAiExtractError(
  status: number,
  text: string,
): "auth" | "quota" | "busy" | "too_large" | "other" {
  const lower = text.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key")
  ) {
    return "auth"
  }
  if (lower.includes("insufficient_quota") || lower.includes("exceeded your current quota")) {
    return "quota"
  }
  if (
    status === 413 ||
    lower.includes("context_length") ||
    lower.includes("maximum context") ||
    lower.includes("request too large") ||
    lower.includes("payload too large")
  ) {
    return "too_large"
  }
  if (
    status === 429 ||
    status === 529 ||
    lower.includes("rate limit") ||
    lower.includes("overloaded")
  ) {
    return "busy"
  }
  return "other"
}

export function openAiExtractErrorMessage(status: number, text: string): string {
  const kind = classifyOpenAiExtractError(status, text)
  if (kind === "auth") {
    return "Document scanning is not configured. Set a valid OPENAI_API_KEY on Supabase Edge secrets."
  }
  if (kind === "quota") {
    return "Document scanning is temporarily unavailable. Try again in a few minutes."
  }
  if (kind === "too_large" || kind === "busy") {
    return kind === "too_large"
      ? "We couldn’t read this document automatically. Export it as a JPG or a text-based PDF and try again."
      : "Document scanning is busy right now. Please wait a moment and try again."
  }
  return `Document extract failed (${status}): ${text.slice(0, 300)}`
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(seconds * 1000, 20_000)
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchOpenAiExtract(
  url: string,
  apiKey: string,
  body: unknown,
  options?: { maxAttempts?: number },
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 4
  let lastStatus = 0
  let lastText = ""
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (response.ok) return response
    lastStatus = response.status
    lastText = await response.text().catch(() => "")
    console.error("[onboarding-extract] openai", lastStatus, lastText.slice(0, 400))
    const retryable =
      classifyOpenAiExtractError(lastStatus, lastText) === "busy" && attempt < maxAttempts - 1
    if (!retryable) break
    await sleepMs(retryAfterMs(response) ?? 1000 * 2 ** attempt)
  }
  throw new Error(openAiExtractErrorMessage(lastStatus, lastText))
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

function parseExtractedJson(
  content: string,
  kind: TypedOrGenericExtractKind = "generic",
): PortfolioDocumentExtractPayload {
  const parsed = JSON.parse(stripJsonFence(content)) as unknown
  if (isTypedExtractKind(kind)) {
    const mapped = parseAndMapTypedExtract(kind, parsed)
    return {
      account: mapped.account,
      properties: mapped.properties,
      units: mapped.units,
      residents: mapped.residents,
      vendors: mapped.vendors,
      leases: mapped.leases,
      maintenanceIssues: mapped.maintenanceIssues,
      financialRecords: mapped.financialRecords,
      imageLabels: mapped.imageLabels,
      warnings: mapped.warnings,
      extractKind: mapped.extractKind,
      roleFacts: mapped.roleFacts,
      insuranceCertificate: mapped.insuranceCertificate,
      dwellingPolicy: mapped.dwellingPolicy,
    }
  }
  return normalizePortfolioDocumentExtract(parsed)
}

const EXTRACT_SYSTEM_PROMPT =
  SYSTEM_PROMPT +
  `\n\nJSON schema:\n${JSON.stringify(PORTFOLIO_EXTRACT_JSON_SCHEMA, null, 2)}`

function systemPromptForKind(kind: TypedOrGenericExtractKind): string {
  if (isTypedExtractKind(kind)) {
    return typedExtractSystemPrompt(kind)
  }
  return EXTRACT_SYSTEM_PROMPT
}

async function extractWithChatCompletions(
  apiKey: string,
  userContent: Array<Record<string, unknown>>,
  kind: TypedOrGenericExtractKind = "generic",
): Promise<PortfolioDocumentExtractPayload> {
  const response = await fetchOpenAiExtract(
    "https://api.openai.com/v1/chat/completions",
    apiKey,
    {
      model: "gpt-4o",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPromptForKind(kind) },
        { role: "user", content: userContent },
      ],
    },
  )
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content ?? ""
  try {
    return parseExtractedJson(content, kind)
  } catch {
    throw new Error("Document extract returned non-JSON content")
  }
}

async function extractPdfViaPageImages(input: {
  apiKey: string
  introText: string
  bytes: Uint8Array
  kind: TypedOrGenericExtractKind
  pageNumbers?: number[]
}): Promise<PortfolioDocumentExtractPayload | null> {
  let urls: string[]
  try {
    urls = await pdfPagesToJpegDataUrls(input.bytes, {
      maxPages: 3,
      maxEdge: 1280,
      pageNumbers: input.pageNumbers,
    })
  } catch (error) {
    console.warn(
      "[onboarding-extract] pdf rasterize",
      error instanceof Error ? error.message : error,
    )
    return null
  }
  if (urls.length === 0) return null

  const counts = urls.length > 1 ? [Math.min(urls.length, 2), 1] : [1]
  let lastError: Error | null = null
  for (const count of counts) {
    const pageUrls = urls.slice(0, count)
    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `${input.introText}\nThe following images are pages from the uploaded PDF.`,
      },
      ...pageUrls.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    ]
    try {
      const extracted = await extractWithChatCompletions(input.apiKey, userContent, input.kind)
      if (urls.length > count) {
        extracted.warnings = [
          `Scanned the first ${count} of ${urls.length}+ pages. Upload a JPG or shorter PDF if details are missing.`,
          ...extracted.warnings,
        ]
      }
      return extracted
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Document extract failed")
      const message = lastError.message.toLowerCase()
      if (!message.includes("busy") && !message.includes("too large") && !message.includes("couldn’t read")) {
        throw lastError
      }
    }
  }
  if (lastError) throw lastError
  return null
}

const EXTRACT_PDF_MODEL = "gpt-4o-mini"

async function uploadOpenAiUserFile(
  apiKey: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const form = new FormData()
  form.append("purpose", "user_data")
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`,
  )
  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!response.ok) {
    throw new Error(
      openAiExtractErrorMessage(response.status, await response.text().catch(() => "")),
    )
  }
  const json = (await response.json()) as { id?: string }
  const id = json.id?.trim()
  if (!id) throw new Error("Document extract failed: missing file id")
  return id
}

async function deleteOpenAiFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    /* best-effort */
  }
}

function unreadPdfScanError(_byteLength: number): Error {
  return new Error(
    "We couldn’t read this PDF automatically. Export it as a JPG or a text-based PDF and try again.",
  )
}

/** Chat Completions ignores PDF `file` parts; Responses API actually reads the PDF. */
async function extractWithResponsesPdf(input: {
  apiKey: string
  fileName: string
  introText: string
  bytes: Uint8Array
  kind: TypedOrGenericExtractKind
  pageNumbers?: number[]
}): Promise<PortfolioDocumentExtractPayload> {
  const prompt = systemPromptForKind(input.kind)
  const pageCap = input.pageNumbers && input.pageNumbers.length > 0 ? Math.max(input.pageNumbers.length, 3) : 4
  const attempts = [
    { maxPages: pageCap, maxBytes: 900_000, pageNumbers: input.pageNumbers },
    { maxPages: Math.min(2, pageCap), maxBytes: 450_000, pageNumbers: input.pageNumbers },
  ]
  let lastSentBytes = -1
  let lastError: Error | null = null

  for (const attempt of attempts) {
    const shrunk = await shrinkPdfForExtract(input.bytes, attempt)
    if (shrunk.bytes.length === lastSentBytes) continue
    lastSentBytes = shrunk.bytes.length
    console.log(
      "[onboarding-extract] pdf",
      `pages=${shrunk.pageCount} using=${shrunk.usedPages} bytes=${shrunk.bytes.length} model=${EXTRACT_PDF_MODEL}`,
    )
    let fileId: string | null = null
    try {
      let response: Response
      try {
        fileId = await uploadOpenAiUserFile(input.apiKey, input.fileName, shrunk.bytes)
        response = await fetchOpenAiExtract(
          "https://api.openai.com/v1/responses",
          input.apiKey,
          {
            model: EXTRACT_PDF_MODEL,
            text: { format: { type: "json_object" } },
            input: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: [
                  { type: "input_file", file_id: fileId },
                  { type: "input_text", text: input.introText },
                ],
              },
            ],
          },
          { maxAttempts: 2 },
        )
      } catch (uploadOrCallError) {
        if (fileId) {
          throw uploadOrCallError
        }
        response = await fetchOpenAiExtract(
          "https://api.openai.com/v1/responses",
          input.apiKey,
          {
            model: EXTRACT_PDF_MODEL,
            text: { format: { type: "json_object" } },
            input: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: [
                  {
                    type: "input_file",
                    filename: input.fileName.toLowerCase().endsWith(".pdf")
                      ? input.fileName
                      : `${input.fileName}.pdf`,
                    file_data: `data:application/pdf;base64,${bytesToBase64(shrunk.bytes)}`,
                  },
                  { type: "input_text", text: input.introText },
                ],
              },
            ],
          },
          { maxAttempts: 2 },
        )
      }
      const content = readResponsesOutputText(await response.json())
      let extracted: PortfolioDocumentExtractPayload
      try {
        extracted = parseExtractedJson(content, input.kind)
      } catch {
        throw new Error("Document extract returned non-JSON content")
      }
      if (shrunk.usedPages < shrunk.pageCount) {
        const range =
          shrunk.pageNumbers.length > 0
            ? `pages ${shrunk.pageNumbers[0]}–${shrunk.pageNumbers[shrunk.pageNumbers.length - 1]}`
            : `the first ${shrunk.usedPages} pages`
        extracted.warnings = [
          `Scanned ${range} of ${shrunk.pageCount} pages. Upload a shorter PDF if details are missing.`,
          ...extracted.warnings,
        ]
      }
      return extracted
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Document extract failed")
      const message = lastError.message.toLowerCase()
      if (!message.includes("busy") && !message.includes("too large")) throw lastError
    } finally {
      if (fileId) await deleteOpenAiFile(input.apiKey, fileId)
    }
  }

  throw lastError && input.bytes.length > 5 * 1024 * 1024
    ? lastError
    : unreadPdfScanError(input.bytes.length)
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

function leaseDocumentHint(fileName: string, documentCategory: string): string {
  if (
    documentCategory === "lease_agreement" ||
    /lease|tenancy|rental\s+agreement|occupancy\s+agreement/i.test(fileName)
  ) {
    return "This is a residential lease or occupancy agreement. Extract the premises into properties[] (name/streetAddress, city, state, zipCode), the unit into units[], and the tenant(s), unit, property address, lease start, lease end, monthly rent, and security deposit into residents[] and leases[]. Do not return empty arrays when those fields are printed in the document."
  }
  return ""
}

function vendorDocumentHint(fileName: string, documentCategory: string): string {
  if (
    documentCategory === "vendor_contract" ||
    documentCategory === "vendor_invoice" ||
    documentCategory === "w9_form" ||
    /\b(vendor|contractor|preferred.?vendor|w-?9)\b/i.test(fileName)
  ) {
    return "This file is vendor information (roster, preferred vendor list, W-9, insurance certificate, or vendor invoice). Populate vendors[] with every company listed: name, trade/category, phone, and email. If this is an invoice, also add billed line items to financialRecords[] (description, amount, period). Do not treat vendor companies as residents, tenants, or properties."
  }
  return ""
}

function maintenanceDocumentHint(fileName: string, documentCategory: string): string {
  if (
    documentCategory === "inspection_report" ||
    /inspection|walkthrough|maintenance.?history|repair.?history|service.?history/i.test(fileName)
  ) {
    return "This file is an inspection report or maintenance history. Populate maintenanceIssues[] with every finding or past job: description, unit, building, trade/category, and priority. Do not treat those rows as residents or properties."
  }
  return ""
}

function financialDocumentHint(fileName: string, documentCategory: string): string {
  if (
    documentCategory === "property_statement" ||
    documentCategory === "expense_report" ||
    documentCategory === "property_tax" ||
    /financial|p&l|profit|expense|receipt|statement|t-?12/i.test(fileName)
  ) {
    return "This file is a financial statement, expense report, or tax record. Populate financialRecords[] with every line: recordType, description, amount, and period. Do not treat those rows as residents or vendors."
  }
  return ""
}

export function buildUserContent(
  fileName: string,
  documentCategory: string,
  contentType: string,
  bytes: Uint8Array,
  options?: { spreadsheetText?: string; wordText?: string; pdfText?: string; extractKind?: TypedOrGenericExtractKind },
): Array<Record<string, unknown>> {
  const kind = options?.extractKind ?? resolveTypedExtractKind(fileName, documentCategory)
  const typed = isTypedExtractKind(kind)
  const categoryHint = documentCategory
    ? `Document category hint from filename/rules: ${documentCategory}.`
    : ""
  const rentRollNameHint =
    !typed &&
    (documentCategory === "rent_roll" ||
      /rent\s*roll|tenant\s*list|resident\s*list/i.test(fileName))
      ? "Rent rolls often split tenant names into First Name and Last Name columns — combine both into fullName/residentName for each row. Also add one properties entry per distinct property/building name or address, plus one units entry per distinct unit number."
      : ""
  const leaseHint = typed ? "" : leaseDocumentHint(fileName, documentCategory)
  const vendorHint = typed ? "" : vendorDocumentHint(fileName, documentCategory)
  const maintenanceHint = typed ? "" : maintenanceDocumentHint(fileName, documentCategory)
  const financialHint = typed ? "" : financialDocumentHint(fileName, documentCategory)
  const extraHints = [rentRollNameHint, leaseHint, vendorHint, maintenanceHint, financialHint]
    .filter(Boolean)
    .join("\n")
  const intro = typed
    ? `${typedExtractIntro(kind, fileName)}\n${categoryHint}`
    : `File: ${fileName}\n${categoryHint}${extraHints ? `\n${extraHints}` : ""}\nExtract portfolio data from this document.`

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

  if (isPdfFile(fileName, contentType)) {
    const pdfText = options?.pdfText ?? ""
    if (pdfText.trim()) {
      return [
        {
          type: "text",
          text: `${intro}\n\nPDF text:\n${pdfText}`,
        },
      ]
    }
    return [
      {
        type: "text",
        text:
          `${intro}\n\nThis PDF has no extractable text layer. Read the attached PDF file (including scanned pages).`,
      },
    ]
  }

  const mediaType = contentType.startsWith("image/")
    ? contentType
    : "image/jpeg"

  if (mediaType.startsWith("image/")) {
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

async function classifyUnknownDocumentType(
  apiKey: string,
  snippet: string,
): Promise<TypedOrGenericExtractKind> {
  const sample = snippet.trim().slice(0, 2500)
  if (!sample) return "unknown"
  try {
    const response = await fetchOpenAiExtract(
      "https://api.openai.com/v1/chat/completions",
      apiKey,
      {
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: sample },
        ],
      },
      { maxAttempts: 2 },
    )
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content ?? "{}"
    return parseClassifierResponse(JSON.parse(stripJsonFence(content)))
  } catch {
    return "unknown"
  }
}

async function classifyInsuranceSubtype(
  apiKey: string,
  snippet: string,
  fileName: string,
  pageImages: string[] = [],
): Promise<TypedOrGenericExtractKind> {
  const fromRules = refineInsuranceExtractKind("insurance", snippet, fileName)
  if (fromRules !== "insurance") return fromRules
  const sample = snippet.trim().slice(0, 4000)
  const userContent: Array<Record<string, unknown>> = sample
    ? [{ type: "text", text: `File: ${fileName}\n${sample}` }]
    : pageImages.slice(0, 2).map((url) => ({
        type: "image_url",
        image_url: { url, detail: "low" },
      }))
  if (userContent.length === 0) return "insurance"
  if (!sample && pageImages.length > 0) {
    userContent.unshift({
      type: "text",
      text: `File: ${fileName}\nClassify this insurance document. Do not assume it is a COI.`,
    })
  }
  try {
    const response = await fetchOpenAiExtract(
      "https://api.openai.com/v1/chat/completions",
      apiKey,
      {
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_INSURANCE_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      },
      { maxAttempts: 2 },
    )
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content ?? "{}"
    return insuranceDocumentTypeToKind(
      parseInsuranceTypeClassifierResponse(JSON.parse(stripJsonFence(content))),
    )
  } catch {
    return "insurance"
  }
}

function emptyExtractPayload(warnings: string[]): PortfolioDocumentExtractPayload {
  return {
    account: { companyName: "", contactName: "", email: "", phone: "" },
    properties: [],
    units: [],
    residents: [],
    vendors: [],
    leases: [],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings,
    extractKind: "generic",
    roleFacts: [],
    insuranceCertificate: null,
    dwellingPolicy: null,
  }
}

export async function extractPortfolioDocument(input: {
  apiKey: string
  fileName: string
  documentCategory: string
  contentType: string
  bytes: Uint8Array
  pageImages?: string[]
  insuranceIntent?: "property_policy" | "auto"
}): Promise<PortfolioDocumentExtractPayload> {
  let kind = resolveTypedExtractKind(input.fileName, input.documentCategory)
  const pageImages = (input.pageImages ?? [])
    .map((item) => item.trim())
    .filter((item) => item.startsWith("data:image/"))
    .slice(0, 3)
  const hasPdfBytes = input.bytes.length > 0 && isPdfFile(input.fileName, input.contentType)

  let pdfPageTexts: string[] = []
  if (hasPdfBytes) {
    pdfPageTexts = await pdfBytesToPageTexts(input.bytes)
  }

  const insuranceFlow =
    kind === "insurance" ||
    kind === "insurance_certificate" ||
    kind === "dwelling_policy_declarations" ||
    kind === "homeowners_policy_declarations" ||
    kind === "commercial_property_policy" ||
    input.documentCategory.trim().toLowerCase() === "insurance_certificate" ||
    input.documentCategory.trim().toLowerCase() === "property_insurance"

  let insurancePageNumbers: number[] | undefined
  if (insuranceFlow) {
    const snippet = pdfPageTexts.join("\n")
    if (snippet.trim()) {
      kind = refineInsuranceExtractKind(
        kind === "generic" ? "insurance" : kind,
        snippet,
        input.fileName,
      )
      const pages = findRelevantInsurancePages(pdfPageTexts)
      if (pages.length > 0) insurancePageNumbers = pages
    }
    if (kind === "insurance") {
      kind = await classifyInsuranceSubtype(
        input.apiKey,
        snippet,
        input.fileName,
        pageImages,
      )
    }
    const propertyPolicy =
      input.insuranceIntent === "property_policy" ||
      input.documentCategory.trim().toLowerCase() === "property_insurance"
    if (kind === "insurance" && propertyPolicy) {
      kind = "dwelling_policy_declarations"
    }
    if (kind === "insurance_certificate" && propertyPolicy) {
      const text = snippet.toUpperCase()
      if (!text.includes("CERTIFICATE OF LIABILITY INSURANCE") && !text.includes("CERTIFICATE HOLDER")) {
        kind = "dwelling_policy_declarations"
      }
    }
    if (kind === "insurance") {
      return emptyExtractPayload([
        "Could not determine this insurance document type. Upload the declarations page or a Certificate of Liability Insurance.",
      ])
    }
  }

  if (pageImages.length > 0 && (!hasPdfBytes || !pdfPageTexts.some((page) => page.trim()))) {
    if (kind === "unknown") {
      kind = "generic"
    }
    if (kind === "insurance") {
      kind = "dwelling_policy_declarations"
    }
    const intro = isTypedExtractKind(kind)
      ? typedExtractIntro(kind, input.fileName)
      : `File: ${input.fileName}\nDocument category hint: ${input.documentCategory || "unknown"}.\nThe following images are pages from a scanned PDF. Extract portfolio data from them.`
    return await extractWithChatCompletions(
      input.apiKey,
      [
        { type: "text", text: intro },
        ...pageImages.map((url) => ({
          type: "image_url",
          image_url: { url, detail: "low" },
        })),
      ],
      kind,
    )
  }

  let spreadsheetText: string | undefined
  if (isExcelFile(input.fileName, input.contentType)) {
    spreadsheetText = excelBytesToTabularText(input.bytes)
    if (!spreadsheetText.trim()) {
      return emptyExtractPayload([
        "Could not read rows from this spreadsheet. Try saving as CSV or check that the file is not empty or password-protected.",
      ])
    }
  }

  let pdfText: string | undefined
  if (hasPdfBytes) {
    pdfText =
      insurancePageNumbers && insurancePageNumbers.length > 0
        ? slicePageTexts(pdfPageTexts, insurancePageNumbers)
        : pdfPageTexts.join("\n\n")
    if (pdfText) pdfText = pdfText.slice(0, 120_000)
  }

  let wordText: string | undefined
  if (isWordFile(input.fileName, input.contentType)) {
    wordText = await wordBytesToPlainText(
      input.bytes,
      input.fileName,
      input.contentType,
    )
    if (!wordText.trim()) {
      return emptyExtractPayload([
        "Could not read text from this Word document. Check that the file is not empty or password-protected.",
      ])
    }
  }

  if (
    input.contentType.toLowerCase().startsWith("image/") &&
    input.bytes.length > 3_500_000
  ) {
    throw new Error(
      "We couldn’t read this image automatically. Try a smaller JPG or a text-based PDF.",
    )
  }

  if (kind === "unknown") {
    const snippet = [spreadsheetText, wordText, pdfText].filter(Boolean).join("\n")
    kind = await classifyUnknownDocumentType(input.apiKey, snippet)
    if (kind === "unknown") kind = "generic"
    if (kind === "insurance") {
      kind = await classifyInsuranceSubtype(input.apiKey, snippet, input.fileName, pageImages)
      if (kind === "insurance") {
        return emptyExtractPayload([
          "Could not determine this insurance document type. Upload the declarations page or a Certificate of Liability Insurance.",
        ])
      }
    }
  }

  const userContent = buildUserContent(
    input.fileName,
    input.documentCategory,
    input.contentType,
    input.bytes,
    { spreadsheetText, wordText, pdfText, extractKind: kind },
  )

  const introText = userContent
    .filter((part) => part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n")

  if (isPdfFile(input.fileName, input.contentType) && pdfNeedsNativeFileRead(pdfText)) {
    const fromImages = await extractPdfViaPageImages({
      apiKey: input.apiKey,
      introText,
      bytes: input.bytes,
      kind,
      pageNumbers: insurancePageNumbers,
    })
    if (fromImages) return fromImages
    try {
      return await extractWithResponsesPdf({
        apiKey: input.apiKey,
        fileName: input.fileName,
        introText,
        bytes: input.bytes,
        kind,
        pageNumbers: insurancePageNumbers,
      })
    } catch (err) {
      if ((pdfText ?? "").trim().length >= 40) {
        return await extractWithChatCompletions(input.apiKey, userContent, kind)
      }
      throw err
    }
  }

  const extracted = await extractWithChatCompletions(input.apiKey, userContent, kind)
  if (
    isPdfFile(input.fileName, input.contentType) &&
    extractLooksUnread(extracted)
  ) {
    return await extractWithResponsesPdf({
      apiKey: input.apiKey,
      fileName: input.fileName,
      introText,
      bytes: input.bytes,
      kind,
      pageNumbers: insurancePageNumbers,
    })
  }
  return extracted
}

export function portfolioExtractHasData(payload: PortfolioDocumentExtractPayload): boolean {
  return (
    Boolean(payload.account?.companyName?.trim()) ||
    payload.properties.length > 0 ||
    payload.residents.length > 0 ||
    payload.vendors.length > 0 ||
    payload.leases.length > 0 ||
    payload.units.length > 0 ||
    payload.maintenanceIssues.length > 0 ||
    payload.financialRecords.length > 0 ||
    Boolean(payload.insuranceCertificate?.named_insured) ||
    Boolean(payload.insuranceCertificate?.certificate_holder) ||
    Boolean(payload.dwellingPolicy?.named_insured_primary) ||
    Boolean(payload.dwellingPolicy?.insured_property_address) ||
    (payload.roleFacts?.length ?? 0) > 0
  )
}

export function extractLooksUnread(payload: PortfolioDocumentExtractPayload): boolean {
  if (portfolioExtractHasData(payload)) return false
  const blob = payload.warnings.join(" ").toLowerCase()
  return /no content|could not (be )?read|unable to (read|extract)|did not (receive|contain|include)|empty document|no (visible|readable) (text|content)|nothing to extract/.test(
    blob,
  )
}
