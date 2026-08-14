/**
 * Import AI-extracted residents into the landlord roster during fast-track onboarding.
 */
import type { ExtractedLease, ExtractedResident } from '@/lib/onboardingMockExtraction'
import { isUniqueViolation } from '@/lib/errorMessage'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { supabase } from '@/lib/supabase'
import {
  nextOnboardingResidentIdFromSequence,
  onboardingResidentIdPrefix,
  parseOnboardingResidentSequence,
} from '../residentIds'
import { normalizeOnboardingOccupancyStatus } from '../types'
import {
  parseMonthlyRentInput,
  parseRentDueDayInput,
  type OnboardingResident,
} from './residents'

export type ImportExtractedResidentRow = ExtractedResident

type ImportUnitInventoryRow = {
  unitLabel: string
  building: string | null
  propertyId?: string | null
}

type ImportPropertyNameRow = {
  id?: string
  name: string
}

/** Map rent-roll / onboarding rows onto the saved property + unit inventory. */
export function resolveImportResidentBuilding(
  unit: string,
  extractedBuilding: string,
  units: ImportUnitInventoryRow[],
  properties: ImportPropertyNameRow[],
): string {
  const trimmedUnit = asTrimmed(unit)
  const trimmedBuilding = asTrimmed(extractedBuilding)
  const unitKey = trimmedUnit ? normalizeUnitLabel(trimmedUnit) : ''

  if (trimmedBuilding) {
    const canonical = properties.find(
      (property) =>
        normalizeBuildingKey(property.name) === normalizeBuildingKey(trimmedBuilding),
    )
    if (canonical?.name.trim()) return canonical.name.trim()

    const buildingMatch = units.find(
      (row) =>
        unitKey &&
        normalizeUnitLabel(row.unitLabel) === unitKey &&
        normalizeBuildingKey(row.building) === normalizeBuildingKey(trimmedBuilding),
    )
    if (buildingMatch?.building?.trim()) return buildingMatch.building.trim()

    if (unitKey) {
      const unitMatches = units.filter(
        (row) => normalizeUnitLabel(row.unitLabel) === unitKey,
      )
      if (unitMatches.length === 1 && unitMatches[0]!.building?.trim()) {
        return unitMatches[0]!.building.trim()
      }
      for (const property of properties) {
        const propertyId = property.id?.trim()
        const propertyName = property.name.trim()
        if (!propertyName) continue
        const belongs = unitMatches.some(
          (row) =>
            (propertyId && row.propertyId === propertyId) ||
            normalizeBuildingKey(row.building) === normalizeBuildingKey(propertyName),
        )
        if (belongs) return propertyName
      }
    }

    return trimmedBuilding
  }

  if (unitKey) {
    const unitMatches = units.filter(
      (row) => normalizeUnitLabel(row.unitLabel) === unitKey,
    )
    if (unitMatches.length === 1 && unitMatches[0]!.building?.trim()) {
      return unitMatches[0]!.building.trim()
    }
    for (const property of properties) {
      const propertyId = property.id?.trim()
      const propertyName = property.name.trim()
      if (!propertyName) continue
      const belongs = unitMatches.some(
        (row) =>
          (propertyId && row.propertyId === propertyId) ||
          normalizeBuildingKey(row.building) === normalizeBuildingKey(propertyName),
      )
      if (belongs) return propertyName
    }
  }

  if (properties.length === 1 && properties[0]!.name.trim()) {
    return properties[0]!.name.trim()
  }

  return ''
}

function asTrimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** Stable key for matching roster rows during import and review merge. */
export function onboardingResidentScopeKey(
  fullName: string,
  unit: string,
  building: string,
): string {
  return `${asTrimmed(fullName).toLowerCase()}::${asTrimmed(unit).toLowerCase()}::${normalizeBuildingKey(building)}`
}

export function onboardingResidentScopeKeyFromRow(
  row: Pick<OnboardingResident, 'fullName' | 'unit' | 'building'>,
): string {
  return onboardingResidentScopeKey(row.fullName, row.unit, row.building)
}

function personNamesMatch(a: string, b: string): boolean {
  const left = asTrimmed(a).toLowerCase()
  const right = asTrimmed(b).toLowerCase()
  if (!left || !right) return false
  return left === right
}

function resolveImportPhone(raw: string | null | undefined): string | null {
  return normalizePhoneForDb(raw)
}

function resolveLeaseMatch(
  resident: ImportExtractedResidentRow,
  leases: ExtractedLease[],
): ExtractedLease | undefined {
  return leases.find(
    (lease) =>
      personNamesMatch(lease.residentName, resident.fullName) ||
      (asTrimmed(lease.unit) &&
        asTrimmed(resident.unit) &&
        asTrimmed(lease.unit).toLowerCase() === asTrimmed(resident.unit).toLowerCase() &&
        normalizeBuildingKey(lease.building) === normalizeBuildingKey(resident.building)),
  )
}

type ExistingResidentRow = {
  id: string
  full_name: string
  unit: string | null
  building: string | null
  phone: string | null
}

async function loadExistingResidents(landlordId: string): Promise<ExistingResidentRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, unit, building, phone')
    .eq('landlord_id', landlordId)
  if (error) {
    console.warn('[landlordOnboarding] load residents for import', error.message)
    return []
  }
  return (data ?? []) as ExistingResidentRow[]
}

function findExistingByScope(
  existing: ExistingResidentRow[],
  fullName: string,
  unit: string,
  building: string,
): ExistingResidentRow | undefined {
  const key = onboardingResidentScopeKey(fullName, unit, building)
  return existing.find(
    (row) =>
      onboardingResidentScopeKey(
        String(row.full_name ?? ''),
        String(row.unit ?? ''),
        String(row.building ?? ''),
      ) === key,
  )
}

function findExistingByPhoneForSamePerson(
  existing: ExistingResidentRow[],
  phone: string,
  fullName: string,
  unit: string,
  building: string,
): ExistingResidentRow | undefined {
  return existing.find((row) => {
    if (asTrimmed(row.phone) !== phone) return false
    if (personNamesMatch(String(row.full_name ?? ''), fullName)) return true
    return (
      onboardingResidentScopeKey(
        String(row.full_name ?? ''),
        String(row.unit ?? ''),
        String(row.building ?? ''),
      ) === onboardingResidentScopeKey(fullName, unit, building)
    )
  })
}

async function startResidentIdSequence(landlordId: string): Promise<number> {
  let seq = 0
  if (!supabase) return seq

  const prefix = `${onboardingResidentIdPrefix(landlordId)}-`
  const { data, error } = await supabase
    .from('users')
    .select('resident_id')
    .like('resident_id', `${prefix}%`)

  if (error) {
    console.warn('[landlordOnboarding] resident id sequence', error.message)
    return seq
  }

  for (const row of data ?? []) {
    const parsed = parseOnboardingResidentSequence(
      String((row as { resident_id?: string }).resident_id ?? ''),
      landlordId,
    )
    if (parsed != null) seq = Math.max(seq, parsed)
  }
  return seq
}

async function updateExistingResident(
  landlordId: string,
  existingId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', existingId)
    .eq('landlord_id', landlordId)
  if (error) {
    console.warn('[landlordOnboarding] update imported resident', error.message)
    return false
  }
  return true
}

async function insertImportedResident(
  landlordId: string,
  payload: Record<string, unknown>,
  startSeq: number,
): Promise<{ ok: boolean; nextSeq: number }> {
  if (!supabase) return { ok: false, nextSeq: startSeq }

  let seq = startSeq
  for (let attempt = 0; attempt < 5; attempt += 1) {
    seq += 1
    const residentId = nextOnboardingResidentIdFromSequence(seq, landlordId)
    const { error } = await supabase.from('users').insert({
      ...payload,
      resident_id: residentId,
      landlord_id: landlordId,
    })
    if (!error) {
      return { ok: true, nextSeq: seq }
    }
    if (isUniqueViolation(error)) {
      if (/resident_id/i.test(error.message)) {
        continue
      }
      console.warn('[landlordOnboarding] insert imported resident', error.message)
      return { ok: false, nextSeq: seq }
    }
    console.warn('[landlordOnboarding] insert imported resident', error.message)
    return { ok: false, nextSeq: seq }
  }

  return { ok: false, nextSeq: seq }
}

export async function importOnboardingResidentsFromExtraction(
  residents: ImportExtractedResidentRow[],
  leases: ExtractedLease[],
  landlordId: string,
  options?: {
    properties?: ImportPropertyNameRow[]
    units?: ImportUnitInventoryRow[]
  },
): Promise<number> {
  const selectedResidents = residents.filter((row) => row.selected)
  const selectedLeases = leases.filter((lease) => lease.selected)
  if (selectedResidents.length === 0 || !supabase) return 0

  let unitInventory = options?.units ?? []
  if (unitInventory.length === 0) {
    const { data, error } = await supabase
      .from('units')
      .select('unit_label, building, property_id')
      .eq('landlord_id', landlordId)
    if (!error) {
      unitInventory = (data ?? []).map((row) => ({
        unitLabel: String((row as { unit_label?: string }).unit_label ?? ''),
        building: String((row as { building?: string | null }).building ?? '') || null,
        propertyId: String((row as { property_id?: string | null }).property_id ?? '') || null,
      }))
    }
  }

  const properties = options?.properties ?? []

  let imported = 0
  let seq = await startResidentIdSequence(landlordId)
  let existing = await loadExistingResidents(landlordId)

  for (const resident of selectedResidents) {
    const matchedLease = resolveLeaseMatch(resident, selectedLeases)
    const resolvedUnit = asTrimmed(resident.unit) || asTrimmed(matchedLease?.unit) || ''
    const resolvedBuilding = resolveImportResidentBuilding(
      resolvedUnit,
      asTrimmed(resident.building) || asTrimmed(matchedLease?.building) || '',
      unitInventory,
      properties,
    )
    const monthlyRent =
      parseMonthlyRentInput(String(resident.monthlyRent ?? '')) ??
      (matchedLease?.rentAmount != null ? parseMonthlyRentInput(matchedLease.rentAmount) : null)
    const rentDueDay = parseRentDueDayInput(String(resident.rentDueDay ?? ''))
    const occupancyStatus = normalizeOnboardingOccupancyStatus(resident.occupancyStatus)
    const maintenanceClause = asTrimmed(resident.maintenanceResponsibilitiesClause) || null
    const normalizedPhone = resolveImportPhone(resident.phone)

    const payload = {
      full_name: asTrimmed(resident.fullName) || 'Resident',
      email: asTrimmed(resident.email),
      phone: normalizedPhone as string | null,
      unit: resolvedUnit,
      building: resolvedBuilding,
      status: occupancyStatus,
      balance_due: 0,
      issues: [] as string[],
      move_in_date: asTrimmed(resident.leaseStart) || null,
      lease_end_date: asTrimmed(resident.leaseEnd) || null,
      monthly_rent: monthlyRent,
      rent_due_day: rentDueDay,
      maintenance_responsibilities_clause: maintenanceClause,
    }

    const scopeMatch = findExistingByScope(
      existing,
      payload.full_name,
      resolvedUnit,
      resolvedBuilding,
    )
    if (scopeMatch) {
      let phoneForUpdate = normalizedPhone
      if (phoneForUpdate) {
        const conflictingPhone = existing.find(
          (row) =>
            row.id !== scopeMatch.id &&
            asTrimmed(row.phone) === phoneForUpdate &&
            !personNamesMatch(String(row.full_name ?? ''), payload.full_name) &&
            onboardingResidentScopeKey(
              String(row.full_name ?? ''),
              String(row.unit ?? ''),
              String(row.building ?? ''),
            ) !== onboardingResidentScopeKey(payload.full_name, resolvedUnit, resolvedBuilding),
        )
        if (conflictingPhone) phoneForUpdate = null
      }

      const updated = await updateExistingResident(landlordId, scopeMatch.id, {
        ...payload,
        phone: phoneForUpdate,
      })
      if (updated) imported += 1
      continue
    }

    let phoneForInsert = normalizedPhone
    if (
      phoneForInsert &&
      findExistingByPhoneForSamePerson(
        existing,
        phoneForInsert,
        payload.full_name,
        resolvedUnit,
        resolvedBuilding,
      ) === undefined &&
      existing.some((row) => asTrimmed(row.phone) === phoneForInsert)
    ) {
      // Shared office / placeholder numbers on rent rolls must not collapse distinct tenants.
      phoneForInsert = null
    }

    const inserted = await insertImportedResident(
      landlordId,
      { ...payload, phone: phoneForInsert },
      seq,
    )
    seq = inserted.nextSeq
    if (!inserted.ok) continue

    imported += 1
    existing.push({
      id: `imported-${imported}`,
      full_name: payload.full_name,
      unit: resolvedUnit,
      building: resolvedBuilding,
      phone: phoneForInsert,
    })
  }

  return imported
}

export function mergeFastTrackReviewResidents(
  persisted: OnboardingResident[],
  extracted: ImportExtractedResidentRow[],
): OnboardingResident[] {
  const merged = [...persisted]
  const seen = new Set(persisted.map((row) => onboardingResidentScopeKeyFromRow(row)))

  for (const [index, row] of extracted.filter((item) => item.selected).entries()) {
    const key = onboardingResidentScopeKey(row.fullName, row.unit, row.building)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({
      id: row.id || `extract-review-${index}`,
      residentId: '',
      fullName: row.fullName,
      unit: row.unit,
      building: row.building,
      email: row.email,
      phone: row.phone,
      monthlyRent: parseMonthlyRentInput(String(row.monthlyRent ?? '')),
      rentDueDay: parseRentDueDayInput(String(row.rentDueDay ?? '')),
      leaseStart: asTrimmed(row.leaseStart) || null,
      leaseEnd: asTrimmed(row.leaseEnd) || null,
      maintenanceResponsibilitiesClause: asTrimmed(row.maintenanceResponsibilitiesClause) || null,
      occupancyStatus: normalizeOnboardingOccupancyStatus(row.occupancyStatus),
    })
  }

  return merged
}
