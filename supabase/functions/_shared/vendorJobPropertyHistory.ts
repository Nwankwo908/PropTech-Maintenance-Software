/** Vendor job page history — same landlord, property, unit, and assigned vendor. */

export type VendorJobHistoryScope = {
  ticketId: string
  vendorId: string | null
  propertyId: string | null
  unitId: string | null
  unitLabel: string
}

export type VendorJobHistoryRow = {
  id: unknown
  unit?: unknown
  unit_id?: unknown
  property_id?: unknown
  assigned_vendor_id?: unknown
  vendor_work_status?: unknown
  description?: unknown
  created_at?: unknown
}

export function normalizeVendorJobHistoryUnitKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, "")
    .replace(/[\s.#-]+/g, "")
    .trim()
}

export function isCancelledVendorJobHistoryStatus(status: string): boolean {
  const value = status.trim().toLowerCase()
  return value === "cancelled" || value === "canceled"
}

export function vendorJobHistoryUnitsMatch(
  scope: Pick<VendorJobHistoryScope, "unitId" | "unitLabel">,
  row: Pick<VendorJobHistoryRow, "unit" | "unit_id">,
): boolean {
  const rowUnitId = typeof row.unit_id === "string" && row.unit_id.trim() ? row.unit_id.trim() : ""
  if (scope.unitId && rowUnitId) return scope.unitId === rowUnitId

  const rowUnit = typeof row.unit === "string" ? row.unit : ""
  const left = normalizeVendorJobHistoryUnitKey(scope.unitLabel)
  const right = normalizeVendorJobHistoryUnitKey(rowUnit)
  if (!left || !right) return false
  return left === right
}

export function isVendorPropertyUnitJobHistoryRow(
  scope: VendorJobHistoryScope,
  row: VendorJobHistoryRow,
): boolean {
  if (!scope.vendorId) return false
  if (typeof row.id !== "string" || !row.id || row.id === scope.ticketId) return false

  const vendorId =
    typeof row.assigned_vendor_id === "string" ? row.assigned_vendor_id.trim() : ""
  if (vendorId !== scope.vendorId) return false

  if (scope.propertyId) {
    const propertyId =
      typeof row.property_id === "string" && row.property_id.trim()
        ? row.property_id.trim()
        : ""
    if (propertyId && propertyId !== scope.propertyId) return false
  }

  const status = typeof row.vendor_work_status === "string" ? row.vendor_work_status : ""
  if (isCancelledVendorJobHistoryStatus(status)) return false

  return vendorJobHistoryUnitsMatch(scope, row)
}

export function selectVendorPropertyUnitJobHistory<T extends VendorJobHistoryRow>(
  scope: VendorJobHistoryScope,
  rows: T[],
  limit = 8,
): T[] {
  const selected: T[] = []
  for (const row of rows) {
    if (!isVendorPropertyUnitJobHistoryRow(scope, row)) continue
    selected.push(row)
    if (selected.length >= limit) break
  }
  return selected
}
