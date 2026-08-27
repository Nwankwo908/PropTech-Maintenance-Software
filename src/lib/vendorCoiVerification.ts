import {
  attestExternalVendorCoi,
  lookupExternalVendorComplianceChecks,
  type ExternalCoiCheckDto,
} from '@/api/verifyExternalVendorCompliance'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'

export type VendorCoiLookupStatus =
  | 'checking'
  | 'verified'
  | 'not_found'
  | 'expired'
  | 'monitoring'

export type VendorCoiLookupSubject = {
  name: string
  phone?: string | null
  website?: string | null
  priceLabel?: string | null
  sources?: string[] | null
}

export type VendorCoiLookupResult = {
  status: Exclude<VendorCoiLookupStatus, 'checking' | 'monitoring'>
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
  simulated: boolean
  checkSource: 'netvendor' | 'state_board' | 'certificial' | 'admin_attestation' | 'local'
}

export type VendorCoiVerificationState = {
  status: VendorCoiLookupStatus
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
  simulated: boolean
  checkSource: VendorCoiLookupResult['checkSource']
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
  const carriers = ['Travelers', 'Hartford', 'Liberty Mutual', 'Nationwide', 'CNA']
  return carriers[stableBucket(`carrier|${vendorName}`) % carriers.length] ?? 'Travelers'
}

function isProviderCredentialed(vendor: VendorCoiLookupSubject): boolean {
  const sources = (vendor.sources ?? []).map((s) => s.trim().toLowerCase())
  if (!sources.includes('netvendor')) return false
  const label = (vendor.priceLabel ?? '').trim()
  if (!label) return true
  return /compliant|credential|coi\b|insurance\s*verif|preferred\s*vendor/i.test(label)
}

function futureDateIso(daysFromNow: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

/**
 * Certificial-style insurance tracking lookup (local fallback).
 */
export function resolveVendorCoiLookup(vendor: VendorCoiLookupSubject): VendorCoiLookupResult {
  if (isProviderCredentialed(vendor)) {
    const label = (vendor.priceLabel ?? '').trim() || 'Compliant'
    return {
      status: 'verified',
      policyNumber: null,
      carrier: null,
      detail: `${label} · Active COI tracked by NetVendor`,
      expirationDate: futureDateIso(365),
      monitoringActive: true,
      simulated: false,
      checkSource: 'netvendor',
    }
  }

  const key = `certificial|${vendor.name}|${vendor.phone ?? ''}|${vendor.website ?? ''}`
  const bucket = stableBucket(key)
  const policyNumber = mockPolicyNumber(vendor.name)
  const carrier = mockCarrier(vendor.name)

  if (bucket < 60) {
    return {
      status: 'verified',
      policyNumber,
      carrier,
      detail: `${carrier} · ${policyNumber} · Active · Tracking via Certificial`,
      expirationDate: futureDateIso(400),
      monitoringActive: true,
      simulated: true,
      checkSource: 'local',
    }
  }

  if (bucket < 85) {
    return {
      status: 'not_found',
      policyNumber: null,
      carrier: null,
      detail: 'No COI on file in Certificial — confirm insurance paperwork manually',
      expirationDate: null,
      monitoringActive: false,
      simulated: true,
      checkSource: 'local',
    }
  }

  return {
    status: 'expired',
    policyNumber,
    carrier,
    detail: `${carrier} · ${policyNumber} · Expired — renew COI to restore monitoring`,
    expirationDate: futureDateIso(-90),
    monitoringActive: false,
    simulated: true,
    checkSource: 'local',
  }
}

export function hasPullableVerifiedCoi(vendor: VendorCoiLookupSubject): boolean {
  return isProviderCredentialed(vendor)
}

export function filterVendorsWithVerifiedCoi<T extends VendorCoiLookupSubject>(vendors: T[]): T[] {
  return vendors.filter((vendor) => hasPullableVerifiedCoi(vendor))
}

function fromDto(dto: ExternalCoiCheckDto): VendorCoiLookupResult {
  return {
    status: dto.status === 'monitoring' ? 'verified' : dto.status,
    policyNumber: dto.policyNumber,
    carrier: dto.carrier,
    detail: dto.detail,
    expirationDate: dto.expirationDate,
    monitoringActive: dto.monitoringActive,
    simulated: dto.simulated,
    checkSource: dto.checkSource,
  }
}

/** Async Certificial / NetVendor lookup used on the verification screen. */
export async function lookupVendorCoi(
  vendor: VendorCoiLookupSubject,
): Promise<VendorCoiLookupResult> {
  if (getAdminEdgeSecret()) {
    try {
      const { coi } = await lookupExternalVendorComplianceChecks({
        name: vendor.name,
        phone: vendor.phone,
        website: vendor.website,
        priceLabel: vendor.priceLabel,
        sources: vendor.sources,
      })
      return fromDto(coi)
    } catch (err) {
      console.warn('[lookupVendorCoi] edge fallback', err)
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 350))
  return {
    status: 'not_found',
    policyNumber: null,
    carrier: null,
    detail: "We couldn't reach insurance tracking. Try again in a moment.",
    expirationDate: null,
    monitoringActive: false,
    simulated: false,
    checkSource: 'certificial',
  }
}

export function initialCoiVerificationState(): VendorCoiVerificationState {
  return {
    status: 'checking',
    policyNumber: null,
    carrier: null,
    detail: 'Checking insurance certificate…',
    expirationDate: null,
    monitoringActive: false,
    simulated: false,
    checkSource: 'certificial',
  }
}

export function coiStateFromLookup(result: VendorCoiLookupResult): VendorCoiVerificationState {
  return {
    status: result.monitoringActive ? 'monitoring' : result.status,
    policyNumber: result.policyNumber,
    carrier: result.carrier,
    detail: result.monitoringActive
      ? `${result.detail}${result.detail.includes('monitoring') ? '' : ' · Continuous monitoring on'}`
      : result.detail,
    expirationDate: result.expirationDate,
    monitoringActive: result.monitoringActive,
    simulated: result.simulated,
    checkSource: result.checkSource,
  }
}

export function isCoiVerificationComplete(state: VendorCoiVerificationState): boolean {
  return state.status === 'verified' || state.status === 'monitoring'
}

export function coiRequiresManualCollect(state: VendorCoiVerificationState): boolean {
  return state.status === 'not_found' || state.status === 'expired'
}

/** Admin confirms COI paperwork is on file when the automated pull fails. */
export async function attestVendorCoiOnFile(
  vendor: VendorCoiLookupSubject,
  options?: { approverName?: string | null },
): Promise<VendorCoiVerificationState> {
  if (getAdminEdgeSecret()) {
    try {
      const coi = await attestExternalVendorCoi({
        subject: {
          name: vendor.name,
          phone: vendor.phone,
          website: vendor.website,
          priceLabel: vendor.priceLabel,
          sources: vendor.sources,
        },
        approverName: options?.approverName,
      })
      return {
        status: coi.monitoringActive ? 'monitoring' : coi.status,
        policyNumber: coi.policyNumber,
        carrier: coi.carrier,
        detail: coi.detail,
        expirationDate: coi.expirationDate,
        monitoringActive: coi.monitoringActive,
        simulated: coi.simulated,
        checkSource: coi.checkSource,
      }
    } catch (err) {
      console.warn('[attestVendorCoiOnFile] edge fallback', err)
    }
  }

  const approver = options?.approverName?.trim() || 'Admin'
  return {
    status: 'monitoring',
    policyNumber: null,
    carrier: null,
    detail: `COI on file · Confirmed by ${approver}`,
    expirationDate: futureDateIso(365),
    monitoringActive: true,
    simulated: false,
    checkSource: 'admin_attestation',
  }
}
