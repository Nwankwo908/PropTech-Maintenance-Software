/** Canonical address identity for onboarding inventory (aligned with SQL helpers). */

const STREET_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(street|st)\b/g, 'st'],
  [/\b(avenue|ave)\b/g, 'ave'],
  [/\b(boulevard|blvd)\b/g, 'blvd'],
  [/\b(drive|dr)\b/g, 'dr'],
  [/\b(road|rd)\b/g, 'rd'],
  [/\b(lane|ln)\b/g, 'ln'],
  [/\b(court|ct)\b/g, 'ct'],
  [/\b(place|pl)\b/g, 'pl'],
  [/\b(circle|cir)\b/g, 'cir'],
  [/\b(highway|hwy)\b/g, 'hwy'],
  [/\b(apartment|apt)\b/g, 'apt'],
  [/\b(suite|ste)\b/g, 'ste'],
  [/\b(north|n)\b/g, 'n'],
  [/\b(south|s)\b/g, 's'],
  [/\b(east|e)\b/g, 'e'],
  [/\b(west|w)\b/g, 'w'],
]

export function normalizeOnboardingStreet(street: string | null | undefined): string {
  let s = (street ?? '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [pattern, replacement] of STREET_REPLACEMENTS) {
    s = s.replace(pattern, replacement)
  }
  return s.replace(/\s+/g, ' ').trim()
}

export function normalizeOnboardingCity(city: string | null | undefined): string {
  return (city ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeOnboardingState(state: string | null | undefined): string {
  return (state ?? '').trim().toUpperCase()
}

export function normalizeOnboardingZip(zip: string | null | undefined): string {
  const digits = (zip ?? '').replace(/\D/g, '')
  return digits.slice(0, 5)
}

/** Empty when street is missing — name-only rows must not merge on address. */
export function onboardingAddressMatchKey(input: {
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}): string {
  const street = normalizeOnboardingStreet(input.streetAddress)
  if (!street) return ''
  return [
    street,
    normalizeOnboardingCity(input.city),
    normalizeOnboardingState(input.state),
    normalizeOnboardingZip(input.zipCode),
  ].join('|')
}

export type AddressIdentityProperty = {
  id: string
  name: string
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}

/**
 * Collapse properties that share a verified address key.
 * Conflicting addresses stay separate. Ambiguous name-only collisions are left for review
 * (not merged). Keeps the first stable id when merging.
 */
export function reconcilePropertiesByAddressIdentity<T extends AddressIdentityProperty>(
  rows: T[],
): { properties: T[]; ambiguousNameCollisions: string[] } {
  const byAddress = new Map<string, T>()
  const byName = new Map<string, T>()
  const out: T[] = []
  const ambiguousNameCollisions: string[] = []

  for (const row of rows) {
    const addrKey = onboardingAddressMatchKey(row)
    if (addrKey) {
      const existing = byAddress.get(addrKey)
      if (existing) {
        byAddress.set(addrKey, {
          ...existing,
          ...row,
          id: existing.id,
          name: row.name.trim() || existing.name,
          streetAddress: row.streetAddress?.trim() || existing.streetAddress,
          city: row.city?.trim() || existing.city,
          state: row.state?.trim() || existing.state,
          zipCode: row.zipCode?.trim() || existing.zipCode,
        })
        continue
      }
      byAddress.set(addrKey, row)
      continue
    }

    const nameKey = row.name.trim().toLowerCase()
    // Keep blank review placeholders (e.g. lease draft with required address)
    // so the UI can collect the missing address instead of dropping the row.
    if (!nameKey) {
      out.push(row)
      continue
    }
    const named = byName.get(nameKey)
    if (named) {
      const namedAddr = onboardingAddressMatchKey(named)
      if (namedAddr && addrKey && namedAddr !== addrKey) {
        ambiguousNameCollisions.push(row.name.trim())
        out.push(row)
        continue
      }
      byName.set(nameKey, {
        ...named,
        ...row,
        id: named.id,
        name: row.name.trim() || named.name,
      })
      continue
    }
    byName.set(nameKey, row)
  }

  for (const row of byAddress.values()) out.push(row)
  for (const row of byName.values()) {
    const addrKey = onboardingAddressMatchKey(row)
    if (addrKey && byAddress.has(addrKey)) continue
    out.push(row)
  }

  return { properties: out, ambiguousNameCollisions }
}
