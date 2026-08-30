import { formatVendorTradeLabel, normalizeVendorTrade } from '@/lib/vendorTrades'
import {
  computeVerificationChecklist,
  type VerificationRecord,
  type VerificationServiceArea,
} from '@/lib/vendorVerificationChecklist'
import { resolveVendorCapacityChip } from '@/lib/vendorStatusChip'

/**
 * Vendor compliance profile for the vendor detail KPI + cards.
 *
 * When a linked `vendor_verifications` row exists, document counts and
 * capacity come from that checklist. Without verification, docs stay empty
 * ("not collected yet") and capacity stays Pending.
 */

export type VendorComplianceItem = {
  id: string
  label: string
  /** True only when a real document/record has been retrieved and stored. */
  collected: boolean
  /** Populated headline/detail when collected; null while empty. */
  headline: string | null
  detail: string | null
  meta?: string | null
  /** Shown when nothing has been collected yet. */
  emptyHint: string
  /** When true, missing this item does not block verification. */
  optional?: boolean
}

export type VendorServiceArea = {
  set: boolean
  primaryMetro: string | null
  radiusMiles: number | null
  zipCodes: string[]
  cities: string[]
  /** Two-letter US state from the verification form (stored in `counties`). */
  stateCode: string | null
  centerAddress: string | null
  emptyHint: string
}

export type VendorCapacity = {
  status: 'pending' | 'docs_submitted' | 'active' | 'paused' | 'suspended' | 'banned'
  label: string
  detail: string
  matchable: boolean
}

export type VendorTradeCategories = {
  set: boolean
  primaryLabel: string | null
  labels: string[]
  emptyHint: string
}

export type VendorComplianceProfile = {
  documents: VendorComplianceItem[]
  stateLicense: VendorComplianceItem
  generalLiabilityCoi: VendorComplianceItem
  w9: VendorComplianceItem
  tradeCategories: VendorTradeCategories
  serviceArea: VendorServiceArea
  capacity: VendorCapacity
  collectedCount: number
  totalRequirements: number
}

export type VendorComplianceSubject = {
  id?: string | null
  name: string
  phone?: string | null
  category?: string | null
  active?: boolean | null
  /** Platform hold: suspended | banned */
  rosterStatus?: string | null
  /** Landlord activated without verification documents. */
  onboardingOverriddenAt?: string | null
}

/** Empty compliance requirement — nothing retrieved during onboarding. */
function emptyDocument(
  id: string,
  label: string,
  emptyHint: string,
  optional = false,
): VendorComplianceItem {
  return {
    id,
    label,
    collected: false,
    headline: null,
    detail: null,
    meta: null,
    emptyHint,
    optional,
  }
}

function documentFromChecklist(
  empty: VendorComplianceItem,
  checklistItem: { status: string; detail: string; label: string } | undefined,
  headlineWhenComplete: string,
): VendorComplianceItem {
  if (!checklistItem) return empty
  if (checklistItem.status === 'complete') {
    return {
      ...empty,
      collected: true,
      headline: headlineWhenComplete,
      detail: checklistItem.detail,
      emptyHint: '',
    }
  }
  if (checklistItem.status === 'action_needed' || checklistItem.status === 'pending') {
    return {
      ...empty,
      collected: false,
      headline: null,
      detail: checklistItem.detail,
      emptyHint: checklistItem.detail || empty.emptyHint,
    }
  }
  return empty
}

function buildTradeCategories(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorTradeCategories {
  const tradeSlugs = (verification?.trade_categories ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  )
  if (tradeSlugs.length > 0) {
    const labels = tradeSlugs.map((slug) => formatVendorTradeLabel(slug))
    return {
      set: true,
      primaryLabel: labels[0] ?? null,
      labels,
      emptyHint: '',
    }
  }

  const hasCategory = !!subject.category?.trim()
  if (!hasCategory) {
    return {
      set: false,
      primaryLabel: null,
      labels: [],
      emptyHint: 'No trade category set for this vendor yet.',
    }
  }

  const primaryLabel = formatVendorTradeLabel(subject.category)
  const slug = normalizeVendorTrade(subject.category, { fallbackOther: true })
  const labels: string[] = [primaryLabel]
  if (slug === 'general') {
    for (const extra of ['Carpentry', 'Painting', 'Flooring']) {
      if (!labels.includes(extra)) labels.push(extra)
    }
  }

  return { set: true, primaryLabel, labels, emptyHint: '' }
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function stateCodeFromCounties(counties: string[]): string | null {
  const match = counties.find((county) => /^[A-Za-z]{2}$/.test(county))
  return match ? match.toUpperCase() : null
}

function stateCodeFromCenterAddress(centerAddress: string | null): string | null {
  if (!centerAddress) return null
  const parts = centerAddress.split(',').map((part) => part.trim()).filter(Boolean)
  for (const part of parts.slice(1)) {
    const token = part.split(/\s+/)[0] ?? ''
    if (/^[A-Za-z]{2}$/.test(token)) return token.toUpperCase()
  }
  return null
}

function buildServiceArea(verification?: VerificationRecord | null): VendorServiceArea {
  const area = (verification?.service_area ?? {}) as VerificationServiceArea & {
    zipCodes?: string[]
  }
  const zips = [...stringList(area.zips), ...stringList(area.zipCodes)].filter(
    (zip, index, all) => all.indexOf(zip) === index,
  )
  const cities = stringList(area.cities)
  const counties = stringList(area.counties)
  const radiusMiles =
    typeof area.radiusMiles === 'number' && Number.isFinite(area.radiusMiles)
      ? area.radiusMiles
      : null
  const centerAddress = typeof area.centerAddress === 'string' ? area.centerAddress.trim() || null : null
  const stateCode = stateCodeFromCounties(counties) ?? stateCodeFromCenterAddress(centerAddress)

  if (
    zips.length === 0 &&
    cities.length === 0 &&
    radiusMiles == null &&
    !centerAddress &&
    !stateCode
  ) {
    return {
      set: false,
      primaryMetro: null,
      radiusMiles: null,
      zipCodes: [],
      cities: [],
      stateCode: null,
      centerAddress: null,
      emptyHint: 'No service area set yet — add coverage to route nearby work.',
    }
  }

  const primaryMetro = cities[0] ?? (zips.length ? `ZIPs: ${zips.slice(0, 3).join(', ')}` : null)
  return {
    set: true,
    primaryMetro: primaryMetro ?? 'Service area on file',
    radiusMiles,
    zipCodes: zips,
    cities,
    stateCode,
    centerAddress,
    emptyHint: '',
  }
}

/** Single geocode pin: city + state + ZIP from the verification form. */
export function composeVendorServiceAreaMapPin(serviceArea: VendorServiceArea): string | null {
  const center = serviceArea.centerAddress?.trim() ?? ''
  if (center) return center
  const composed = [serviceArea.cities[0], serviceArea.stateCode, serviceArea.zipCodes[0]]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ')
  return composed || null
}

/** Map queries from the verification form service area; HQ location is fallback only. */
export function mapQueriesForVendorServiceArea(
  serviceArea: VendorServiceArea,
  fallbackLocation?: string | null,
): string[] {
  const pin = composeVendorServiceAreaMapPin(serviceArea)
  const pinNorm = pin ? normalizePlace(pin) : ''
  const pinZip = pin ? zip5(pin) : null
  const extraCities = serviceArea.cities.filter((city) => {
    const n = normalizePlace(city)
    return n && (!pinNorm || (n !== pinNorm && !pinNorm.includes(n)))
  })
  const extraZips = serviceArea.zipCodes.filter((zip) => {
    const z = zip5(zip) ?? zip.trim()
    return z && z !== pinZip && !(pin ?? '').includes(z)
  })
  const fromArea = [pin, ...extraCities, ...extraZips]
    .map((query) => query?.trim() ?? '')
    .filter(Boolean)
  if (fromArea.length > 0) return [...new Set(fromArea)]
  const fallback = fallbackLocation?.trim() ?? ''
  return fallback ? [fallback] : []
}

function normalizePlace(value: string): string {
  return value.trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ')
}

function zip5(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 5 ? digits.slice(0, 5) : null
}

export type PropertyLocationForVendorCoverage = {
  zipCode?: string | null
  city?: string | null
  state?: string | null
  streetAddress?: string | null
  addressLine?: string | null
}

/** True when the vendor's coverage (or HQ fallback) includes this property. */
export function vendorServiceAreaCoversProperty(
  serviceArea: VendorServiceArea,
  property: PropertyLocationForVendorCoverage,
  hqLocation?: string | null,
): boolean {
  const queries = mapQueriesForVendorServiceArea(serviceArea, hqLocation)
  if (queries.length === 0) return false

  const propZip = property.zipCode ? zip5(property.zipCode) : null
  const propCity = property.city ? normalizePlace(property.city) : ''
  const addressBlob = normalizePlace(
    [
      property.addressLine,
      property.streetAddress,
      property.city,
      property.state,
      property.zipCode,
    ]
      .filter(Boolean)
      .join(' '),
  )

  for (const raw of queries) {
    const queryZip = zip5(raw)
    if (queryZip && propZip && queryZip === propZip) return true
    if (queryZip && addressBlob.includes(queryZip)) return true

    const n = normalizePlace(raw)
    if (!n) continue
    if (
      propCity &&
      (n === propCity || n.startsWith(`${propCity} `) || n.startsWith(`${propCity},`))
    ) {
      return true
    }
    if (n.length >= 4 && addressBlob.includes(n)) return true
  }
  return false
}

function buildCapacity(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorCapacity {
  const chip = resolveVendorCapacityChip({
    verificationStatus: verification?.status,
    vendorActive: subject.active,
    availability: verification?.availability,
    rosterStatus: subject.rosterStatus,
    onboardingOverriddenAt: subject.onboardingOverriddenAt,
  })
  return {
    status: chip.status,
    label: chip.label,
    detail: chip.detail,
    matchable: chip.matchable,
  }
}

export function buildVendorComplianceProfile(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorComplianceProfile {
  const emptyLicense = emptyDocument(
    'state_license',
    'State license',
    'Not collected yet — Ulo will verify against the state licensing board.',
  )
  const emptyCoi = emptyDocument(
    'gl_coi',
    'General liability COI',
    'Not collected yet — request a certificate of insurance from the vendor.',
  )
  const emptyW9 = emptyDocument(
    'w9',
    'W-9 on file',
    'Optional — add a W-9 when you need it for 1099 reporting.',
    true,
  )

  let stateLicense = emptyLicense
  let generalLiabilityCoi = emptyCoi
  let w9 = emptyW9

  if (verification) {
    const checklist = computeVerificationChecklist(verification)
    const byId = new Map(checklist.items.map((item) => [item.id, item]))

    stateLicense = documentFromChecklist(emptyLicense, byId.get('license'), 'State license on file')
    generalLiabilityCoi = documentFromChecklist(
      emptyCoi,
      byId.get('coi_coverage'),
      'General liability COI on file',
    )
    w9 = documentFromChecklist(emptyW9, byId.get('w9'), 'W-9 on file')
  }

  const documents = [stateLicense, generalLiabilityCoi, w9]
  const requiredDocuments = documents.filter((item) => !item.optional)
  const collectedCount = requiredDocuments.filter((item) => item.collected).length

  return {
    documents,
    stateLicense,
    generalLiabilityCoi,
    w9,
    tradeCategories: buildTradeCategories(subject, verification),
    serviceArea: buildServiceArea(verification),
    capacity: buildCapacity(subject, verification),
    collectedCount,
    totalRequirements: requiredDocuments.length,
  }
}
