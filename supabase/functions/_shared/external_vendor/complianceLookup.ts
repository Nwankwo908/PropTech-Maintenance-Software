/**
 * External vendor license + COI checks for Find External Vendor.
 *
 * Priority:
 * 1. Thumbtack licensed / background-checked discovery signals → provider-verified
 * 2. StateLicense.io board lookup + Certificial tracking API
 * 3. Admin manual attestation (license number entry or COI-on-file confirm)
 */
import { lookupCertificialCoverage } from "../vendor_verification/certificialApi.ts"
import { verifyLicense } from "../vendor_verification/adapters.ts"

export type ExternalComplianceSource =
  | "thumbtack"
  | "state_board"
  | "certificial"
  | "admin_attestation"

export type ExternalVendorComplianceSubject = {
  name: string
  phone?: string | null
  website?: string | null
  tradeLabel?: string | null
  priceLabel?: string | null
  sources?: string[] | null
  licenseState?: string | null
}

export type ExternalLicenseCheckResult = {
  status: "auto_verified" | "not_found" | "expired" | "manual_verified"
  licenseNumber: string | null
  detail: string
  boardLabel: string
  expirationDate: string | null
  simulated: boolean
  checkSource: ExternalComplianceSource
}

export type ExternalCoiCheckResult = {
  status: "verified" | "not_found" | "expired" | "monitoring"
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
  simulated: boolean
  checkSource: ExternalComplianceSource
}

export type ExternalComplianceLookupResult = {
  license: ExternalLicenseCheckResult
  coi: ExternalCoiCheckResult
}

export type ExternalComplianceLookupDeps = {
  lookupLicense?: (
    subject: ExternalVendorComplianceSubject,
  ) => Promise<ExternalLicenseCheckResult>
  lookupCoi?: (
    subject: ExternalVendorComplianceSubject,
  ) => Promise<ExternalCoiCheckResult>
}

function futureDateIso(daysFromNow: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

function tradeCategoriesFromLabel(tradeLabel: string | null | undefined): string[] {
  const t = (tradeLabel ?? "").trim()
  return t ? [t.toLowerCase()] : []
}

/** True when Thumbtack already marks the vendor as licensed. */
export function isProviderCredentialed(subject: ExternalVendorComplianceSubject): boolean {
  const sources = (subject.sources ?? []).map((s) => s.trim().toLowerCase())
  if (!sources.includes("thumbtack")) return false
  const label = (subject.priceLabel ?? "").trim()
  return /licensed/i.test(label)
}

function thumbtackLicense(_subject: ExternalVendorComplianceSubject): ExternalLicenseCheckResult {
  return {
    status: "auto_verified",
    licenseNumber: null,
    detail: "Active license on file · Verified via Thumbtack",
    boardLabel: "Thumbtack license verification",
    expirationDate: null,
    simulated: false,
    checkSource: "thumbtack",
  }
}

function thumbtackCoi(subject: ExternalVendorComplianceSubject): ExternalCoiCheckResult {
  const label = (subject.priceLabel ?? "").trim() || "Licensed"
  return {
    status: "monitoring",
    policyNumber: null,
    carrier: null,
    detail: `${label} · Background and license checks from Thumbtack`,
    expirationDate: futureDateIso(365),
    monitoringActive: true,
    simulated: false,
    checkSource: "thumbtack",
  }
}

async function boardLicenseLookup(
  subject: ExternalVendorComplianceSubject,
): Promise<ExternalLicenseCheckResult> {
  const result = await verifyLicense({
    businessName: subject.name,
    contactName: subject.name,
    licenseState: subject.licenseState ?? null,
    licenseNumber: null,
    tradeCategories: tradeCategoriesFromLabel(subject.tradeLabel),
  })

  if (result.status === "active" || result.status === "verified") {
    return {
      status: "auto_verified",
      licenseNumber: result.licenseNumber,
      detail: result.detail,
      boardLabel: result.boardLabel,
      expirationDate: result.expirationDate,
      simulated: false,
      checkSource: "state_board",
    }
  }

  if (result.status === "expired") {
    return {
      status: "expired",
      licenseNumber: result.licenseNumber,
      detail: result.detail,
      boardLabel: result.boardLabel,
      expirationDate: result.expirationDate,
      simulated: false,
      checkSource: "state_board",
    }
  }

  return {
    status: "not_found",
    licenseNumber: null,
    detail: result.detail || "No match in the state licensing database.",
    boardLabel: result.boardLabel,
    expirationDate: null,
    simulated: false,
    checkSource: "state_board",
  }
}

export async function certificialCoiLookup(
  subject: ExternalVendorComplianceSubject,
): Promise<ExternalCoiCheckResult> {
  const tracked = await lookupCertificialCoverage({
    businessName: subject.name,
    phone: subject.phone,
  })
  if (!tracked.found) {
    return {
      status: "not_found",
      policyNumber: null,
      carrier: null,
      detail: tracked.detail,
      expirationDate: null,
      monitoringActive: false,
      simulated: false,
      checkSource: "certificial",
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const expired = Boolean(tracked.expirationDate && tracked.expirationDate < today)
  if (expired) {
    return {
      status: "expired",
      policyNumber: tracked.policyNumber,
      carrier: tracked.carrier,
      detail: tracked.detail,
      expirationDate: tracked.expirationDate,
      monitoringActive: false,
      simulated: false,
      checkSource: "certificial",
    }
  }

  return {
    status: "monitoring",
    policyNumber: tracked.policyNumber,
    carrier: tracked.carrier,
    detail: tracked.detail,
    expirationDate: tracked.expirationDate,
    monitoringActive: true,
    simulated: false,
    checkSource: "certificial",
  }
}

export async function lookupExternalVendorCompliance(
  subject: ExternalVendorComplianceSubject,
  deps?: ExternalComplianceLookupDeps,
): Promise<ExternalComplianceLookupResult> {
  if (isProviderCredentialed(subject)) {
    return {
      license: thumbtackLicense(subject),
      coi: thumbtackCoi(subject),
    }
  }

  const [license, coi] = await Promise.all([
    (deps?.lookupLicense ?? boardLicenseLookup)(subject),
    (deps?.lookupCoi ?? certificialCoiLookup)(subject),
  ])
  return { license, coi }
}

export function attestExternalLicenseNumber(input: {
  subject: ExternalVendorComplianceSubject
  licenseNumber: string
  approverName?: string | null
}): ExternalLicenseCheckResult | { error: string } {
  const number = input.licenseNumber.trim()
  if (number.length < 4) {
    return { error: "Enter a license number with at least 4 characters." }
  }
  const approver = input.approverName?.trim() || "Admin"
  const trade = (input.subject.tradeLabel ?? "").toLowerCase()
  const board = trade.includes("plumb")
    ? "State Plumbing Contractor Board"
    : "State Professional Licensing Board"
  return {
    status: "manual_verified",
    licenseNumber: number,
    detail: `${number} · Verified by ${approver}`,
    boardLabel: board,
    expirationDate: futureDateIso(365),
    simulated: false,
    checkSource: "admin_attestation",
  }
}

export function attestExternalCoiOnFile(input: {
  subject: ExternalVendorComplianceSubject
  approverName?: string | null
}): ExternalCoiCheckResult {
  const approver = input.approverName?.trim() || "Admin"
  return {
    status: "monitoring",
    policyNumber: null,
    carrier: null,
    detail: `COI on file · Confirmed by ${approver}`,
    expirationDate: futureDateIso(365),
    monitoringActive: true,
    simulated: false,
    checkSource: "admin_attestation",
  }
}
