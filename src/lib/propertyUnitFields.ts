import { getErrorMessage } from '@/lib/errorMessage'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'

export type PropertyUnitField = {
  id: string | null
  label: string
}

export type PropertyUnitFieldChange =
  | { kind: 'rename'; id: string; from: string; to: string }
  | { kind: 'add'; label: string }

type StoredUnit = {
  id: string
  label: string
  building: string | null
  propertyId: string | null
}

export function diffPropertyUnitFields(
  current: Array<{ id: string; label: string }>,
  next: PropertyUnitField[],
): { ok: true; changes: PropertyUnitFieldChange[] } | { ok: false; error: string } {
  const labels = next.map((unit) => unit.label.trim())
  if (labels.some((label) => !label)) {
    return { ok: false, error: 'Enter a name for each unit.' }
  }
  const keys = labels.map((label) => label.toLowerCase())
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: 'Each unit needs its own name.' }
  }

  const currentById = new Map(current.map((unit) => [unit.id, unit.label.trim()]))
  const changes: PropertyUnitFieldChange[] = []
  for (const unit of next) {
    const label = unit.label.trim()
    if (!unit.id) {
      changes.push({ kind: 'add', label })
      continue
    }
    const previous = currentById.get(unit.id)
    if (previous == null) {
      return { ok: false, error: 'A unit on this form is no longer on the property.' }
    }
    if (previous !== label) changes.push({ kind: 'rename', id: unit.id, from: previous, to: label })
  }
  return { ok: true, changes }
}

function placeKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Rename existing units and add new ones. Existing rows are kept when omitted. */
export async function savePropertyUnitFields(input: {
  landlordId: string
  propertyId: string
  buildingName: string
  units: PropertyUnitField[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }
  if (input.units.length === 0) return { ok: true }

  const ids = input.units.map((unit) => unit.id).filter((id): id is string => Boolean(id))
  let loaded: Record<string, unknown>[] = []
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('units')
      .select('id, unit_label, building, property_id')
      .eq('landlord_id', input.landlordId)
      .in('id', ids)
    if (error) {
      return { ok: false, error: getErrorMessage(error, "Couldn't load units for this property.") }
    }
    loaded = (data ?? []) as Record<string, unknown>[]
  }

  const stored: StoredUnit[] = loaded.map((row) => ({
    id: String(row.id),
    label: String(row.unit_label ?? '').trim(),
    building: typeof row.building === 'string' ? row.building : null,
    propertyId: typeof row.property_id === 'string' ? row.property_id : null,
  }))
  for (const unit of stored) {
    if (unit.propertyId && unit.propertyId !== input.propertyId) {
      return { ok: false, error: 'A unit on this form belongs to a different property.' }
    }
  }

  const diff = diffPropertyUnitFields(
    stored.map((unit) => ({ id: unit.id, label: unit.label })),
    input.units,
  )
  if (!diff.ok) return diff
  if (diff.changes.length === 0) return { ok: true }

  const buildingName = input.buildingName.trim()
  for (const change of diff.changes) {
    if (change.kind === 'rename') {
      const storedUnit = stored.find((unit) => unit.id === change.id)
      const { error: updateError } = await supabase
        .from('units')
        .update({
          unit_label: change.to,
          property_id: input.propertyId,
          building: buildingName || storedUnit?.building || null,
        })
        .eq('id', change.id)
        .eq('landlord_id', input.landlordId)
      if (updateError) {
        return { ok: false, error: getErrorMessage(updateError, "Couldn't save that unit.") }
      }

      const buildings = new Set(
        [buildingName, storedUnit?.building].map(placeKey).filter((value) => value && value !== 'portfolio'),
      )
      const { data: residents, error: residentLoadError } = await supabase
        .from('users')
        .select('id, building')
        .eq('landlord_id', input.landlordId)
        .eq('unit', change.from)
      if (residentLoadError) {
        return { ok: false, error: getErrorMessage(residentLoadError, "Couldn't update residents on that unit.") }
      }
      const { data: occupancy, error: occupancyError } = await supabase
        .from('occupancy')
        .select('resident_id')
        .eq('unit_id', change.id)
        .eq('status', 'active')
      if (occupancyError) {
        return { ok: false, error: getErrorMessage(occupancyError, "Couldn't update residents on that unit.") }
      }
      const residentIds = [
        ...new Set([
          ...((residents ?? []) as { id: string; building?: string | null }[])
            .filter((resident) => buildings.has(placeKey(resident.building)))
            .map((resident) => resident.id),
          ...((occupancy ?? []) as { resident_id?: string | null }[])
            .map((row) => row.resident_id)
            .filter((id): id is string => Boolean(id)),
        ]),
      ]
      if (residentIds.length > 0) {
        const { error: residentError } = await supabase
          .from('users')
          .update({ unit: change.to })
          .in('id', residentIds)
          .eq('landlord_id', input.landlordId)
        if (residentError) {
          return { ok: false, error: getErrorMessage(residentError, "Couldn't update residents on that unit.") }
        }
      }

      const { error: ticketError } = await supabase
        .from('maintenance_requests')
        .update({ unit: change.to })
        .eq('landlord_id', input.landlordId)
        .eq('unit_id', change.id)
      if (ticketError) {
        return { ok: false, error: getErrorMessage(ticketError, "Couldn't update work orders on that unit.") }
      }

      await recordActivityLog({
        landlordId: input.landlordId,
        eventType: 'unit.renamed',
        source: 'dashboard',
        actorType: 'landlord',
        propertyId: input.propertyId,
        unitId: change.id,
        metadata: {
          message: `Unit ${change.from} at ${buildingName || 'this property'} is now ${change.to}.`,
        },
      })
      continue
    }

    const { data: inserted, error: insertError } = await supabase
      .from('units')
      .insert({
        landlord_id: input.landlordId,
        unit_label: change.label,
        building: buildingName || null,
        property_id: input.propertyId,
        status: 'vacant',
      })
      .select('id')
      .maybeSingle()
    if (insertError) {
      return { ok: false, error: getErrorMessage(insertError, "Couldn't add that unit.") }
    }
    await recordActivityLog({
      landlordId: input.landlordId,
      eventType: 'unit.added',
      source: 'dashboard',
      actorType: 'landlord',
      propertyId: input.propertyId,
      unitId: inserted?.id ? String(inserted.id) : null,
      metadata: {
        message: `Unit ${change.label} was added to ${buildingName || 'this property'}.`,
      },
    })
  }

  return { ok: true }
}
