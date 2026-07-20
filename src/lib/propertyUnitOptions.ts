import { isDemoAccountActive } from '@/lib/activeLandlord'

/** Property inventory keys for admin occupancy stats / unit pickers (`value` matches `unitOptionValueToCell` parsing). */
export const ALL_UNIT_OPTIONS = [
  { value: '2b-a', label: '2B — Building A' },
  { value: '5a-a', label: '5A — Building A' },
  { value: '12c-c', label: '12C — Building C' },
  { value: '8b-b', label: '8B — Building B' },
  { value: '3d-a', label: '3D — Building A' },
] as const

export type InventoryUnitOption = { value: string; label: string }

/**
 * Showcase Building A/B/C inventory is demo-account only.
 * New Landlord / default must use DB + onboarding-registered units only.
 */
export function getInventoryUnitOptions(): InventoryUnitOption[] {
  if (!isDemoAccountActive()) return []
  return ALL_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
}
