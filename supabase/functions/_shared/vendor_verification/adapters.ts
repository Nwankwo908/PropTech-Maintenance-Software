/**
 * Simulated-but-swappable vendor verification adapters.
 *
 * Each exported function is the SINGLE seam to later swap for a real provider
 * (StateLicense.io, an insurance OCR / Certificial, Checkr). Results are
 * deterministic so the demo is stable, and every payload is clearly branded
 * as `simulated: true` so nothing is mistaken for a live check.
 */

export type LicenseVerifyInput = {
  businessName?: string | null
  contactName?: string | null
  licenseState?: string | null
  licenseNumber?: string | null
  tradeCategories?: string[] | null
}

export type LicenseVerifyResult = {
  simulated: true
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
  businessName?: string | null
}

export type CoiParseResult = {
  simulated: true
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

function stableBucket(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * (i + 7)) % 100
  }
  return hash
}

function mockLicenseNumber(seed: string): string {
  const bucket = stableBucket(seed)
  return `055-${String(100000 + bucket * 137).slice(0, 6)}`
}

function boardLabelForTrade(trades: string[] | null | undefined): string {
  const trade = (trades ?? []).join(" ").toLowerCase()
  if (trade.includes("plumb")) return "State Plumbing Contractor Board"
  if (trade.includes("hvac")) return "State HVAC Contractor Board"
  if (trade.includes("elect")) return "State Electrical Contractor Board"
  if (trade.includes("roof")) return "State Roofing Contractor Board"
  if (trade.includes("pest")) return "State Pest Control Board"
  return "State Professional Licensing Board"
}

function futureDateIso(daysFromNow: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

/**
 * Simulated state-licensing lookup (StateLicense.io seam).
 * A manually entered license number is treated as verified; otherwise a
 * deterministic bucket decides active / not-found / expired.
 */
export function verifyLicense(input: LicenseVerifyInput): LicenseVerifyResult {
  const boardLabel = boardLabelForTrade(input.tradeCategories)
  const seed = `${input.businessName ?? ""}|${input.contactName ?? ""}|${
    input.licenseState ?? ""
  }`
  const manual = (input.licenseNumber ?? "").trim()

  if (manual) {
    return {
      simulated: true,
      status: "verified",
      licenseNumber: manual,
      licenseType: "Contractor",
      boardLabel,
      detail: `${manual} · Active (simulated) · ${boardLabel}`,
      expirationDate: futureDateIso(365),
    }
  }

  const bucket = stableBucket(seed)
  const licenseNumber = mockLicenseNumber(seed)

  if (bucket < 60) {
    return {
      simulated: true,
      status: "active",
      licenseNumber,
      licenseType: "Contractor",
      boardLabel,
      detail: `${licenseNumber} · Active (simulated) · ${boardLabel}`,
      expirationDate: futureDateIso(300),
    }
  }

  if (bucket < 85) {
    return {
      simulated: true,
      status: "not_found",
      licenseNumber: null,
      licenseType: null,
      boardLabel,
      detail: "No match in state licensing database (simulated)",
      expirationDate: null,
    }
  }

  return {
    simulated: true,
    status: "expired",
    licenseNumber,
    licenseType: "Contractor",
    boardLabel,
    detail: `${licenseNumber} · Expired (simulated) · confirm renewal`,
    expirationDate: futureDateIso(-120),
  }
}

export type LicenseScanInput = {
  fileName?: string | null
  contentType?: string | null
  businessName?: string | null
  contactName?: string | null
  licenseState?: string | null
  tradeCategories?: string[] | null
}

export type LicenseScanResult = {
  simulated: true
  status: "active" | "expired"
  licenseNumber: string
  licenseType: string
  licenseState: string | null
  boardLabel: string
  expirationDate: string
  detail: string
}

/**
 * Simulated license document scanner (OCR seam).
 * Unlike `verifyLicense` (a database lookup that can come back empty), a scan of
 * an uploaded license image/PDF always yields a readable number — so this seam
 * deterministically "reads" a license number off the document and returns it for
 * auto-filling the form. Swap this for a real OCR/IDP provider later.
 */
export function scanLicenseDocument(input: LicenseScanInput): LicenseScanResult {
  const boardLabel = boardLabelForTrade(input.tradeCategories)
  const seed = `${input.businessName ?? ""}|${input.contactName ?? ""}|${
    input.fileName ?? "license"
  }|${input.licenseState ?? ""}`
  const licenseNumber = mockLicenseNumber(seed)
  const bucket = stableBucket(seed)
  const expired = bucket >= 92

  return {
    simulated: true,
    status: expired ? "expired" : "active",
    licenseNumber,
    licenseType: "Contractor",
    licenseState: input.licenseState?.trim() || null,
    boardLabel,
    expirationDate: expired ? futureDateIso(-90) : futureDateIso(330),
    detail: expired
      ? `${licenseNumber} · read from uploaded license (simulated scan) · shows expired, confirm renewal`
      : `${licenseNumber} · read from uploaded license (simulated scan) · ${boardLabel}`,
  }
}

/**
 * Simulated COI OCR (insurance tracking seam).
 * Extracts coverage / expiration / additional-insured from an uploaded doc.
 */
export function parseCoi(input: CoiParseInput): CoiParseResult {
  const seed = `${input.businessName ?? ""}|${input.fileName ?? "coi"}`
  const bucket = stableBucket(seed)
  const carriers = [
    "Hartford",
    "Travelers",
    "Nationwide",
    "Liberty Mutual",
    "State Farm",
    "Chubb",
  ]
  const carrier = carriers[bucket % carriers.length]
  const generalLiability = bucket < 78 ? 1_000_000 : 500_000
  const additionalInsured = bucket % 3 !== 0
  const policyNumber = `GL-${String(200000 + bucket * 91).slice(0, 6)}`
  const expirationDate = bucket < 88 ? futureDateIso(240) : futureDateIso(-30)
  const meetsCoverage = generalLiability >= 1_000_000 &&
    expirationDate >= new Date().toISOString().slice(0, 10)

  return {
    simulated: true,
    status: meetsCoverage ? "verified" : "review",
    carrier,
    policyNumber,
    generalLiability,
    expirationDate,
    additionalInsured,
    detail: meetsCoverage
      ? `${carrier} · $${generalLiability.toLocaleString()} GL (simulated OCR)`
      : `${carrier} · needs review — coverage or expiration below requirement (simulated OCR)`,
  }
}

/** Simulated Checkr candidate creation — resolves clear immediately for demos. */
export function startBackgroundCheck(
  input: BackgroundStartInput,
): BackgroundStartResult {
  const seed = `${input.contactName ?? ""}|${input.email ?? ""}`
  const ref = `chk_${stableBucket(seed).toString(16)}${
    crypto.randomUUID().slice(0, 8)
  }`
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
