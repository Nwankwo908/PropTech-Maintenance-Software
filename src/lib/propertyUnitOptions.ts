/** Property inventory keys for admin occupancy stats / unit pickers (`value` matches `unitOptionValueToCell` parsing). */
export type InventoryUnitOption = { value: string; label: string }

/** DB-backed unit pickers load from units table; no hardcoded showcase inventory. */
export function getInventoryUnitOptions(): InventoryUnitOption[] {
  return []
}
