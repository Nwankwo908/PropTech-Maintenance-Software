import { customUnitPickKey } from '@/lib/residentUnitKeys'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { formatPropertyUnitDisplay } from '@/lib/propertyUnitRows'

type PropertyUnitOption = {
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

    const pickKey = customUnitPickKey(unitLabel, input.building)
    const isCurrent = occupantId === input.editingResidentId
    options.push({
      value: pickKey,
      label: isCurrent
        ? `${formatPropertyUnitDisplay(unitLabel)} (current)`
        : formatPropertyUnitDisplay(unitLabel),
    })
  }

  return options.sort((a, b) => {
    if (!a.value) return -1
    if (!b.value) return 1
    return a.label.localeCompare(b.label, undefined, { numeric: true })
  })
}

export function initialUnitOptionKeyForResident(unit: string, building: string): string {
  if (!unit.trim()) return ''
  return customUnitPickKey(unit.trim(), building)
}
