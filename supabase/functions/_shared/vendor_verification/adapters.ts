/**
 * Vendor verification adapters.
 *
 * License → StateLicense.io
 * Insurance → uploaded COI parse (OpenAI) + optional Certificial tracking
 * Background → simulated Checkr seam until a live Checkr key is wired
 */
import { lookupCertificialCoverage } from "./certificialApi.ts"
import {
  mapBoardStatus,
  normalizeLicenseState,
  searchStateLicense,
  verifyStateLicense,
  type StateLicenseLookup,
} from "./stateLicenseApi.ts"

export type LicenseVerifyInput = {
  businessName?: string | null
  contactName?: string | null
  licenseState?: string | null
  licenseNumber?: string | null
  tradeCategories?: string[] | null
}

export type LicenseVerifyResult = {
  simulated: boolean
  status: "verified" | "active" | "not_found" | "expired"
  licenseNumber: string | null
  licenseType: string | null
  boardLabel: string
  detail: string
  expirationDate: string | null
}

export type CoiParseInput = {
  fileName?: string | null
  contentType?: string | null
  bytes?: Uint8Array | null
  businessName?: string | null
}

export type CoiParseResult = {
  simulated: boolean
  status: "verified" | "review"
  carrier: string | null
  policyNumber: string | null
  generalLiability: number | null
  expirationDate: string | null
  additionalInsured: boolean
  detail: string
}

export type BackgroundStartInput = {
  contactName?: string | null
  email?: string | null
}

export type BackgroundStartResult = {
  simulated: true
  ref: string
  status: "clear" | "pending" | "consider"
  detail: string
}

export type BackgroundStatusResult = {
  simulated: true
  status: "clear" | "pending" | "consider"
  ref: string
  detail: string
}

const MIN_GENERAL_LIABILITY = 1_000_000

function boardLabelForTrade(trades: string[] | null | undefined): string {
  const trade = (trades ?? []).join(" ").toLowerCase()
  if (trade.includes("plumb")) return "State Plumbing Contractor Board"
  if (trade.includes("hvac")) return "State HVAC Contractor Board"
  if (trade.includes("elect")) return "State Electrical Contractor Board"
  if (trade.includes("roof")) return "State Roofing Contractor Board"
  if (trade.includes("pest")) return "State Pest Control Board"
  return "State Professional Licensing Board"
}

function fallbackBoardLabel(authority: string | null, trades: string[] | null | undefined): string {
  return authority?.trim() || boardLabelForTrade(trades)
}

function resultFromLookup(
  lookup: StateLicenseLookup,
  trades: string[] | null | undefined,
): LicenseVerifyResult {
  if (!lookup.ok) {
    return {
      simulated: false,
      status: lookup.reason === "not_found" ? "not_found" : "not_found",
      licenseNumber: null,
      licenseType: null,
      boardLabel: boardLabelForTrade(trades),
      detail: lookup.detail,
      expirationDate: null,
    }
  }
  const status = mapBoardStatus(
    lookup.record.status,
    lookup.record.expirationDate,
    lookup.valid,
  )
  const boardLabel = fallbackBoardLabel(lookup.record.authority, trades)
  const number = lookup.record.licenseNumber
  const exp = lookup.record.expirationDate
  if (status === "expired") {
    return {
      simulated: false,
      status,
      licenseNumber: number,
      licenseType: lookup.record.licenseType,
      boardLabel,
      detail: number
        ? `${number} · Expired · ${boardLabel}`
        : `License expired · ${boardLabel}`,
      expirationDate: exp,
    }
  }
  if (status === "not_found") {
    return {
      simulated: false,
      status: "not_found",
      licenseNumber: number,
      licenseType: lookup.record.licenseType,
      boardLabel,
      detail: "No match in the state licensing database.",
      expirationDate: exp,
    }
  }
  return {
    simulated: false,
    status,
    licenseNumber: number,
    licenseType: lookup.record.licenseType,
    boardLabel,
    detail: number
      ? `${number} · Active · ${boardLabel}`
      : `Active · ${boardLabel}`,
    expirationDate: exp,
  }
}

/** State licensing board lookup (StateLicense.io). */
export async function verifyLicense(input: LicenseVerifyInput): Promise<LicenseVerifyResult> {
  const state = normalizeLicenseState(input.licenseState)
  const licenseNumber = (input.licenseNumber ?? "").trim()
  const businessName = (input.businessName ?? "").trim() || (input.contactName ?? "").trim()

  if (licenseNumber) {
    if (!state) {
      return {
        simulated: false,
        status: "not_found",
        licenseNumber,
        licenseType: null,
        boardLabel: boardLabelForTrade(input.tradeCategories),
        detail: "Enter a two-letter license state so we can check the licensing board.",
        expirationDate: null,
      }
    }
    const lookup = await verifyStateLicense({ state, licenseNumber })
    return resultFromLookup(lookup, input.tradeCategories)
  }

  if (!businessName) {
    return {
      simulated: false,
      status: "not_found",
      licenseNumber: null,
      licenseType: null,
      boardLabel: boardLabelForTrade(input.tradeCategories),
      detail: "Enter a license number or business name to check the licensing board.",
      expirationDate: null,
    }
  }

  const lookup = await searchStateLicense({ state, businessName })
  return resultFromLookup(lookup, input.tradeCategories)
}

export type LicenseScanInput = {
  fileName?: string | null
  contentType?: string | null
  bytes?: Uint8Array | null
  businessName?: string | null
  contactName?: string | null
  licenseState?: string | null
  tradeCategories?: string[] | null
}

export type LicenseScanResult = {
  simulated: boolean
  status: "active" | "expired" | "not_found"
  licenseNumber: string | null
  licenseType: string | null
  licenseState: string | null
  boardLabel: string
  expirationDate: string | null
  detail: string
}

/** Read a license document, then confirm the number against the state board. */
export async function scanLicenseDocument(input: LicenseScanInput): Promise<LicenseScanResult> {
  const bytes = input.bytes
  if (!bytes || bytes.byteLength === 0) {
    return {
      simulated: false,
      status: "not_found",
      licenseNumber: null,
      licenseType: null,
      licenseState: normalizeLicenseState(input.licenseState),
      boardLabel: boardLabelForTrade(input.tradeCategories),
      expirationDate: null,
      detail: "Upload a license photo or PDF so we can read the number.",
    }
  }

  const { extractLicenseFieldsFromDocument } = await import("./documentExtract.ts")
  const extracted = await extractLicenseFieldsFromDocument({
    fileName: input.fileName ?? "license",
    contentType: input.contentType ?? "application/octet-stream",
    bytes,
  })
  const state = normalizeLicenseState(extracted.licenseState ?? input.licenseState)
  const number = extracted.licenseNumber?.trim() || ""

  if (number && state) {
    const verified = await verifyLicense({
      businessName: input.businessName,
      contactName: input.contactName,
      licenseState: state,
      licenseNumber: number,
      tradeCategories: input.tradeCategories,
    })
    return {
      simulated: false,
      status: verified.status === "expired"
        ? "expired"
        : verified.status === "not_found"
        ? "not_found"
        : "active",
      licenseNumber: verified.licenseNumber ?? number,
      licenseType: verified.licenseType ?? extracted.licenseType,
      licenseState: state,
      boardLabel: verified.boardLabel,
      expirationDate: verified.expirationDate ?? extracted.expirationDate,
      detail: verified.detail,
    }
  }

  if (number) {
    return {
      simulated: false,
      status: "not_found",
      licenseNumber: number,
      licenseType: extracted.licenseType,
      licenseState: state,
      boardLabel: boardLabelForTrade(input.tradeCategories),
      expirationDate: extracted.expirationDate,
      detail:
        "We read a license number from the document. Add the two-letter state so we can confirm it with the licensing board.",
    }
  }

  return {
    simulated: false,
    status: "not_found",
    licenseNumber: null,
    licenseType: extracted.licenseType,
    licenseState: state,
    boardLabel: boardLabelForTrade(input.tradeCategories),
    expirationDate: extracted.expirationDate,
    detail: "We couldn't read a license number from that document. Try a clearer photo or PDF.",
  }
}

function coiResultFromFields(input: {
  carrier: string | null
  policyNumber: string | null
  generalLiability: number | null
  expirationDate: string | null
  additionalInsured: boolean
  sourceLabel: string
}): CoiParseResult {
  const today = new Date().toISOString().slice(0, 10)
  const meetsCoverage = (input.generalLiability ?? 0) >= MIN_GENERAL_LIABILITY &&
    input.additionalInsured &&
    (!input.expirationDate || input.expirationDate >= today)
  const glLabel = input.generalLiability != null
    ? `$${input.generalLiability.toLocaleString()} GL`
    : "coverage amount not listed"
  const carrier = input.carrier ?? "Carrier"
  return {
    simulated: false,
    status: meetsCoverage ? "verified" : "review",
    carrier: input.carrier,
    policyNumber: input.policyNumber,
    generalLiability: input.generalLiability,
    expirationDate: input.expirationDate,
    additionalInsured: input.additionalInsured,
    detail: meetsCoverage
      ? `${carrier} · ${glLabel} · Additional Insured · ${input.sourceLabel}`
      : `${carrier} · needs review — ${glLabel} · ${input.sourceLabel}`,
  }
}

/** Parse an uploaded COI (and optionally merge Certificial tracking). */
export async function parseCoi(input: CoiParseInput): Promise<CoiParseResult> {
  const bytes = input.bytes
  if (bytes && bytes.byteLength > 0) {
    try {
      const { extractCoiFieldsFromDocument } = await import("./documentExtract.ts")
      const extracted = await extractCoiFieldsFromDocument({
        fileName: input.fileName ?? "coi",
        contentType: input.contentType ?? "application/octet-stream",
        bytes,
      })
      return coiResultFromFields({
        ...extracted,
        sourceLabel: "read from certificate",
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      return {
        simulated: false,
        status: "review",
        carrier: null,
        policyNumber: null,
        generalLiability: null,
        expirationDate: null,
        additionalInsured: false,
        detail,
      }
    }
  }

  const tracked = await lookupCertificialCoverage({
    businessName: input.businessName ?? "",
  })
  if (!tracked.found) {
    return {
      simulated: false,
      status: "review",
      carrier: null,
      policyNumber: null,
      generalLiability: null,
      expirationDate: null,
      additionalInsured: false,
      detail: tracked.detail,
    }
  }
  return coiResultFromFields({
    carrier: tracked.carrier,
    policyNumber: tracked.policyNumber,
    generalLiability: tracked.generalLiability,
    expirationDate: tracked.expirationDate,
    additionalInsured: tracked.additionalInsured,
    sourceLabel: "Certificial",
  })
}

/** Simulated Checkr candidate creation — resolves clear immediately for demos. */
export function startBackgroundCheck(
  input: BackgroundStartInput,
): BackgroundStartResult {
  const seed = `${input.contactName ?? ""}|${input.email ?? ""}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 7)) % 100
  }
  const ref = `chk_${hash.toString(16)}${crypto.randomUUID().slice(0, 8)}`
  return {
    simulated: true,
    ref,
    status: "clear",
    detail: "Background check clear (simulated Checkr)",
  }
}

/**
 * Simulated Checkr status. Always clear for the demo so vendors can finish
 * verification without waiting on a random pending/consider outcome.
 */
export function getBackgroundStatus(ref: string): BackgroundStatusResult {
  return {
    simulated: true,
    status: "clear",
    ref,
    detail: "Background check clear (simulated Checkr)",
  }
}
