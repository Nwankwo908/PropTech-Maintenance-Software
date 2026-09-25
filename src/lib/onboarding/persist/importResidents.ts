/**
 * Import AI-extracted residents into the landlord roster during fast-track onboarding.
 */
import type { ExtractedLease, ExtractedResident } from '@/lib/onboardingMockExtraction'
import { recordActivityLog } from '@/lib/recordActivityLog'
import {
  importActorActivityMetadata,
  importActorUserColumns,
  resolveOnboardingImportActor,
  type OnboardingImportActor,
} from '@/lib/onboarding/importActor'
import { readLocalOnboardingState } from '@/lib/onboarding/draftStorage'
import {
  onboardingSessionActivityMetadata,
  onboardingSessionFromState,
  onboardingSessionUserColumns,
  type OnboardingSessionStamp,
} from '@/lib/onboarding/session'
import { isUniqueViolation } from '@/lib/errorMessage'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { leaseUnitOrDefault } from '@/lib/onboarding/leaseUnit'
import { extractedPlacesOverlap } from '@/lib/onboarding/persist/properties'
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

    const overlappingProperties = properties.filter((property) =>
      extractedPlacesOverlap(trimmedBuilding, property.name),
    )
    if (overlappingProperties.length === 1 && overlappingProperties[0]!.name.trim()) {
      return overlappingProperties[0]!.name.trim()
    }

    if (unitKey) {
      const unitMatches = units.filter(
        (row) => normalizeUnitLabel(row.unitLabel) === unitKey,
      )
      if (unitMatches.length === 1 && unitMatches[0]!.building?.trim()) {
        return unitMatches[0]!.building.trim()
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
  }

  if (properties.length === 1 && properties[0]!.name.trim()) {
    return properties[0]!.name.trim()
  }

  return ''
}

function asTrimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** Prefer the resident unit; if a lease is present with no unit, default to 1. */
export function resolveImportedResidentUnit(
  residentUnit: string | null | undefined,
  matchedLeaseUnit: string | null | undefined,
  hasMatchedLease: boolean,
): string {
  const fromResident = asTrimmed(residentUnit)
  if (fromResident) return fromResident
  if (hasMatchedLease) return leaseUnitOrDefault(matchedLeaseUnit)
  return ''
}

const PERSISTED_USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPersistedUserId(id: string | null | undefined): boolean {
  return Boolean(id && PERSISTED_USER_ID_RE.test(id))
}

function normalizePersonNameKey(name: string): string {
  return asTrimmed(name).toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ')
}

function personNamesMatch(a: string, b: string): boolean {
  const left = normalizePersonNameKey(a)
  const right = normalizePersonNameKey(b)
  if (!left || !right) return false
  if (left === right) return true
  const leftParts = left.split(' ')
  const rightParts = right.split(' ')
  if (leftParts.length === 2 && rightParts.length === 2) {
    return leftParts[0] === rightParts[1] && leftParts[1] === rightParts[0]
  }
  return false
}

function digitsOnlyPhone(phone: string | null | undefined): string {
  const digits = asTrimmed(phone).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function importBuildingsCompatible(left: string, right: string): boolean {
  const buildingLeft = asTrimmed(left)
  const buildingRight = asTrimmed(right)
  if (!buildingLeft || !buildingRight) return true
  if (normalizeBuildingKey(buildingLeft) === normalizeBuildingKey(buildingRight)) return true
  return extractedPlacesOverlap(buildingLeft, buildingRight)
}

export type OnboardingResidentIdentity = {
  id?: string
  fullName: string
  unit: string
  building: string
  phone?: string | null
}

/** Same person across AI review and final review — not a second roster row. */
export function onboardingResidentIdentityMatch(
  left: OnboardingResidentIdentity,
  right: OnboardingResidentIdentity,
): boolean {
  if (isPersistedUserId(left.id) && left.id === right.id) return true
  if (!personNamesMatch(left.fullName, right.fullName)) return false

  const phoneLeft = digitsOnlyPhone(left.phone)
  const phoneRight = digitsOnlyPhone(right.phone)
  if (phoneLeft.length >= 10 && phoneLeft === phoneRight) return true

  const unitLeft = normalizeUnitLabel(left.unit)
  const unitRight = normalizeUnitLabel(right.unit)
  if (unitLeft && unitRight && unitLeft !== unitRight) return false
  if (!importBuildingsCompatible(left.building, right.building)) return false
  if (unitLeft && unitRight && unitLeft === unitRight) return true
  if ((!unitLeft || !unitRight) && (asTrimmed(left.building) || asTrimmed(right.building))) {
    return true
  }
  return false
}

/** Stable key for matching roster rows during import and review merge. */
export function onboardingResidentScopeKey(
  fullName: string,
  unit: string,
  building: string,
): string {
  return `${normalizePersonNameKey(fullName)}::${normalizeUnitLabel(unit)}::${normalizeBuildingKey(building)}`
}

export function onboardingResidentScopeKeyFromRow(
  row: Pick<OnboardingResident, 'fullName' | 'unit' | 'building'>,
): string {
  return onboardingResidentScopeKey(row.fullName, row.unit, row.building)
}

type ExistingResidentRow = {
  id: string
  full_name: string
  unit: string | null
  building: string | null
  phone: string | null
}

function identityFromExisting(row: ExistingResidentRow): OnboardingResidentIdentity {
  return {
    id: row.id,
    fullName: String(row.full_name ?? ''),
    unit: String(row.unit ?? ''),
    building: String(row.building ?? ''),
    phone: row.phone,
  }
}

function identityFromImportRow(row: ImportExtractedResidentRow): OnboardingResidentIdentity {
  return {
    id: row.id,
    fullName: row.fullName,
    unit: row.unit,
    building: row.building,
    phone: row.phone,
  }
}

function mergeImportResidentRow(
  primary: ImportExtractedResidentRow,
  extra: ImportExtractedResidentRow,
): ImportExtractedResidentRow {
  const preferPersistedId =
    isPersistedUserId(extra.id) && !isPersistedUserId(primary.id) ? extra.id : primary.id
  return {
    ...primary,
    id: preferPersistedId || primary.id,
    fullName: asTrimmed(primary.fullName) || extra.fullName,
    unit: asTrimmed(primary.unit) || extra.unit,
    building: asTrimmed(primary.building) || extra.building,
    phone: asTrimmed(primary.phone) || extra.phone,
    email: asTrimmed(primary.email) || extra.email,
    leaseStart: asTrimmed(primary.leaseStart) || extra.leaseStart,
    leaseEnd: asTrimmed(primary.leaseEnd) || extra.leaseEnd,
    monthlyRent: String(primary.monthlyRent ?? '').trim() || extra.monthlyRent,
    rentDueDay: String(primary.rentDueDay ?? '').trim() || extra.rentDueDay,
    occupancyStatus: primary.occupancyStatus || extra.occupancyStatus,
    maintenanceResponsibilitiesClause:
      asTrimmed(primary.maintenanceResponsibilitiesClause) ||
      extra.maintenanceResponsibilitiesClause,
    selected: primary.selected || extra.selected,
    sendOnboardingOnComplete: Boolean(
      primary.sendOnboardingOnComplete || extra.sendOnboardingOnComplete,
    ),
  }
}

/** Collapse AI-review + final-review copies of the same person into one import row. */
export function dedupeOnboardingImportResidents(
  rows: ImportExtractedResidentRow[],
): ImportExtractedResidentRow[] {
  const merged: ImportExtractedResidentRow[] = []
  for (const row of rows) {
    const index = merged.findIndex((existing) =>
      onboardingResidentIdentityMatch(identityFromImportRow(existing), identityFromImportRow(row)),
    )
    if (index === -1) {
      merged.push(row)
      continue
    }
    const current = merged[index]
    if (!current) continue
    merged[index] = mergeImportResidentRow(current, row)
  }
  return merged
}

/** AI review checkbox is the import gate — unchecked tenants must not persist. */
export function isSelectedOnboardingExtractedResident(row: {
  selected?: boolean
}): boolean {
  return row.selected === true
}

export function onboardingResidentsToImportRows(
  residents: OnboardingResident[],
): ImportExtractedResidentRow[] {
  return dedupeOnboardingImportResidents(
    residents
      .filter((row) => asTrimmed(row.fullName))
      .map((row) => ({
        id: row.id,
        fullName: row.fullName,
        unit: row.unit,
        building: row.building,
        phone: row.phone,
        email: row.email,
        leaseStart: row.leaseStart ?? '',
        leaseEnd: row.leaseEnd ?? '',
        selected: true,
        monthlyRent: row.monthlyRent != null ? String(row.monthlyRent) : '',
        rentDueDay: row.rentDueDay != null ? String(row.rentDueDay) : '',
        occupancyStatus: row.occupancyStatus,
        maintenanceResponsibilitiesClause: row.maintenanceResponsibilitiesClause ?? '',
        sendOnboardingOnComplete: Boolean(row.sendOnboardingOnComplete),
      })),
  )
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

async function loadExistingResidents(landlordId: string): Promise<ExistingResidentRow[]> {
  if (!supabase) return []
  const primary = await supabase
    .from('users')
    .select('id, full_name, unit, building, phone')
    .eq('landlord_id', landlordId)
    .is('archived_at', null)
  if (primary.error && /archived_at|column/i.test(primary.error.message)) {
    const legacy = await supabase
      .from('users')
      .select('id, full_name, unit, building, phone')
      .eq('landlord_id', landlordId)
    if (legacy.error) {
      console.warn('[landlordOnboarding] load residents for import', legacy.error.message)
      return []
    }
    return (legacy.data ?? []) as ExistingResidentRow[]
  }
  if (primary.error) {
    console.warn('[landlordOnboarding] load residents for import', primary.error.message)
    return []
  }
  return (primary.data ?? []) as ExistingResidentRow[]
}

function findExistingResident(
  existing: ExistingResidentRow[],
  incoming: OnboardingResidentIdentity,
): ExistingResidentRow | undefined {
  if (isPersistedUserId(incoming.id)) {
    const byId = existing.find((row) => row.id === incoming.id)
    if (byId) return byId
  }
  return existing.find((row) =>
    onboardingResidentIdentityMatch(identityFromExisting(row), incoming),
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
  if (!error) return true
  if (/imported_by_|import_session_id|imported_at|column/i.test(error.message)) {
    const {
      imported_by_user_id: _u,
      imported_by_email: _e,
      import_session_id: _s,
      imported_at: _a,
      ...legacy
    } = payload
    const { error: legacyError } = await supabase
      .from('users')
      .update(legacy)
      .eq('id', existingId)
      .eq('landlord_id', landlordId)
    if (!legacyError) return true
    console.warn('[landlordOnboarding] update imported resident', legacyError.message)
    return false
  }
  console.warn('[landlordOnboarding] update imported resident', error.message)
  return false
}

async function insertImportedResident(
  landlordId: string,
  payload: Record<string, unknown>,
  startSeq: number,
): Promise<{ ok: boolean; nextSeq: number; id?: string }> {
  if (!supabase) return { ok: false, nextSeq: startSeq }

  let seq = startSeq
  let email = String(payload.email ?? '')
  let phone = (payload.phone as string | null) ?? null
  let residentId = ''
  let lastError = ''

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const mintNewId = !residentId || /resident_id/i.test(lastError)
    if (mintNewId) {
      seq += 1
      residentId = nextOnboardingResidentIdFromSequence(seq, landlordId)
    }
    const { data, error } = await supabase
      .from('users')
      .insert({
        ...payload,
        email,
        phone,
        resident_id: residentId,
        landlord_id: landlordId,
      })
      .select('id')
      .maybeSingle()
    if (!error) {
      return {
        ok: true,
        nextSeq: seq,
        id: typeof data?.id === 'string' ? data.id : undefined,
      }
    }
    lastError = error.message
    if (
      /imported_by_|import_session_id|imported_at|onboarding_session_id|archived_at|column/i.test(
        error.message,
      )
    ) {
      const {
        imported_by_user_id: _u,
        imported_by_email: _e,
        import_session_id: _s,
        imported_at: _a,
        onboarding_session_id: _session,
        archived_at: _archived,
        ...legacyPayload
      } = payload
      const { data: legacyData, error: legacyError } = await supabase
        .from('users')
        .insert({
          ...legacyPayload,
          email,
          phone,
          resident_id: residentId,
          landlord_id: landlordId,
        })
        .select('id')
        .maybeSingle()
      if (!legacyError) {
        return {
          ok: true,
          nextSeq: seq,
          id: typeof legacyData?.id === 'string' ? legacyData.id : undefined,
        }
      }
      lastError = legacyError.message
    }
    if (isUniqueViolation(error) || isUniqueViolation({ message: lastError })) {
      if (/resident_id/i.test(lastError)) continue
      if (/phone/i.test(lastError) && phone) {
        phone = null
        continue
      }
      if (/email/i.test(lastError) && !email.includes('@onboarding.local')) {
        email = `ulo.${residentId.toLowerCase()}@onboarding.local`
        continue
      }
      if (phone) {
        phone = null
        continue
      }
      if (!email.includes('@onboarding.local')) {
        email = `ulo.${residentId.toLowerCase()}@onboarding.local`
        continue
      }
    }
    console.warn('[landlordOnboarding] insert imported resident', error.message)
    return { ok: false, nextSeq: seq }
  }

  console.warn('[landlordOnboarding] insert imported resident', lastError || 'retries exhausted')
  return { ok: false, nextSeq: seq }
}

export async function importOnboardingResidentsFromExtraction(
  residents: ImportExtractedResidentRow[],
  leases: ExtractedLease[],
  landlordId: string,
  options?: {
    properties?: ImportPropertyNameRow[]
    units?: ImportUnitInventoryRow[]
    actor?: OnboardingImportActor
    onboardingSession?: OnboardingSessionStamp | null
  },
): Promise<number> {
  const selectedBeforeDedupe = residents.filter(isSelectedOnboardingExtractedResident)
  const selectedResidents = dedupeOnboardingImportResidents(selectedBeforeDedupe)
  // #region agent log
  {
    const nameCounts = new Map<string, number>()
    for (const row of selectedBeforeDedupe) {
      const key = String(row.fullName ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
      if (!key) continue
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
    }
    const dupNames = [...nameCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([name, count]) => ({ name, count }))
    fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'D',location:'importResidents.ts:importOnboardingResidentsFromExtraction',message:'extract import dedupe',data:{landlordId,beforeCount:selectedBeforeDedupe.length,afterCount:selectedResidents.length,dupNamesBefore:dupNames},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion
  const selectedLeases = leases.filter((lease) => lease.selected)
  if (selectedResidents.length === 0 || !supabase) return 0

  const actor = options?.actor ?? (await resolveOnboardingImportActor())
  const importedAt = new Date().toISOString()
  const actorColumns = importActorUserColumns(actor, importedAt)
  const session =
    options?.onboardingSession ??
    onboardingSessionFromState(readLocalOnboardingState(landlordId))
  const sessionColumns = onboardingSessionUserColumns(session)

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
    const resolvedUnit = resolveImportedResidentUnit(
      resident.unit,
      matchedLease?.unit,
      Boolean(matchedLease),
    )
    const resolvedBuilding = resolveImportResidentBuilding(
      resolvedUnit,
      asTrimmed(resident.building) || asTrimmed(matchedLease?.building) || '',
      unitInventory,
      properties,
    )
    const monthlyRent =
      parseMonthlyRentInput(String(resident.monthlyRent ?? '')) ??
      (matchedLease?.rentAmount != null ? parseMonthlyRentInput(matchedLease.rentAmount) : null)
    const rentDueDay =
      parseRentDueDayInput(String(resident.rentDueDay ?? '')) ??
      parseRentDueDayInput(String(matchedLease?.rentDueDay ?? ''))
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
      ...actorColumns,
      ...sessionColumns,
    }

    const incoming: OnboardingResidentIdentity = {
      id: resident.id,
      fullName: payload.full_name,
      unit: resolvedUnit,
      building: resolvedBuilding,
      phone: normalizedPhone,
    }
    const existingMatch = findExistingResident(existing, incoming)
    if (existingMatch) {
      let phoneForUpdate = normalizedPhone
      if (phoneForUpdate) {
        const conflictingPhone = existing.find(
          (row) =>
            row.id !== existingMatch.id &&
            asTrimmed(row.phone) === phoneForUpdate &&
            !personNamesMatch(String(row.full_name ?? ''), payload.full_name) &&
            !onboardingResidentIdentityMatch(identityFromExisting(row), incoming),
        )
        if (conflictingPhone) phoneForUpdate = null
      }

      const updated = await updateExistingResident(landlordId, existingMatch.id, {
        ...payload,
        phone: phoneForUpdate,
      })
      if (updated) {
        imported += 1
        existingMatch.full_name = payload.full_name
        existingMatch.unit = resolvedUnit
        existingMatch.building = resolvedBuilding
        existingMatch.phone = phoneForUpdate
      }
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
    if (!inserted.ok) {
      console.warn(
        '[landlordOnboarding] selected resident did not persist',
        payload.full_name,
        resolvedUnit,
        resolvedBuilding,
      )
      continue
    }

    imported += 1
    existing.push({
      id: inserted.id || `imported-${imported}`,
      full_name: payload.full_name,
      unit: resolvedUnit,
      building: resolvedBuilding,
      phone: phoneForInsert,
    })
  }

  if (imported > 0) {
    const who =
      actor.email?.trim() ||
      (actor.userId ? `user ${actor.userId.slice(0, 8)}` : 'unknown session')
    await recordActivityLog({
      landlordId,
      eventType: 'residents.imported',
      source: 'onboarding',
      actorType: 'landlord',
      actorId: actor.userId,
      metadata: {
        message:
          imported === 1
            ? `Imported 1 resident (initiated by ${who}).`
            : `Imported ${imported} residents (initiated by ${who}).`,
        count: imported,
        source: 'onboarding_import',
        ...importActorActivityMetadata(actor),
        ...onboardingSessionActivityMetadata(session),
      },
    })
  }

  return imported
}

export function mergeFastTrackReviewResidents(
  persisted: OnboardingResident[],
  extracted: ImportExtractedResidentRow[],
): OnboardingResident[] {
  const merged = [...persisted]

  for (const [index, row] of extracted.filter(isSelectedOnboardingExtractedResident).entries()) {
    const incoming = identityFromImportRow(row)
    const existingIndex = merged.findIndex((existing) =>
      onboardingResidentIdentityMatch(
        {
          id: existing.id,
          fullName: existing.fullName,
          unit: existing.unit,
          building: existing.building,
          phone: existing.phone,
        },
        incoming,
      ),
    )
    if (existingIndex >= 0) {
      const existing = merged[existingIndex]
      if (!existing) continue
      merged[existingIndex] = {
        ...existing,
        sendOnboardingOnComplete: Boolean(
          existing.sendOnboardingOnComplete || row.sendOnboardingOnComplete,
        ),
      }
      continue
    }
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
      sendOnboardingOnComplete: Boolean(row.sendOnboardingOnComplete),
    })
  }

  return merged
}
