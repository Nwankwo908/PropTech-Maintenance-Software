import { customUnitPickKey, unitOptionKeyToCell } from '@/lib/residentUnitKeys'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { formatPropertyUnitDisplay } from '@/lib/propertyUnitRows'

type PropertyUnitOption = {
  id?: string
  unitLabel: string
  building: string | null
}

type PropertyResidentOption = {
  id: string
  unit: string
  building: string | null
  status: string
}

/** Vacant units in one property plus the resident's current assignment (for reassignment). */
export function buildPropertyResidentUnitOptions(input: {
  building: string
  units: PropertyUnitOption[]
  residents: PropertyResidentOption[]
  editingResidentId: string | null
}): { value: string; label: string }[] {
  const buildingKey = normalizeBuildingKey(input.building)
  const occupiedByUnit = new Map<string, string>()

  for (const resident of input.residents) {
    if (resident.status === 'past_resident') continue
    if (normalizeBuildingKey(resident.building) !== buildingKey) continue
    const unitKey = normalizeUnitLabel(resident.unit)
    if (unitKey) occupiedByUnit.set(unitKey, resident.id)
  }

  const options: { value: string; label: string }[] = [{ value: '', label: 'Unassigned' }]

  for (const unit of input.units) {
    if (normalizeBuildingKey(unit.building) !== buildingKey) continue
    const unitLabel = unit.unitLabel.trim()
    if (!unitLabel) continue

    const unitKey = normalizeUnitLabel(unitLabel)
    const occupantId = occupiedByUnit.get(unitKey)
    if (occupantId && occupantId !== input.editingResidentId) continue

    const inventoryBuilding = (unit.building ?? '').trim() || input.building
    const pickKey = customUnitPickKey(unitLabel, inventoryBuilding)
    const isCurrent = occupantId === input.editingResidentId
    options.push({
      value: pickKey,
      label: isCurrent
        ? `${formatPropertyUnitDisplay(unitLabel)} (current)`
        : formatPropertyUnitDisplay(unitLabel),
    })
  }

  const editing = input.residents.find((resident) => resident.id === input.editingResidentId)
  if (editing?.unit.trim()) {
    const resolved = resolveInventoryUnitForResidentSave(input.units, {
      unit: editing.unit,
      building: (editing.building ?? '').trim() || input.building,
    })
    const currentKey = customUnitPickKey(resolved.unitLabel, resolved.building)
    if (currentKey && !options.some((option) => option.value === currentKey)) {
      options.push({
        value: currentKey,
        label: `${formatPropertyUnitDisplay(resolved.unitLabel)} (current)`,
      })
    }
  }

  return options.sort((a, b) => {
    if (!a.value) return -1
    if (!b.value) return 1
    return a.label.localeCompare(b.label, undefined, { numeric: true })
  })
}

export function initialUnitOptionKeyForResident(
  unit: string,
  building: string,
  units?: PropertyUnitOption[],
): string {
  if (!unit.trim()) return ''
  if (units?.length) {
    const resolved = resolveInventoryUnitForResidentSave(units, { unit, building })
    return customUnitPickKey(resolved.unitLabel, resolved.building)
  }
  return customUnitPickKey(unit.trim(), building)
}

/** Map a resident assignment onto an existing inventory row. Never invents a new unit. */
export function resolveInventoryUnitForResidentSave(
  units: PropertyUnitOption[],
  assigned: { unit: string; building: string },
): { unitLabel: string; building: string; unitId: string | null } {
  const unitKey = normalizeUnitLabel(assigned.unit)
  const buildingKey = normalizeBuildingKey(assigned.building)

  const exact = units.find(
    (row) =>
      normalizeUnitLabel(row.unitLabel) === unitKey &&
      normalizeBuildingKey(row.building) === buildingKey,
  )
  if (exact) {
    return {
      unitLabel: exact.unitLabel.trim(),
      building: (exact.building ?? '').trim() || assigned.building,
      unitId: exact.id?.trim() || null,
    }
  }

  const byLabel = units.filter((row) => normalizeUnitLabel(row.unitLabel) === unitKey)
  if (byLabel.length === 1) {
    const match = byLabel[0]!
    return {
      unitLabel: match.unitLabel.trim(),
      building: (match.building ?? '').trim() || assigned.building,
      unitId: match.id?.trim() || null,
    }
  }

  return {
    unitLabel: assigned.unit.trim(),
    building: assigned.building.trim(),
    unitId: null,
  }
}

/**
 * Contact-only saves must not rewrite unit/building. `undefined` means omit those columns.
 */
export function residentPlacementUpdateForSave(input: {
  unitAssignmentChanged: boolean
  submittedUnitKey: string
  previousUnit: string
  previousBuilding: string
  units: PropertyUnitOption[]
  fallbackBuilding?: string
}): { unit: string | null; building: string | null } | undefined {
  if (!input.unitAssignmentChanged) return undefined

  const submitted = input.submittedUnitKey.trim()
  if (!submitted) return { unit: null, building: null }

  const cell = unitOptionKeyToCell(submitted)
  if (cell.kind !== 'assigned') return { unit: null, building: null }

  const assigned = resolveInventoryUnitForResidentSave(input.units, {
    unit: cell.unit,
    building: cell.building,
  })
  return {
    unit: assigned.unitLabel.trim() || input.previousUnit.trim() || null,
    building:
      assigned.building.trim() ||
      input.previousBuilding.trim() ||
      (input.fallbackBuilding ?? '').trim() ||
      null,
  }
}
