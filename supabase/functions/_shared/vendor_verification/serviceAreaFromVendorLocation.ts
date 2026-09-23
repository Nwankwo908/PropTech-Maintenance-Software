/**
 * Seed verification service_area from roster city/state (manual onboarding /
 * Add vendor form) so the public form City/State dropdowns open prefilled.
 */

const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
}

export function normalizeUsStateCode(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  const upper = raw.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  return US_STATE_BY_NAME[raw.toLowerCase()] ?? ""
}

function firstNonEmpty(list: unknown): string {
  if (!Array.isArray(list)) return ""
  for (const item of list) {
    if (typeof item === "string" && item.trim()) return item.trim()
  }
  return ""
}

export function serviceAreaHasCityOrState(
  area: Record<string, unknown> | null | undefined,
): boolean {
  if (!area || typeof area !== "object") return false
  if (firstNonEmpty(area.cities)) return true
  if (firstNonEmpty(area.counties)) return true
  if (typeof area.centerAddress === "string" && area.centerAddress.trim()) {
    return true
  }
  return false
}

/** Build a minimal service_area object from roster HQ city/state. */
export function buildServiceAreaFromVendorLocation(input: {
  city?: string | null
  state?: string | null
}): Record<string, unknown> | null {
  const city = (input.city ?? "").trim()
  const state = normalizeUsStateCode(input.state)
  if (!city && !state) return null
  const centerAddress = [city, state].filter(Boolean).join(", ") || null
  return {
    cities: city ? [city] : [],
    counties: state ? [state] : [],
    zips: [],
    centerAddress,
  }
}

/**
 * Prefer an existing verification service_area; otherwise use roster city/state.
 */
export function mergeServiceAreaWithVendorLocation(
  existing: Record<string, unknown> | null | undefined,
  vendor: { city?: string | null; state?: string | null } | null | undefined,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" ? { ...existing } : {}
  if (serviceAreaHasCityOrState(base)) return base
  const seeded = buildServiceAreaFromVendorLocation({
    city: vendor?.city,
    state: vendor?.state,
  })
  return seeded ?? base
}
