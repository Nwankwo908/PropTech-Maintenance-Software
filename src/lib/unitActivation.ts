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
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import type { PropertyUnitOccupancyStatus } from '@/lib/propertyUnitRows'
import { supabase } from '@/lib/supabase'

const OCCUPYING_RESIDENT_STATUSES = new Set(['active', 'pending', 'suspended'])

export type UnitActivationResident = {
  id: string
  unit: string | null | undefined
  building: string | null | undefined
  status?: string | null
  moveInDate?: string | null
  leaseEndDate?: string | null
  /** Onboarding form aliases */
  leaseStart?: string | null
  leaseEnd?: string | null
}

export function residentHasLeaseDatesForActivation(resident: UnitActivationResident): boolean {
  const moveIn = (resident.moveInDate ?? resident.leaseStart ?? '').trim()
  const leaseEnd = (resident.leaseEndDate ?? resident.leaseEnd ?? '').trim()
  return Boolean(moveIn && leaseEnd)
}

export function residentQualifiesForUnitActivation(resident: UnitActivationResident): boolean {
  const unit = (resident.unit ?? '').trim()
  if (!unit) return false
  if (!residentHasLeaseDatesForActivation(resident)) return false
  const status = (resident.status ?? 'active').trim().toLowerCase()
  if (status && !OCCUPYING_RESIDENT_STATUSES.has(status)) return false
  return true
}

function unitMatchesResident(
  unitLabel: string,
  unitBuilding: string | null,
  resident: UnitActivationResident,
): boolean {
  if (normalizeUnitLabel(unitLabel) !== normalizeUnitLabel(resident.unit ?? '')) return false
  const residentBuilding = (resident.building ?? '').trim()
  if (!residentBuilding) return true
  return normalizeBuildingKey(unitBuilding) === normalizeBuildingKey(residentBuilding)
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
      message: `Unit ${params.unitLabel} activated`,
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

  let residents = params?.residents
  if (!residents) {
    const { data, error } = await supabase
      .from('users')
      .select('id, unit, building, status, move_in_date, lease_end_date')
      .eq('landlord_id', landlordId)
    if (error) {
      return { activated: 0, errors: [error.message] }
    }
    residents = (data ?? []).map((row) => ({
      id: String((row as { id: string }).id),
      unit: String((row as { unit?: string | null }).unit ?? ''),
      building: String((row as { building?: string | null }).building ?? ''),
      status: String((row as { status?: string | null }).status ?? ''),
      moveInDate: String((row as { move_in_date?: string | null }).move_in_date ?? '') || null,
      leaseEndDate: String((row as { lease_end_date?: string | null }).lease_end_date ?? '') || null,
    }))
  }

  const qualified = residents.filter(residentQualifiesForUnitActivation)
  if (qualified.length === 0) return { activated: 0, errors: [] }

  const { data: unitRows, error: unitsError } = await supabase
    .from('units')
    .select('id, unit_label, building, status')
    .eq('landlord_id', landlordId)

  if (unitsError) {
    return { activated: 0, errors: [unitsError.message] }
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
    const unit = units.find((row) =>
      unitMatchesResident(row.unit_label, row.building, resident),
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
      continue
    }

    // Respect admin chip choices — only auto-activate pending-setup (inactive) units.
    if (unit.status === 'vacant' || unit.status === 'under_maintenance') continue

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

  return { activated, errors }
}

async function setUnitStatusDirect(params: {
  unitId: string
  landlordId: string
  status: 'active' | 'vacant' | 'under_maintenance'
  skipTenantRegistration?: boolean
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

  if (params.status === 'active') {
    await linkAssignedResidentOnActivate({
      landlordId: params.landlordId,
      unitId: String(data.id),
      unitLabel: String((data as { unit_label?: string }).unit_label ?? ''),
      building: ((data as { building?: string | null }).building ?? null) as string | null,
    })
    await logUnitActivated({
      landlordId: params.landlordId,
      unitId: String(data.id),
      residentId: null,
      unitLabel: String((data as { unit_label?: string }).unit_label ?? ''),
      building: ((data as { building?: string | null }).building ?? null) as string | null,
      source: 'admin_status_chip',
      moveInDate: null,
    })
  }

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
