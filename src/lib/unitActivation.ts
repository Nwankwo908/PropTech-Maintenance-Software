import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Unit activation — general rule
 *
 * A unit becomes `active` when either:
 * 1. Onboarding / roster: a tenant is assigned to the unit with lease dates, or
 * 2. Admin: unit status is changed from vacant/inactive to occupied/active
 *    (tenant registration may be skipped).
 *
 * Admin chip values persist on `units.status` until changed again.
 * See `.cursor/rules/unit-activation.mdc`.
 */

import { activateUnit, markUnitVacant } from '@/api/unitVacancy'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { extractedPlacesOverlap } from '@/lib/onboarding/persist/properties'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import type { PropertyUnitOccupancyStatus } from '@/lib/propertyUnitRows'
import {
  normalizeResidentOccupancyStatus,
  residentOccupancyLabel,
  residentOccupancyOccupiesUnit,
} from '@/lib/residentOccupancy'
import { supabase } from '@/lib/supabase'

const OCCUPYING_RESIDENT_STATUSES = new Set(['active', 'pending', 'suspended'])
const propertySyncCompleted = new Set<string>()

export type UnitActivationResident = {
  id: string
  unit: string | null | undefined
  building: string | null | undefined
  status?: string | null
  /** Tenant SMS onboarding: `activated` after YES/START. */
  activationStatus?: string | null
  moveInDate?: string | null
  leaseEndDate?: string | null
  /** Onboarding form aliases */
  leaseStart?: string | null
  leaseEnd?: string | null
  /** Canonical occupancy / SMS identity unit id when known. */
  occupancyUnitId?: string | null
  identityUnitId?: string | null
}

export function residentHasLeaseDatesForActivation(resident: UnitActivationResident): boolean {
  const moveIn = (resident.moveInDate ?? resident.leaseStart ?? '').trim()
  const leaseEnd = (resident.leaseEndDate ?? resident.leaseEnd ?? '').trim()
  return Boolean(moveIn && leaseEnd)
}

export function residentQualifiesForUnitActivation(resident: UnitActivationResident): boolean {
  const unit = (resident.unit ?? '').trim()
  const hasCanonicalUnit = Boolean(
    resident.occupancyUnitId?.trim() || resident.identityUnitId?.trim(),
  )
  if (!unit && !hasCanonicalUnit) return false
  const status = (resident.status ?? 'active').trim().toLowerCase()
  if (status === 'past_resident') return false
  // Occupied / Suspended is an explicit occupancy choice (onboarding dropdown, edit resident).
  if (residentOccupancyOccupiesUnit(status)) return true
  // Tenant SMS YES/START still occupies even when the roster status is pending move-in.
  return (resident.activationStatus ?? '').trim().toLowerCase() === 'activated'
}

export function unitBuildingsCompatibleForActivation(
  unitBuilding: string | null | undefined,
  residentBuilding: string | null | undefined,
): boolean {
  const resident = (residentBuilding ?? '').trim()
  if (!resident) return true
  const unit = (unitBuilding ?? '').trim()
  if (!unit) return true
  if (normalizeBuildingKey(unit) === normalizeBuildingKey(resident)) return true
  return extractedPlacesOverlap(unit, resident)
}

export function findInventoryUnitForResident<
  T extends { unitLabel: string; building: string | null },
>(units: T[], resident: Pick<UnitActivationResident, 'unit' | 'building'>): T | undefined {
  const unitKey = normalizeUnitLabel(resident.unit ?? '')
  if (!unitKey) return undefined
  const labelMatches = units.filter((row) => normalizeUnitLabel(row.unitLabel) === unitKey)
  if (labelMatches.length === 0) return undefined

  const compatible = labelMatches.filter((row) =>
    unitBuildingsCompatibleForActivation(row.building, resident.building),
  )
  if (compatible.length === 1) return compatible[0]
  if (compatible.length > 1) {
    const exact = compatible.find(
      (row) =>
        normalizeBuildingKey(row.building) === normalizeBuildingKey(resident.building ?? ''),
    )
    return exact ?? compatible[0]
  }
  return undefined
}

/** Prefer occupancy / identity unit id; fall back to label match. Never inserts. */
export function pickCanonicalUnitForResident<
  T extends { id: string; unitLabel: string; building: string | null },
>(
  units: T[],
  resident: Pick<
    UnitActivationResident,
    'unit' | 'building' | 'occupancyUnitId' | 'identityUnitId'
  >,
): T | undefined {
  const occupancyId = resident.occupancyUnitId?.trim()
  if (occupancyId) {
    const match = units.find((row) => row.id === occupancyId)
    if (match) return match
  }
  const identityId = resident.identityUnitId?.trim()
  if (identityId) {
    const match = units.find((row) => row.id === identityId)
    if (match) return match
  }
  return findInventoryUnitForResident(units, resident)
}

function unitMatchesResident(
  unitLabel: string,
  unitBuilding: string | null,
  resident: UnitActivationResident,
): boolean {
  return Boolean(
    findInventoryUnitForResident(
      [{ unitLabel, building: unitBuilding }],
      resident,
    ),
  )
}

async function ensureOccupancy(params: {
  landlordId: string
  unitId: string
  residentId: string
  moveInDate: string
}): Promise<void> {
  if (!supabase) return

  const { data: existing } = await supabase
    .from('occupancy')
    .select('id')
    .eq('unit_id', params.unitId)
    .eq('status', 'active')
    .maybeSingle()

  if (existing?.id) return

  const { error } = await supabase.from('occupancy').insert({
    landlord_id: params.landlordId,
    unit_id: params.unitId,
    resident_id: params.residentId,
    move_in_date: params.moveInDate,
    status: 'active',
  })
  if (error) {
    console.warn('[unitActivation] occupancy insert', error.message)
  }
}

async function logUnitActivated(params: {
  landlordId: string
  unitId: string
  residentId: string | null
  unitLabel: string
  building: string | null
  source: string
  moveInDate: string | null
}): Promise<void> {
  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  await recordActivityLog({
    landlordId: params.landlordId,
    eventType: 'unit.activated',
    source: params.source,
    actorType: 'landlord',
    unitId: params.unitId,
    residentId: params.residentId,
    metadata: {
      unit_label: params.unitLabel,
      building: params.building,
      move_in_date: params.moveInDate,
      activation_path: params.source,
      message: `Unit ${params.unitLabel} is occupied`,
    },
  })
}

async function logUnitVacated(params: {
  landlordId: string
  unitId: string
  residentId: string | null
  unitLabel: string
  building: string | null
  source: string
}): Promise<void> {
  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  await recordActivityLog({
    landlordId: params.landlordId,
    eventType: 'move_out.unit_vacated',
    source: params.source,
    actorType: 'landlord',
    unitId: params.unitId,
    residentId: params.residentId,
    metadata: {
      unit_label: params.unitLabel,
      building: params.building,
      activation_path: params.source,
      message: `Unit ${params.unitLabel} marked vacant`,
    },
  })
}

async function logResidentOccupancyUpdated(params: {
  landlordId: string
  residentId: string
  unitId: string | null
  residentName: string | null
  occupancyLabel: string
  source: string
}): Promise<void> {
  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  const who = params.residentName?.trim() || 'Resident'
  await recordActivityLog({
    landlordId: params.landlordId,
    eventType: 'resident.occupancy_updated',
    source: params.source,
    actorType: 'landlord',
    unitId: params.unitId,
    residentId: params.residentId,
    metadata: {
      occupancy_label: params.occupancyLabel,
      message: `${who} occupancy set to ${params.occupancyLabel}`,
    },
  })
}

async function linkAssignedResidentOnActivate(params: {
  landlordId: string
  unitId: string
  unitLabel: string
  building: string | null
}): Promise<void> {
  if (!supabase || !params.unitLabel.trim()) return

  const { data, error } = await supabase
    .from('users')
    .select('id, status, move_in_date, lease_end_date, unit, building')
    .eq('landlord_id', params.landlordId)

  if (error) {
    console.warn('[unitActivation] link resident lookup', error.message)
    return
  }

  const rows = (data ?? []) as Array<{
    id: string
    status: string
    move_in_date: string | null
    lease_end_date: string | null
    unit: string | null
    building: string | null
  }>

  let matches = rows.filter((row) =>
    unitMatchesResident(params.unitLabel, params.building, {
      id: row.id,
      unit: row.unit,
      building: row.building,
      status: row.status,
    }),
  )

  // Onboarding label drift: resident on "1" while inventory unit is "101".
  // Rematch only when the building has exactly one orphan resident and this unit
  // is the only active unit still missing a roster match.
  if (matches.length === 0 && params.building?.trim()) {
    const { data: unitRows } = await supabase
      .from('units')
      .select('id, unit_label, building, status')
      .eq('landlord_id', params.landlordId)

    const buildingUnits = (
      (unitRows ?? []) as Array<{
        id: string
        unit_label: string
        building: string | null
        status: string
      }>
    ).filter(
      (row) => normalizeBuildingKey(row.building) === normalizeBuildingKey(params.building),
    )

    const inventoryLabels = new Set(
      buildingUnits.map((row) => normalizeUnitLabel(row.unit_label)),
    )

    const orphans = rows.filter((row) => {
      if (normalizeBuildingKey(row.building) !== normalizeBuildingKey(params.building)) {
        return false
      }
      const key = normalizeUnitLabel(row.unit ?? '')
      return Boolean(key) && !inventoryLabels.has(key)
    })

    const unmatchedActiveUnits = buildingUnits.filter((unit) => {
      if (unit.status !== 'active' && unit.id !== params.unitId) return false
      return !rows.some((row) =>
        unitMatchesResident(unit.unit_label, unit.building, {
          id: row.id,
          unit: row.unit,
          building: row.building,
          status: row.status,
        }),
      )
    })

    const canRematch =
      orphans.length === 1 &&
      unmatchedActiveUnits.length === 1 &&
      unmatchedActiveUnits[0]?.id === params.unitId

    if (canRematch) {
      matches = orphans
      const orphan = orphans[0]!
      const { error: rematchError } = await supabase
        .from('users')
        .update({
          unit: params.unitLabel,
          building: params.building,
          status: OCCUPYING_RESIDENT_STATUSES.has(String(orphan.status ?? '').toLowerCase())
            ? orphan.status
            : 'active',
        })
        .eq('id', orphan.id)
      if (rematchError) {
        console.warn('[unitActivation] rematch orphan resident unit', rematchError.message)
      } else {
        orphan.unit = params.unitLabel
        orphan.building = params.building
      }
    }
  }

  const resident =
    matches.find((row) =>
      OCCUPYING_RESIDENT_STATUSES.has(String(row.status ?? '').toLowerCase()),
    ) ??
    matches[0] ??
    null

  if (!resident) return

  if (!OCCUPYING_RESIDENT_STATUSES.has(String(resident.status ?? '').toLowerCase())) {
    const { error: statusError } = await supabase
      .from('users')
      .update({ status: 'active' })
      .eq('id', resident.id)
    if (statusError) {
      console.warn('[unitActivation] restore resident status', statusError.message)
    }
  }

  // Keep roster unit label aligned with inventory so Units tab columns resolve.
  if (normalizeUnitLabel(resident.unit ?? '') !== normalizeUnitLabel(params.unitLabel)) {
    const { error: unitAlignError } = await supabase
      .from('users')
      .update({
        unit: params.unitLabel,
        building: params.building,
      })
      .eq('id', resident.id)
    if (unitAlignError) {
      console.warn('[unitActivation] align resident unit label', unitAlignError.message)
    }
  }

  const moveIn =
    String(resident.move_in_date ?? '').trim() || new Date().toISOString().slice(0, 10)
  await ensureOccupancy({
    landlordId: params.landlordId,
    unitId: params.unitId,
    residentId: resident.id,
    moveInDate: moveIn,
  })
}

/**
 * Heal active units that already have an orphaned same-building resident
 * (unit label drift from onboarding). Safe/no-op when the match is ambiguous.
 */
export async function reconcileOccupiedUnitResidents(params?: {
  landlordId?: string
}): Promise<{ rematched: number }> {
  if (!supabase) return { rematched: 0 }
  const landlordId = params?.landlordId?.trim() || getActiveLandlordId()

  const [{ data: units }, { data: residents }] = await Promise.all([
    supabase
      .from('units')
      .select('id, unit_label, building, status')
      .eq('landlord_id', landlordId)
      .eq('status', 'active'),
    supabase
      .from('users')
      .select('id, unit, building, status, move_in_date')
      .eq('landlord_id', landlordId),
  ])

  const unitRows = (units ?? []) as Array<{
    id: string
    unit_label: string
    building: string | null
    status: string
  }>
  const residentRows = (residents ?? []) as Array<{
    id: string
    unit: string | null
    building: string | null
    status: string
    move_in_date: string | null
  }>

  let rematched = 0
  for (const unit of unitRows) {
    const hasExact = residentRows.some((row) =>
      unitMatchesResident(unit.unit_label, unit.building, {
        id: row.id,
        unit: row.unit,
        building: row.building,
        status: row.status,
      }),
    )
    if (hasExact) {
      const exact = residentRows.find((row) =>
        unitMatchesResident(unit.unit_label, unit.building, {
          id: row.id,
          unit: row.unit,
          building: row.building,
          status: row.status,
        }),
      )
      if (exact) {
        await ensureOccupancy({
          landlordId,
          unitId: unit.id,
          residentId: exact.id,
          moveInDate:
            String(exact.move_in_date ?? '').trim() ||
            new Date().toISOString().slice(0, 10),
        })
      }
      continue
    }

    const before = residentRows.find((row) =>
      unitMatchesResident(unit.unit_label, unit.building, {
        id: row.id,
        unit: row.unit,
        building: row.building,
        status: row.status,
      }),
    )
    await linkAssignedResidentOnActivate({
      landlordId,
      unitId: unit.id,
      unitLabel: unit.unit_label,
      building: unit.building,
    })
    // Refresh local resident labels after possible rematch for subsequent units.
    const { data: refreshed } = await supabase
      .from('users')
      .select('id, unit, building, status, move_in_date')
      .eq('landlord_id', landlordId)
    if (refreshed) {
      residentRows.length = 0
      residentRows.push(
        ...(refreshed as Array<{
          id: string
          unit: string | null
          building: string | null
          status: string
          move_in_date: string | null
        }>),
      )
    }
    const after = residentRows.find((row) =>
      unitMatchesResident(unit.unit_label, unit.building, {
        id: row.id,
        unit: row.unit,
        building: row.building,
        status: row.status,
      }),
    )
    if (!before && after) rematched += 1
  }

  return { rematched }
}

/**
 * Activate inventory units that already have a qualified tenant (unit + lease dates).
 * Idempotent — skips units that are already active.
 */
export async function activateUnitsFromResidentAssignments(params?: {
  landlordId?: string
  residents?: UnitActivationResident[]
  source?: string
}): Promise<{ activated: number; errors: string[] }> {
  if (!supabase) return { activated: 0, errors: ['We can\'t reach the server right now. Please try again in a moment.'] }

  const landlordId = params?.landlordId?.trim() || getActiveLandlordId()
  const source = params?.source ?? 'resident_assignment'
  const errors: string[] = []

  if (source === 'property_sync' && propertySyncCompleted.has(landlordId)) {
    return { activated: 0, errors: [] }
  }

  if (source === 'property_sync' && supabase) {
    const { count, error: inactiveError } = await supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId)
      .eq('status', 'inactive')
    if (!inactiveError && (count ?? 0) === 0) {
      propertySyncCompleted.add(landlordId)
      return { activated: 0, errors: [] }
    }
  }

  let residents = params?.residents
  if (!residents) {
    const selectWithActivation =
      'id, unit, building, status, move_in_date, lease_end_date, activation_status'
    const selectLegacy = 'id, unit, building, status, move_in_date, lease_end_date'
    let data: unknown[] | null = null
    let error: { message: string } | null = null
    const primary = await supabase
      .from('users')
      .select(selectWithActivation)
      .eq('landlord_id', landlordId)
    if (primary.error && /column .* does not exist/i.test(primary.error.message)) {
      const legacy = await supabase
        .from('users')
        .select(selectLegacy)
        .eq('landlord_id', landlordId)
      data = (legacy.data as unknown[] | null) ?? null
      error = legacy.error
    } else {
      data = (primary.data as unknown[] | null) ?? null
      error = primary.error
    }
    if (error) {
      return { activated: 0, errors: [error.message] }
    }
    residents = (data ?? []).map((row) => {
      const record = row as {
        id: string
        unit?: string | null
        building?: string | null
        status?: string | null
        activation_status?: string | null
        move_in_date?: string | null
        lease_end_date?: string | null
      }
      return {
        id: String(record.id),
        unit: String(record.unit ?? ''),
        building: String(record.building ?? ''),
        status: String(record.status ?? ''),
        activationStatus: String(record.activation_status ?? '') || null,
        moveInDate: String(record.move_in_date ?? '') || null,
        leaseEndDate: String(record.lease_end_date ?? '') || null,
      }
    })
  }

  const qualified = residents.filter(residentQualifiesForUnitActivation)
  if (residents.length === 0) return { activated: 0, errors: [] }

  const { data: unitRows, error: unitsError } = await supabase
    .from('units')
    .select('id, unit_label, building, status, property_id')
    .eq('landlord_id', landlordId)

  if (unitsError) {
    return { activated: 0, errors: [unitsError.message] }
  }

  const occupancyByResident = new Map<string, string>()
  const identityByResident = new Map<string, string>()
  const lookupIds = residents.map((row) => row.id)
  const [{ data: occupancyRows }, { data: identityRows }] = await Promise.all([
    supabase
      .from('occupancy')
      .select('resident_id, unit_id')
      .eq('landlord_id', landlordId)
      .eq('status', 'active')
      .in('resident_id', lookupIds),
    supabase
      .from('sms_identities')
      .select('resident_id, unit_id')
      .eq('landlord_id', landlordId)
      .in('resident_id', lookupIds),
  ])
  for (const row of occupancyRows ?? []) {
    const residentId = String((row as { resident_id?: string }).resident_id ?? '')
    const unitId = String((row as { unit_id?: string }).unit_id ?? '')
    if (residentId && unitId && !occupancyByResident.has(residentId)) {
      occupancyByResident.set(residentId, unitId)
    }
  }
  for (const row of identityRows ?? []) {
    const residentId = String((row as { resident_id?: string }).resident_id ?? '')
    const unitId = String((row as { unit_id?: string }).unit_id ?? '')
    if (residentId && unitId && !identityByResident.has(residentId)) {
      identityByResident.set(residentId, unitId)
    }
  }

  const units = (unitRows ?? []) as Array<{
    id: string
    unit_label: string
    building: string | null
    status: string
  }>

  let activated = 0
  const touchedUnitIds = new Set<string>()

  for (const resident of qualified) {
    const unit = pickCanonicalUnitForResident(
      units.map((row) => ({
        id: row.id,
        unitLabel: row.unit_label,
        building: row.building,
        status: row.status,
      })),
      {
        ...resident,
        occupancyUnitId: resident.occupancyUnitId ?? occupancyByResident.get(resident.id) ?? null,
        identityUnitId: resident.identityUnitId ?? identityByResident.get(resident.id) ?? null,
      },
    )
    if (!unit || touchedUnitIds.has(unit.id)) continue
    if (unit.status === 'active') {
      const moveIn =
        (resident.moveInDate ?? resident.leaseStart ?? '').trim() ||
        new Date().toISOString().slice(0, 10)
      await ensureOccupancy({
        landlordId,
        unitId: unit.id,
        residentId: resident.id,
        moveInDate: moveIn,
      })
      touchedUnitIds.add(unit.id)
      continue
    }

    // Property sync must not overwrite an admin Vacant / Under maintenance chip.
    // Onboarding Occupied (and edit resident) should occupy the assigned unit.
    if (
      source === 'property_sync' &&
      (unit.status === 'vacant' || unit.status === 'under_maintenance')
    ) {
      continue
    }

    const { error: updateError } = await supabase
      .from('units')
      .update({
        status: 'active',
        skip_tenant_registration: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', unit.id)
      .eq('landlord_id', landlordId)

    if (updateError) {
      errors.push(`${unit.unit_label}: ${updateError.message}`)
      continue
    }

    const moveIn =
      (resident.moveInDate ?? resident.leaseStart ?? '').trim() ||
      new Date().toISOString().slice(0, 10)
    await ensureOccupancy({
      landlordId,
      unitId: unit.id,
      residentId: resident.id,
      moveInDate: moveIn,
    })
    await logUnitActivated({
      landlordId,
      unitId: unit.id,
      residentId: resident.id,
      unitLabel: unit.unit_label,
      building: unit.building,
      source,
      moveInDate: moveIn,
    })

    unit.status = 'active'
    touchedUnitIds.add(unit.id)
    activated += 1
  }

  const occupyingUnitIds = new Set(touchedUnitIds)
  if (source !== 'property_sync') {
    for (const resident of residents) {
      const occupancy = normalizeResidentOccupancyStatus(resident.status)
      if (occupancy !== 'past_resident' && occupancy !== 'pending') continue
      const unit = pickCanonicalUnitForResident(
        units.map((row) => ({
          id: row.id,
          unitLabel: row.unit_label,
          building: row.building,
          status: row.status,
        })),
        {
          ...resident,
          occupancyUnitId: resident.occupancyUnitId ?? occupancyByResident.get(resident.id) ?? null,
          identityUnitId: resident.identityUnitId ?? identityByResident.get(resident.id) ?? null,
        },
      )
      if (!unit || occupyingUnitIds.has(unit.id)) continue
      if (unit.status === 'vacant' || unit.status === 'under_maintenance') continue
      if (unit.status === 'inactive' && occupancy === 'pending') continue

      const vacated = await setUnitStatusDirect({
        unitId: unit.id,
        landlordId,
        status: 'vacant',
        source,
        residentId: resident.id,
      })
      if (!vacated.ok) {
        errors.push(`${unit.unit_label}: ${vacated.error}`)
        continue
      }
      unit.status = 'vacant'
      occupyingUnitIds.add(unit.id)
    }
  }

  if (source === 'property_sync') {
    propertySyncCompleted.add(landlordId)
  }

  return { activated, errors }
}

async function setUnitStatusDirect(params: {
  unitId: string
  landlordId: string
  status: 'active' | 'vacant' | 'under_maintenance'
  skipTenantRegistration?: boolean
  source?: string
  residentId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }

  const { data, error } = await supabase
    .from('units')
    .update({
      status: params.status,
      skip_tenant_registration: params.skipTenantRegistration ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.unitId)
    .eq('landlord_id', params.landlordId)
    .select('id, unit_label, building')
    .maybeSingle()

  if (error) return { ok: false, error: getErrorMessage(error, 'Something went wrong. Please try again.') }
  if (!data?.id) return { ok: false, error: 'Unit not found.' }

  const unitLabel = String((data as { unit_label?: string }).unit_label ?? '')
  const building = ((data as { building?: string | null }).building ?? null) as string | null
  const source = params.source ?? 'admin_status_chip'

  if (params.status === 'active') {
    await linkAssignedResidentOnActivate({
      landlordId: params.landlordId,
      unitId: String(data.id),
      unitLabel,
      building,
    })
    await logUnitActivated({
      landlordId: params.landlordId,
      unitId: String(data.id),
      residentId: params.residentId ?? null,
      unitLabel,
      building,
      source,
      moveInDate: null,
    })
  }

  if (params.status === 'vacant') {
    await logUnitVacated({
      landlordId: params.landlordId,
      unitId: String(data.id),
      residentId: params.residentId ?? null,
      unitLabel,
      building,
      source,
    })
  }

  return { ok: true }
}

/**
 * Persist roster occupancy onto the assigned unit so Residents, the property
 * Units chip, and the operations graph stay in sync.
 */
export async function syncAssignedUnitOccupancyFromResidentStatus(params: {
  landlordId?: string
  residentId: string
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
  status: string
  residentName?: string | null
  source?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  const occupancy = normalizeResidentOccupancyStatus(params.status)
  const source = params.source ?? 'resident_occupancy'
  const occupancyLabel = residentOccupancyLabel(occupancy)

  let unitId = params.unitId?.trim() || ''
  if (!unitId && supabase) {
    const { data } = await supabase
      .from('units')
      .select('id, unit_label, building, status')
      .eq('landlord_id', landlordId)
    const match = pickCanonicalUnitForResident(
      ((data ?? []) as Array<{
        id: string
        unit_label: string
        building: string | null
        status: string
      }>).map((row) => ({
        id: row.id,
        unitLabel: row.unit_label,
        building: row.building,
        status: row.status,
      })),
      {
        id: params.residentId,
        unit: params.unitLabel,
        building: params.building,
        occupancyUnitId: params.unitId,
      },
    )
    unitId = match?.id ?? ''
  }

  if (unitId) {
    if (residentOccupancyOccupiesUnit(occupancy)) {
      const result = await applyAdminUnitOccupancyStatus({
        unitId,
        status: 'occupied',
        landlordId,
      })
      if (!result.ok) return result
    } else if (occupancy === 'past_resident') {
      const result = await applyAdminUnitOccupancyStatus({
        unitId,
        status: 'vacant',
        landlordId,
      })
      if (!result.ok) return result
    } else {
      const result = await setUnitStatusDirect({
        unitId,
        landlordId,
        status: 'vacant',
        source,
        residentId: params.residentId,
      })
      if (!result.ok) return result
    }
  }

  await logResidentOccupancyUpdated({
    landlordId,
    residentId: params.residentId,
    unitId: unitId || null,
    residentName: params.residentName ?? null,
    occupancyLabel,
    source,
  })
  return { ok: true }
}

/**
 * Admin status chip: persist Occupied / Vacant / Under maintenance on `units.status`
 * until the admin changes it again. Occupied also links any resident already on the unit.
 */
export async function applyAdminUnitOccupancyStatus(params: {
  unitId: string
  status: PropertyUnitOccupancyStatus
  landlordId?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const landlordId = params.landlordId?.trim() || getActiveLandlordId()

  if (params.status === 'occupied') {
    const viaEdge = await activateUnit({
      unitId: params.unitId,
      landlordId,
      skipTenantRegistration: true,
    })
    if (viaEdge.ok) {
      if (supabase) {
        const { data } = await supabase
          .from('units')
          .select('unit_label, building')
          .eq('id', params.unitId)
          .maybeSingle()
        await linkAssignedResidentOnActivate({
          landlordId,
          unitId: params.unitId,
          unitLabel: String((data as { unit_label?: string } | null)?.unit_label ?? ''),
          building: ((data as { building?: string | null } | null)?.building ?? null) as
            | string
            | null,
        })
      }
      return { ok: true }
    }

    // Fallback when admin edge secret is missing — still persist active status.
    return setUnitStatusDirect({
      unitId: params.unitId,
      landlordId,
      status: 'active',
      skipTenantRegistration: true,
    })
  }

  if (params.status === 'under_maintenance') {
    return setUnitStatusDirect({
      unitId: params.unitId,
      landlordId,
      status: 'under_maintenance',
    })
  }

  const result = await markUnitVacant({
    unitId: params.unitId,
    landlordId,
  })
  if (result.ok) return { ok: true }

  return setUnitStatusDirect({
    unitId: params.unitId,
    landlordId,
    status: 'vacant',
  })
}
