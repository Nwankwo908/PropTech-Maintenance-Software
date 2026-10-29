import { getActiveLandlordId } from '@/lib/activeLandlord'
import { propertyAccessHasContent, normalizePropertyAccess } from '@/lib/propertyAccess'
import { insuranceProfileIsOnFile, type StoredInsuranceProfile } from '@/lib/propertyInsuranceProfile'
import { supabase } from '@/lib/supabase'

export type PropertyInformationSubject = {
  id: string
  name: string
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** A property needs more information when access, insurance, or a finished home check is missing. */
export function propertyNeedsMoreInformation(input: {
  hasAccess: boolean
  hasInsurance: boolean
  homeCheckComplete: boolean
}): boolean {
  return !input.hasAccess || !input.hasInsurance || !input.homeCheckComplete
}

export function countPropertiesNeedingMoreInformation(
  properties: readonly PropertyInformationSubject[],
  gaps: {
    accessBuildings: ReadonlySet<string>
    insuredBuildings: ReadonlySet<string>
    homeCheckPropertyIds: ReadonlySet<string>
  },
): number {
  let count = 0
  for (const property of properties) {
    const name = nameKey(property.name)
    if (!name) continue
    const needs = propertyNeedsMoreInformation({
      hasAccess: gaps.accessBuildings.has(name),
      hasInsurance: gaps.insuredBuildings.has(name),
      homeCheckComplete: Boolean(property.id) && gaps.homeCheckPropertyIds.has(property.id),
    })
    if (needs) count += 1
  }
  return count
}

export function propertiesNeedMoreInformationCopy(count: number): { title: string; detail: string } | null {
  if (count <= 0) return null
  const title =
    count === 1
      ? '1 property needs more information'
      : `${count} properties need more information`
  return {
    title,
    detail: 'Missing property access, insurance, or a completed home check.',
  }
}

function accessNames(rows: unknown[]): Set<string> {
  const names = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as { building?: unknown }
    const building = typeof record.building === 'string' ? record.building : ''
    if (!building.trim() || !propertyAccessHasContent(normalizePropertyAccess(row))) continue
    names.add(nameKey(building))
  }
  return names
}

function insuredNames(rows: unknown[]): Set<string> {
  const names = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as { building?: unknown; profile?: unknown }
    const building = typeof record.building === 'string' ? record.building : ''
    const profile =
      record.profile && typeof record.profile === 'object'
        ? (record.profile as StoredInsuranceProfile)
        : null
    if (!building.trim() || !insuranceProfileIsOnFile(profile)) continue
    names.add(nameKey(building))
  }
  return names
}

/** Completed or confirmed home checks count. A check still collecting does not. */
export function homeCheckIsComplete(status: string | null | undefined): boolean {
  const value = (status ?? '').trim().toLowerCase()
  return value === 'completed' || value === 'confirmed'
}

export async function loadPropertiesNeedingMoreInformationCount(
  properties: readonly PropertyInformationSubject[],
  landlordId: string = getActiveLandlordId(),
): Promise<number | null> {
  const listed = properties.filter((property) => property.name.trim())
  if (!listed.length) return 0
  if (!supabase || !landlordId) return null

  const [accessResult, insuranceResult, homeCheckResult] = await Promise.all([
    supabase.from('property_access_profiles').select('*').eq('landlord_id', landlordId),
    supabase.from('property_insurance_profiles').select('building, profile').eq('landlord_id', landlordId),
    supabase.from('home_checks').select('property_id, status').eq('landlord_id', landlordId),
  ])
  if (accessResult.error || insuranceResult.error || homeCheckResult.error) return null

  const homeCheckPropertyIds = new Set<string>()
  for (const row of homeCheckResult.data ?? []) {
    const id = typeof row.property_id === 'string' ? row.property_id : ''
    if (id && homeCheckIsComplete(typeof row.status === 'string' ? row.status : null)) {
      homeCheckPropertyIds.add(id)
    }
  }

  return countPropertiesNeedingMoreInformation(listed, {
    accessBuildings: accessNames(accessResult.data ?? []),
    insuredBuildings: insuredNames(insuranceResult.data ?? []),
    homeCheckPropertyIds,
  })
}
