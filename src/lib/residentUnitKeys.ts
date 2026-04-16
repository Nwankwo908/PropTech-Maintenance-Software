import { ALL_UNIT_OPTIONS } from '@/lib/propertyUnitOptions'

export type UnitCell =
  | { kind: 'assigned'; unit: string; building: string }
  | { kind: 'unassigned' }

/** Parses inventory slugs like `5a-a` → unit + Building A/B/C. */
export function unitOptionValueToCell(unitValue: string): UnitCell {
  if (!unitValue.trim()) return { kind: 'unassigned' }
  const [unit, buildingCode] = unitValue.split('-')
  const building =
    buildingCode?.toLowerCase() === 'a'
      ? 'Building A'
      : buildingCode?.toLowerCase() === 'b'
        ? 'Building B'
        : buildingCode?.toLowerCase() === 'c'
          ? 'Building C'
          : 'Building A'
  return { kind: 'assigned', unit: unit?.toUpperCase() ?? '', building }
}

/** Maps assigned unit+building to an `ALL_UNIT_OPTIONS` value, if on inventory. */
export function inventoryKeyForAssignedUnit(unit: string, building: string): string | null {
  for (const opt of ALL_UNIT_OPTIONS) {
    const cell = unitOptionValueToCell(opt.value)
    if (cell.kind === 'assigned' && cell.unit === unit && cell.building === building) {
      return opt.value
    }
  }
  return null
}

const CUSTOM_UNIT_PICK_PREFIX = '__pick:'

export function customUnitPickKey(unit: string, building: string): string {
  return `${CUSTOM_UNIT_PICK_PREFIX}${encodeURIComponent(unit)}:${encodeURIComponent(building)}`
}

export function tryParseCustomUnitPickKey(key: string): { unit: string; building: string } | null {
  if (!key.startsWith(CUSTOM_UNIT_PICK_PREFIX)) return null
  const rest = key.slice(CUSTOM_UNIT_PICK_PREFIX.length)
  const idx = rest.indexOf(':')
  if (idx === -1) return null
  try {
    return {
      unit: decodeURIComponent(rest.slice(0, idx)),
      building: decodeURIComponent(rest.slice(idx + 1)),
    }
  } catch {
    return null
  }
}

export function unitOptionKeyToCell(key: string): UnitCell {
  const k = key.trim()
  if (!k) return { kind: 'unassigned' }
  const custom = tryParseCustomUnitPickKey(k)
  if (custom) return { kind: 'assigned', unit: custom.unit, building: custom.building }
  return unitOptionValueToCell(k)
}

export type PropertyUnitsSourcePayload = {
  propertyName: string
  city: string
  state: string
  totalUnits: string
}

/**
 * One option per unit slot for a registered property (values use `__pick:` so they round-trip via `unitOptionKeyToCell`).
 */
export function buildUnitOptionsFromPropertyPayload(
  p: PropertyUnitsSourcePayload,
): { value: string; label: string }[] {
  const n = Number.parseInt(p.totalUnits.trim(), 10)
  if (!Number.isFinite(n) || n < 1) return []
  const name = p.propertyName.trim()
  const city = p.city.trim()
  const state = p.state.trim()
  const building = name ? `${name} (${city}, ${state})` : `${city}, ${state}`
  const out: { value: string; label: string }[] = []
  for (let i = 1; i <= n; i++) {
    const unit = `Unit ${i}`
    out.push({
      value: customUnitPickKey(unit, building),
      label: `${unit} — ${building}`,
    })
  }
  return out
}
