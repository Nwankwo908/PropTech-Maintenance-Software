export type VendorLicenseLookupStatus = 'checking' | 'auto_verified' | 'not_found' | 'expired' | 'manual_verified'

export type VendorLicenseLookupSubject = {
  name: string
  phone?: string | null
}

export type VendorLicenseLookupResult = {
  status: Exclude<VendorLicenseLookupStatus, 'checking' | 'manual_verified'>
  licenseNumber: string | null
  detail: string
  boardLabel: string
  expirationDate?: string | null
}

export type VendorLicenseVerificationState = {
  status: VendorLicenseLookupStatus
  licenseNumber: string | null
  detail: string
  boardLabel: string
  approverName: string | null
  expirationDate?: string | null
}

function stableBucket(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * (i + 7)) % 100
  }
  return hash
}

function mockLicenseNumber(vendorName: string): string {
  const bucket = stableBucket(vendorName)
  return `055-${String(100000 + bucket * 137).slice(0, 6)}`
}

function boardLabelForTrade(tradeLabel: string): string {
  const trade = tradeLabel.toLowerCase()
  if (trade.includes('plumb')) return 'Illinois Plumbing Contractor (IDFPR)'
  if (trade.includes('hvac')) return 'Illinois HVAC Contractor (IDFPR)'
  if (trade.includes('elect')) return 'Illinois Electrical Contractor (IDFPR)'
  if (trade.includes('appliance')) return 'Illinois Appliance Repair (IDFPR)'
  if (trade.includes('roof')) return 'Illinois Roofing Contractor (IDFPR)'
  if (trade.includes('pest')) return 'Illinois Pest Control (IDFPR)'
  return 'Illinois Professional License (IDFPR)'
}

function tradeLabelOrDefault(tradeLabel: string | null | undefined): string {
  return tradeLabel?.trim() || 'Maintenance'
}

/** Synchronous state-board license resolution (same rules as the async lookup). */
export function resolveVendorLicenseLookup(
  vendor: VendorLicenseLookupSubject,
  tradeLabel: string,
): VendorLicenseLookupResult {
  const trade = tradeLabelOrDefault(tradeLabel)
  const bucket = stableBucket(`${vendor.name}|${vendor.phone ?? ''}|${trade}`)
  const boardLabel = boardLabelForTrade(trade)
  const licenseNumber = mockLicenseNumber(vendor.name)

  if (bucket < 55) {
    return {
      status: 'auto_verified',
      licenseNumber,
      boardLabel,
      detail: `${licenseNumber} · Active · ${boardLabel}`,
      expirationDate: null,
    }
  }

  if (bucket < 80) {
    return {
      status: 'not_found',
      licenseNumber: null,
      boardLabel,
      detail: 'No match in state licensing database',
      expirationDate: null,
    }
  }

  return {
    status: 'expired',
    licenseNumber,
    boardLabel,
    detail: `${licenseNumber} · Expired · Confirm status in IDFPR`,
    expirationDate: '2023-11-30',
  }
}

/** True when the state API already returns an active verified license. */
export function hasAutoVerifiedLicense(
  vendor: VendorLicenseLookupSubject,
  tradeLabel: string | null | undefined,
): boolean {
  return resolveVendorLicenseLookup(vendor, tradeLabelOrDefault(tradeLabel)).status === 'auto_verified'
}

/** Keep only vendors whose license already comes back verified (drop not-found / expired). */
export function filterVendorsWithVerifiedLicense<T extends VendorLicenseLookupSubject>(
  vendors: T[],
  tradeLabel: string | null | undefined,
): T[] {
  return vendors.filter((vendor) => hasAutoVerifiedLicense(vendor, tradeLabel))
}

/** Simulates state licensing board API lookup when a vendor is selected. */
export async function lookupVendorLicense(
  vendor: VendorLicenseLookupSubject,
  tradeLabel: string,
): Promise<VendorLicenseLookupResult> {
  await new Promise((resolve) => setTimeout(resolve, 900))
  return resolveVendorLicenseLookup(vendor, tradeLabel)
}

export function initialLicenseVerificationState(): VendorLicenseVerificationState {
  return {
    status: 'checking',
    licenseNumber: null,
    detail: 'Querying state licensing API (simulated)…',
    boardLabel: 'State licensing board',
    approverName: null,
  }
}

export function licenseStateFromLookup(result: VendorLicenseLookupResult): VendorLicenseVerificationState {
  return {
    status: result.status,
    licenseNumber: result.licenseNumber,
    detail: result.detail,
    boardLabel: result.boardLabel,
    approverName: null,
    expirationDate: result.expirationDate,
  }
}

function normalizeLicenseNumber(value: string): string {
  return value.trim().replace(/[\s-]/g, '').toLowerCase()
}

/** Expected license on file for this vendor (state licensing records). */
export function expectedLicenseNumberForVendor(vendor: VendorLicenseLookupSubject): string {
  return mockLicenseNumber(vendor.name)
}

/** Validates a manually entered license number against state licensing records. */
export async function verifyManualLicenseNumber(
  vendor: VendorLicenseLookupSubject,
  licenseNumber: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await new Promise((resolve) => setTimeout(resolve, 400))

  const entered = normalizeLicenseNumber(licenseNumber)
  if (!entered) {
    return { ok: false, message: 'That number does not match our records' }
  }

  const expected = normalizeLicenseNumber(expectedLicenseNumberForVendor(vendor))
  if (entered !== expected) {
    return { ok: false, message: 'That number does not match our records' }
  }

  return { ok: true }
}

export function manualLicenseVerification(
  current: VendorLicenseVerificationState,
  licenseNumber: string,
  approverName: string,
): VendorLicenseVerificationState {
  const normalized = licenseNumber.trim()
  const number = normalized || current.licenseNumber || 'Pending confirmation'
  return {
    ...current,
    status: 'manual_verified',
    licenseNumber: number,
    approverName: approverName.trim() || 'Admin',
    detail: `${number} · Verified by ${approverName.trim() || 'Admin'}`,
  }
}

export function isLicenseVerificationComplete(state: VendorLicenseVerificationState): boolean {
  return state.status === 'auto_verified' || state.status === 'manual_verified'
}

export function licenseRequiresManualVerify(state: VendorLicenseVerificationState): boolean {
  return state.status === 'not_found' || state.status === 'expired'
}
