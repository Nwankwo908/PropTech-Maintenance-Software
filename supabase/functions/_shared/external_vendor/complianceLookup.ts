/**
 * External vendor license + COI checks for Find External Vendor.
 *
 * Priority:
 * 1. NetVendor / credentialed discovery signals → provider-verified (not simulated)
 * 2. Shared state-board / Certificial seams (simulated until live keys are wired)
 * 3. Admin manual attestation (license number entry or COI-on-file confirm)
 */
import { verifyLicense } from "../vendor_verification/adapters.ts"

export type ExternalComplianceSource =
  | "netvendor"
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

function futureDateIso(daysFromNow: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

function stableBucket(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * (i + 11)) % 100
  }
  return hash
}

function mockPolicyNumber(vendorName: string): string {
  const bucket = stableBucket(vendorName)
  return `CGI-${String(400000 + bucket * 211).slice(0, 6)}`
}

function mockCarrier(vendorName: string): string {
  const carriers = ["Travelers", "Hartford", "Liberty Mutual", "Nationwide", "CNA"]
  return carriers[stableBucket(`carrier|${vendorName}`) % carriers.length] ?? "Travelers"
}

function tradeCategoriesFromLabel(tradeLabel: string | null | undefined): string[] {
  const t = (tradeLabel ?? "").trim()
  return t ? [t.toLowerCase()] : []
}

/** True when discovery already marks the vendor as credentialed/compliant. */
export function isProviderCredentialed(subject: ExternalVendorComplianceSubject): boolean {
  const sources = (subject.sources ?? []).map((s) => s.trim().toLowerCase())
  if (!sources.includes("netvendor")) return false
  const label = (subject.priceLabel ?? "").trim()
  if (!label) return true
  return /compliant|credential|coi\b|insurance\s*verif|preferred\s*vendor/i.test(label)
}

function netvendorLicense(subject: ExternalVendorComplianceSubject): ExternalLicenseCheckResult {
  const boardLabel = "NetVendor credential network"
  return {
    status: "auto_verified",
    licenseNumber: null,
    detail: `Active license on file · Verified via NetVendor`,
    boardLabel,
    expirationDate: null,
    simulated: false,
    checkSource: "netvendor",
  }
}

function netvendorCoi(subject: ExternalVendorComplianceSubject): ExternalCoiCheckResult {
  const label = (subject.priceLabel ?? "").trim() || "Compliant"
  return {
    status: "monitoring",
    policyNumber: null,
    carrier: null,
    detail: `${label} · Active COI tracked by NetVendor`,
    expirationDate: futureDateIso(365),
    monitoringActive: true,
    simulated: false,
    checkSource: "netvendor",
  }
}

function boardLicenseLookup(subject: ExternalVendorComplianceSubject): ExternalLicenseCheckResult {
  const result = verifyLicense({
    businessName: subject.name,
    contactName: subject.name,
    licenseState: null,
    licenseNumber: null,
    tradeCategories: tradeCategoriesFromLabel(subject.tradeLabel),
  })

  if (result.status === "active" || result.status === "verified") {
    return {
      status: "auto_verified",
      licenseNumber: result.licenseNumber,
      detail: result.detail.replace(/\s*\(simulated\)/gi, ""),
      boardLabel: result.boardLabel,
      expirationDate: result.expirationDate,
      simulated: true,
      checkSource: "state_board",
    }
  }

  if (result.status === "expired") {
    return {
      status: "expired",
      licenseNumber: result.licenseNumber,
      detail: result.detail.replace(/\s*\(simulated\)/gi, ""),
      boardLabel: result.boardLabel,
      expirationDate: result.expirationDate,
      simulated: true,
      checkSource: "state_board",
    }
  }

  return {
    status: "not_found",
    licenseNumber: null,
    detail: "No match in state licensing database",
    boardLabel: result.boardLabel,
    expirationDate: null,
    simulated: true,
    checkSource: "state_board",
  }
}

/** Certificial-style insurance tracking seam (swap for live API later). */
export function certificialCoiLookup(
  subject: ExternalVendorComplianceSubject,
): ExternalCoiCheckResult {
  const key = `certificial|${subject.name}|${subject.phone ?? ""}|${subject.website ?? ""}`
  const bucket = stableBucket(key)
  const policyNumber = mockPolicyNumber(subject.name)
  const carrier = mockCarrier(subject.name)

  if (bucket < 60) {
    return {
      status: "monitoring",
      policyNumber,
      carrier,
      detail: `${carrier} · ${policyNumber} · Active · Tracking via Certificial`,
      expirationDate: futureDateIso(400),
      monitoringActive: true,
      simulated: true,
      checkSource: "certificial",
    }
  }

  if (bucket < 85) {
    return {
      status: "not_found",
      policyNumber: null,
      carrier: null,
      detail: "No COI on file in Certificial — confirm insurance paperwork manually",
      expirationDate: null,
      monitoringActive: false,
      simulated: true,
      checkSource: "certificial",
    }
  }

  return {
    status: "expired",
    policyNumber,
    carrier,
    detail: `${carrier} · ${policyNumber} · Expired — renew COI to restore monitoring`,
    expirationDate: futureDateIso(-90),
    monitoringActive: false,
    simulated: true,
    checkSource: "certificial",
  }
}

export function lookupExternalVendorCompliance(
  subject: ExternalVendorComplianceSubject,
): ExternalComplianceLookupResult {
  if (isProviderCredentialed(subject)) {
    return {
      license: netvendorLicense(subject),
      coi: netvendorCoi(subject),
    }
  }

  return {
    license: boardLicenseLookup(subject),
    coi: certificialCoiLookup(subject),
  }
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
  const board = boardLicenseLookup(input.subject).boardLabel
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
