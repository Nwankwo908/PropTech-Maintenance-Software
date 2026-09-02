import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  ASSET_REGISTRY_CHANGED_EVENT,
  assetRegistryHasContent,
  loadAssetRegistryAsync,
} from '@/lib/assetRegistry'
import {
  loadApprovedMaintenanceRecords,
  loadMaintenanceHistoryDocuments,
} from '@/lib/maintenanceHistoryImport'
import { loadPropertyAccess } from '@/lib/propertyAccess'
import { loadPropertyBuildingProfile } from '@/lib/propertyBuildingProfile'

function buildingKey(building: string): string {
  return building.trim().toLowerCase().replace(/\s+/g, '-')
}

function landlordScopedKey(prefix: string, building: string): string {
  return `${prefix}.${getActiveLandlordId()}.${buildingKey(building)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function loadInspectionDocCount(building: string): number {
  const parsed = readJson<unknown>(landlordScopedKey('ulo.propertyInspection', building), [])
  if (!Array.isArray(parsed)) return 0
  return parsed.filter(
    (row) =>
      row != null &&
      typeof row === 'object' &&
      typeof (row as { id?: unknown }).id === 'string' &&
      typeof (row as { fileName?: unknown }).fileName === 'string',
  ).length
}

type InsuranceProfileLite = {
  carrier: string
  policyNumber: string
  coverageStartDate: string
  coverageEndDate: string
  renewalDate: string
  claimsContactName: string
  claimsPhone: string
  additionalInsured: boolean
  binderFileName: string | null
  updatedAt: string | null
}

function insuranceHasContent(profile: InsuranceProfileLite): boolean {
  return Boolean(
    profile.carrier.trim() ||
      profile.policyNumber.trim() ||
      profile.coverageStartDate.trim() ||
      profile.coverageEndDate.trim() ||
      profile.renewalDate.trim() ||
      profile.claimsContactName.trim() ||
      profile.claimsPhone.trim() ||
      profile.additionalInsured ||
      profile.binderFileName ||
      profile.updatedAt,
  )
}

function loadInsuranceHasContent(building: string): boolean {
  const raw = readJson<Record<string, unknown>>(
    landlordScopedKey('ulo.propertyInsurance', building),
    {},
  )
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  return insuranceHasContent({
    carrier: str('carrier'),
    policyNumber: str('policyNumber'),
    coverageStartDate: str('coverageStartDate'),
    coverageEndDate: str('coverageEndDate'),
    renewalDate: str('renewalDate'),
    claimsContactName: str('claimsContactName'),
    claimsPhone: str('claimsPhone'),
    additionalInsured: raw.additionalInsured === true,
    binderFileName: typeof raw.binderFileName === 'string' ? raw.binderFileName : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  })
}

export function propertyDetailsSectionsComplete(sections: {
  inspection: boolean
  access: boolean
  assets: boolean
  insurance: boolean
  history: boolean
}): boolean {
  return (
    sections.inspection &&
    sections.access &&
    sections.assets &&
    sections.insurance &&
    sections.history
  )
}

export async function isPropertyDetailsComplete(
  building: string,
  initialYearBuilt?: number | null,
): Promise<boolean> {
  const name = building.trim()
  if (!name) return false

  const inspection = loadInspectionDocCount(name) > 0
  const history =
    loadMaintenanceHistoryDocuments({ building: name }).length > 0 ||
    loadApprovedMaintenanceRecords({ building: name }).length > 0
  const insurance = loadInsuranceHasContent(name)

  const [access, registry, profile] = await Promise.all([
    loadPropertyAccess(name),
    loadAssetRegistryAsync(name),
    loadPropertyBuildingProfile(name),
  ])
  const accessFilled = Boolean(access.updatedAt)
  const assets =
    assetRegistryHasContent(registry) ||
    profile.yearBuilt != null ||
    (initialYearBuilt != null && Number.isFinite(initialYearBuilt))

  return propertyDetailsSectionsComplete({
    inspection,
    access: accessFilled,
    assets,
    insurance,
    history,
  })
}

/** True only when every named property has all five Property Details sections filled. */
export async function areAllPropertiesDetailsComplete(
  properties: { name: string; yearBuilt?: number | null }[],
): Promise<boolean> {
  const unique = new Map<string, number | null | undefined>()
  for (const property of properties) {
    const name = property.name.trim()
    if (!name) continue
    if (!unique.has(name)) unique.set(name, property.yearBuilt)
  }
  if (unique.size === 0) return false
  for (const [name, yearBuilt] of unique) {
    if (!(await isPropertyDetailsComplete(name, yearBuilt))) return false
  }
  return true
}

export const PROPERTY_DETAILS_CHANGED_EVENTS = [
  ASSET_REGISTRY_CHANGED_EVENT,
  'storage',
] as const
