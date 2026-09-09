import { getActiveLandlordId } from '@/lib/activeLandlord'
import { ASSET_REGISTRY_CHANGED_EVENT } from '@/lib/assetRegistry'
import { INSPECTION_SESSION_CHANGED_EVENT } from '@/lib/inspectionSession'
import {
  loadApprovedMaintenanceRecords,
  loadMaintenanceHistoryDocuments,
} from '@/lib/maintenanceHistoryImport'
import { loadPropertyAccess, propertyAccessHasContent } from '@/lib/propertyAccess'
import { supabase } from '@/lib/supabase'

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

async function hasStoredInspectionWork(building: string): Promise<boolean> {
  const landlordId = getActiveLandlordId()
  if (!landlordId || !supabase) return false

  const { count: assetCount } = await supabase
    .from('unit_assets')
    .select('id', { count: 'exact', head: true })
    .eq('landlord_id', landlordId)
    .eq('building', building)
  if ((assetCount ?? 0) > 0) return true

  const { data: sessions } = await supabase
    .from('property_inspection_assessments')
    .select('id')
    .eq('landlord_id', landlordId)
    .eq('building', building)
    .limit(40)
  const ids = (sessions ?? []).map((row) => String(row.id)).filter(Boolean)
  if (ids.length === 0) return false

  const { count: photoCount } = await supabase
    .from('property_inspection_photos')
    .select('id', { count: 'exact', head: true })
    .in('assessment_id', ids)
  return (photoCount ?? 0) > 0
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
  insurance: boolean
  history: boolean
}): boolean {
  return (
    sections.inspection &&
    sections.access &&
    sections.insurance &&
    sections.history
  )
}

/** Setup-success: any saved Property Details module on that building counts. */
export function propertyDetailsHasAnySection(sections: {
  inspection: boolean
  access: boolean
  insurance: boolean
  history: boolean
}): boolean {
  return sections.inspection || sections.access || sections.insurance || sections.history
}

export const PROPERTY_DETAILS_CHANGED_EVENT = 'ulo:property-details-changed'

export function notifyPropertyDetailsChanged(building?: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(PROPERTY_DETAILS_CHANGED_EVENT, {
        detail: { building: building?.trim() || '' },
      }),
    )
  } catch {
    // non-browser
  }
}

export async function isPropertyDetailsComplete(
  building: string,
  _initialYearBuilt?: number | null,
): Promise<boolean> {
  const name = building.trim()
  if (!name) return false

  const inspection = await hasStoredInspectionWork(name)
  const history =
    loadMaintenanceHistoryDocuments({ building: name }).length > 0 ||
    loadApprovedMaintenanceRecords({ building: name }).length > 0
  const insurance = loadInsuranceHasContent(name)

  const access = await loadPropertyAccess(name)
  const accessFilled = Boolean(access.updatedAt) || propertyAccessHasContent(access)

  return propertyDetailsHasAnySection({
    inspection,
    access: accessFilled,
    insurance,
    history,
  })
}

/** True when at least one named property has any Property Details section filled. */
export async function isAnyPropertyDetailsComplete(
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
    if (await isPropertyDetailsComplete(name, yearBuilt)) return true
  }
  return false
}

/** True only when every named property has all Property Details sections filled. */
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
  PROPERTY_DETAILS_CHANGED_EVENT,
  ASSET_REGISTRY_CHANGED_EVENT,
  INSPECTION_SESSION_CHANGED_EVENT,
  'storage',
] as const
