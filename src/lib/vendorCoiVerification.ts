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
}

export type VendorCoiLookupResult = {
  status: Exclude<VendorCoiLookupStatus, 'checking' | 'monitoring'>
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
}

export type VendorCoiVerificationState = {
  status: VendorCoiLookupStatus
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
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

/**
 * Certificial-style insurance tracking lookup.
 * Resolves whether COI paperwork can be pulled, checked, and put on continuous monitoring.
 */
export function resolveVendorCoiLookup(vendor: VendorCoiLookupSubject): VendorCoiLookupResult {
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
      expirationDate: '2027-06-30',
      monitoringActive: true,
    }
  }

  if (bucket < 85) {
    return {
      status: 'not_found',
      policyNumber: null,
      carrier: null,
      detail: 'No COI on file in Certificial — insurance paperwork could not be pulled',
      expirationDate: null,
      monitoringActive: false,
    }
  }

  return {
    status: 'expired',
    policyNumber,
    carrier,
    detail: `${carrier} · ${policyNumber} · Expired — renew COI to restore monitoring`,
    expirationDate: '2025-01-15',
    monitoringActive: false,
  }
}

/** True when Certificial can pull an active COI for suggestion listing. */
export function hasPullableVerifiedCoi(vendor: VendorCoiLookupSubject): boolean {
  return resolveVendorCoiLookup(vendor).status === 'verified'
}

/** Drop vendors whose insurance paperwork cannot be pulled (or is expired). */
export function filterVendorsWithVerifiedCoi<T extends VendorCoiLookupSubject>(vendors: T[]): T[] {
  return vendors.filter((vendor) => hasPullableVerifiedCoi(vendor))
}

/** Async Certificial lookup used on the verification screen. */
export async function lookupVendorCoi(
  vendor: VendorCoiLookupSubject,
): Promise<VendorCoiLookupResult> {
  await new Promise((resolve) => setTimeout(resolve, 750))
  return resolveVendorCoiLookup(vendor)
}

export function initialCoiVerificationState(): VendorCoiVerificationState {
  return {
    status: 'checking',
    policyNumber: null,
    carrier: null,
    detail: 'Querying Certificial insurance tracking (simulated)…',
    expirationDate: null,
    monitoringActive: false,
  }
}

export function coiStateFromLookup(result: VendorCoiLookupResult): VendorCoiVerificationState {
  return {
    status: result.monitoringActive ? 'monitoring' : result.status,
    policyNumber: result.policyNumber,
    carrier: result.carrier,
    detail: result.monitoringActive
      ? `${result.detail} · Continuous monitoring on`
      : result.detail,
    expirationDate: result.expirationDate,
    monitoringActive: result.monitoringActive,
  }
}

export function isCoiVerificationComplete(state: VendorCoiVerificationState): boolean {
  return state.status === 'verified' || state.status === 'monitoring'
}

export function coiRequiresManualCollect(state: VendorCoiVerificationState): boolean {
  return state.status === 'not_found' || state.status === 'expired'
}
