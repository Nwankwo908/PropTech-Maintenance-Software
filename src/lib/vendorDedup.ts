type VendorLike = {
  id: string
  name: string
  active?: boolean
  completedJobs?: number
  createdAt?: string | null
}

function vendorNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Pick the row to keep when multiple vendors share the same name. */
export function pickPreferredVendor<T extends VendorLike>(left: T, right: T): T {
  const leftActive = left.active !== false
  const rightActive = right.active !== false
  if (leftActive !== rightActive) return leftActive ? left : right

  const leftJobs = left.completedJobs ?? 0
  const rightJobs = right.completedJobs ?? 0
  if (leftJobs !== rightJobs) return leftJobs >= rightJobs ? left : right

  const leftCreated = left.createdAt ?? ''
  const rightCreated = right.createdAt ?? ''
  if (leftCreated && rightCreated && leftCreated !== rightCreated) {
    return leftCreated <= rightCreated ? left : right
  }

  return left.id.localeCompare(right.id) <= 0 ? left : right
}

/** Collapse duplicate vendor names to a single canonical row per name. */
export function dedupeVendorsByName<T extends VendorLike>(vendors: T[]): T[] {
  const byName = new Map<string, T>()
  const unnamed: T[] = []

  for (const vendor of vendors) {
    const key = vendorNameKey(vendor.name)
    if (!key) {
      unnamed.push(vendor)
      continue
    }

    const existing = byName.get(key)
    byName.set(key, existing ? pickPreferredVendor(existing, vendor) : vendor)
  }

  return [...byName.values(), ...unnamed]
}

/** Return duplicate vendor ids that should be removed, keeping one row per name. */
export function duplicateVendorIdsToRemove<T extends VendorLike>(vendors: T[]): string[] {
  const groups = new Map<string, T[]>()

  for (const vendor of vendors) {
    const key = vendorNameKey(vendor.name)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(vendor)
    groups.set(key, group)
  }

  const idsToRemove: string[] = []
  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const keep = group.reduce((best, row) => pickPreferredVendor(best, row))
    for (const vendor of group) {
      if (vendor.id !== keep.id) idsToRemove.push(vendor.id)
    }
  }

  return idsToRemove
}
