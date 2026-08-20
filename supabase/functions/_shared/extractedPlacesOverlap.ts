/**
 * Same-place matching for rent-roll names vs lease street addresses.
 * Keep in sync with src/lib/onboarding/persist/properties.ts.
 */
const GENERIC_PLACE_TOKENS = new Set([
  "street",
  "st",
  "avenue",
  "ave",
  "road",
  "rd",
  "drive",
  "dr",
  "lane",
  "ln",
  "blvd",
  "boulevard",
  "way",
  "court",
  "ct",
  "place",
  "pl",
  "apt",
  "apartment",
  "apartments",
  "unit",
  "llc",
  "inc",
  "the",
  "of",
  "and",
  "nj",
  "ny",
  "pa",
  "property",
  "properties",
  "building",
  "buildings",
  "home",
  "homes",
  "rentals",
  "portfolio",
  "city",
  "county",
])

function placeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_PLACE_TOKENS.has(token) && !/^\d{5}$/.test(token))
}

function hasHouseNumber(value: string): boolean {
  return /^\d+\s+\S/.test(value.trim())
}

function streetNumber(value: string): string {
  const match = value.trim().match(/^(\d+)/)
  return match?.[1] ?? ""
}

function containedPlaceLabel(shorter: string, longer: string): boolean {
  if (shorter.length < 8 || !longer.includes(shorter)) return false
  if (shorter.includes(" ")) return true
  return shorter.length >= 12 && !hasHouseNumber(longer)
}

export function extractedPlacesOverlap(left: string, right: string): boolean {
  const a = left.trim()
  const b = right.trim()
  if (!a || !b) return false
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower === bLower) return true

  const shorter = aLower.length <= bLower.length ? aLower : bLower
  const longer = aLower.length <= bLower.length ? bLower : aLower
  if (containedPlaceLabel(shorter, longer)) return true

  const aTokens = placeTokens(a)
  const bTokens = placeTokens(b)
  const overlap = aTokens.filter((token) => bTokens.includes(token))
  const distinctive = overlap.filter((token) => !/^\d+$/.test(token))
  const aIsAddress = hasHouseNumber(a)
  const bIsAddress = hasHouseNumber(b)

  if (aIsAddress && bIsAddress) {
    const aNumber = streetNumber(a)
    const bNumber = streetNumber(b)
    return Boolean(aNumber && bNumber && aNumber === bNumber && distinctive.length >= 1)
  }

  if (distinctive.length >= 2) return true
  return aIsAddress !== bIsAddress && distinctive.length >= 1
}
