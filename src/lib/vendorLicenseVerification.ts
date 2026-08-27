import {
  attestExternalVendorLicense,
  lookupExternalVendorComplianceChecks,
  type ExternalLicenseCheckDto,
} from '@/api/verifyExternalVendorCompliance'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'

export type VendorLicenseLookupStatus =
  | 'checking'
  | 'auto_verified'
  | 'not_found'
  | 'expired'
  | 'manual_verified'

export type VendorLicenseLookupSubject = {
  name: string
  phone?: string | null
  website?: string | null
  priceLabel?: string | null
  sources?: string[] | null
}

export type VendorLicenseLookupResult = {
  status: Exclude<VendorLicenseLookupStatus, 'checking' | 'manual_verified'>
  licenseNumber: string | null
  detail: string
  boardLabel: string
  expirationDate?: string | null
  simulated: boolean
  checkSource: 'netvendor' | 'state_board' | 'certificial' | 'admin_attestation' | 'local'
}

export type VendorLicenseVerificationState = {
  status: VendorLicenseLookupStatus
  licenseNumber: string | null
  detail: string
  boardLabel: string
  approverName: string | null
  expirationDate?: string | null
  simulated: boolean
  checkSource: VendorLicenseLookupResult['checkSource']
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

function isProviderCredentialed(vendor: VendorLicenseLookupSubject): boolean {
  const sources = (vendor.sources ?? []).map((s) => s.trim().toLowerCase())
  if (!sources.includes('netvendor')) return false
  const label = (vendor.priceLabel ?? '').trim()
  if (!label) return true
  return /compliant|credential|coi\b|insurance\s*verif|preferred\s*vendor/i.test(label)
}

/** Local fallback when Edge is not configured (demo / offline). */
export function resolveVendorLicenseLookup(
  vendor: VendorLicenseLookupSubject,
  tradeLabel: string,
): VendorLicenseLookupResult {
  const trade = tradeLabelOrDefault(tradeLabel)
  if (isProviderCredentialed(vendor)) {
    return {
      status: 'auto_verified',
      licenseNumber: null,
      boardLabel: 'NetVendor credential network',
      detail: 'Active license on file · Verified via NetVendor',
      expirationDate: null,
      simulated: false,
      checkSource: 'netvendor',
    }
  }

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
      simulated: true,
      checkSource: 'local',
    }
  }

  if (bucket < 80) {
    return {
      status: 'not_found',
      licenseNumber: null,
      boardLabel,
      detail: 'No match in state licensing database',
      expirationDate: null,
      simulated: true,
      checkSource: 'local',
    }
  }

  return {
    status: 'expired',
    licenseNumber,
    boardLabel,
    detail: `${licenseNumber} · Expired · Confirm status with the state board`,
    expirationDate: '2023-11-30',
    simulated: true,
    checkSource: 'local',
  }
}

export function hasAutoVerifiedLicense(
  vendor: VendorLicenseLookupSubject,
  _tradeLabel: string | null | undefined,
): boolean {
  return isProviderCredentialed(vendor)
}

export function filterVendorsWithVerifiedLicense<T extends VendorLicenseLookupSubject>(
  vendors: T[],
  tradeLabel: string | null | undefined,
): T[] {
  return vendors.filter((vendor) => hasAutoVerifiedLicense(vendor, tradeLabel))
}

function fromDto(dto: ExternalLicenseCheckDto): VendorLicenseLookupResult {
  const status =
    dto.status === 'manual_verified'
      ? 'auto_verified'
      : dto.status
  return {
    status,
    licenseNumber: dto.licenseNumber,
    detail: dto.detail,
    boardLabel: dto.boardLabel,
    expirationDate: dto.expirationDate,
    simulated: dto.simulated,
    checkSource: dto.checkSource,
  }
}

/** State licensing / NetVendor lookup when a vendor is selected. */
export async function lookupVendorLicense(
  vendor: VendorLicenseLookupSubject,
  tradeLabel: string,
): Promise<VendorLicenseLookupResult> {
  if (getAdminEdgeSecret()) {
    try {
      const { license } = await lookupExternalVendorComplianceChecks({
        name: vendor.name,
        phone: vendor.phone,
        website: vendor.website,
        priceLabel: vendor.priceLabel,
        sources: vendor.sources,
        tradeLabel,
      })
      return fromDto(license)
    } catch (err) {
      console.warn('[lookupVendorLicense] edge fallback', err)
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400))
  return {
    status: 'not_found',
    licenseNumber: null,
    boardLabel: boardLabelForTrade(tradeLabelOrDefault(tradeLabel)),
    detail: "We couldn't reach the licensing board. Try again in a moment.",
    expirationDate: null,
    simulated: false,
    checkSource: 'state_board',
  }
}

export function initialLicenseVerificationState(): VendorLicenseVerificationState {
  return {
    status: 'checking',
    licenseNumber: null,
    detail: 'Checking license status…',
    boardLabel: 'State licensing board',
    approverName: null,
    simulated: false,
    checkSource: 'state_board',
  }
}

export function licenseStateFromLookup(
  result: VendorLicenseLookupResult,
): VendorLicenseVerificationState {
  return {
    status: result.status,
    licenseNumber: result.licenseNumber,
    detail: result.detail,
    boardLabel: result.boardLabel,
    approverName: null,
    expirationDate: result.expirationDate,
    simulated: result.simulated,
    checkSource: result.checkSource,
  }
}

export function expectedLicenseNumberForVendor(vendor: VendorLicenseLookupSubject): string {
  return mockLicenseNumber(vendor.name)
}

/** Admin attestation — any plausible license number (Edge when configured). */
export async function verifyManualLicenseNumber(
  vendor: VendorLicenseLookupSubject,
  licenseNumber: string,
  options?: { tradeLabel?: string | null; approverName?: string | null },
): Promise<{ ok: true; state: VendorLicenseVerificationState } | { ok: false; message: string }> {
  const entered = licenseNumber.trim()
  if (entered.length < 4) {
    return { ok: false, message: 'Enter a license number with at least 4 characters.' }
  }

  if (getAdminEdgeSecret()) {
    try {
      const license = await attestExternalVendorLicense({
        subject: {
          name: vendor.name,
          phone: vendor.phone,
          website: vendor.website,
          priceLabel: vendor.priceLabel,
          sources: vendor.sources,
          tradeLabel: options?.tradeLabel,
        },
        licenseNumber: entered,
        approverName: options?.approverName,
      })
      return {
        ok: true,
        state: {
          status: 'manual_verified',
          licenseNumber: license.licenseNumber,
          detail: license.detail,
          boardLabel: license.boardLabel,
          approverName: options?.approverName?.trim() || 'Admin',
          expirationDate: license.expirationDate,
          simulated: license.simulated,
          checkSource: license.checkSource,
        },
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : 'Could not verify that license number.'
      return { ok: false, message }
    }
  }

  const approver = options?.approverName?.trim() || 'Admin'
  return {
    ok: true,
    state: {
      status: 'manual_verified',
      licenseNumber: entered,
      detail: `${entered} · Verified by ${approver}`,
      boardLabel: boardLabelForTrade(tradeLabelOrDefault(options?.tradeLabel)),
      approverName: approver,
      expirationDate: null,
      simulated: false,
      checkSource: 'admin_attestation',
    },
  }
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
    simulated: false,
    checkSource: 'admin_attestation',
  }
}

export function isLicenseVerificationComplete(state: VendorLicenseVerificationState): boolean {
  return state.status === 'auto_verified' || state.status === 'manual_verified'
}

export function licenseRequiresManualVerify(state: VendorLicenseVerificationState): boolean {
  return state.status === 'not_found' || state.status === 'expired'
}
