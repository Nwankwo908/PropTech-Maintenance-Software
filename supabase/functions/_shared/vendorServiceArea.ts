/** US state matching for vendor dispatch vs the work-order property. */

const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
]

export function normalizeUsStateCode(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim()
  if (!value) return null
  const upper = value.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper) && US_STATES.some((row) => row.code === upper)) {
    return upper
  }
  const lower = value.toLowerCase()
  const byName = US_STATES.find((row) => row.name.toLowerCase() === lower)
  return byName?.code ?? null
}

function collectStateCodes(values: unknown[]): string[] {
  const codes = new Set<string>()
  for (const value of values) {
    if (typeof value !== "string") continue
    const code = normalizeUsStateCode(value)
    if (code) codes.add(code)
  }
  return [...codes]
}

function statesFromCenterAddress(centerAddress: string | null | undefined): string[] {
  const raw = (centerAddress ?? "").trim()
  if (!raw) return []
  const codes = new Set<string>()
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean)
  for (const part of parts) {
    const token = part.split(/\s+/)[0] ?? ""
    const fromToken = normalizeUsStateCode(token)
    if (fromToken) codes.add(fromToken)
    const embedded = part.match(/\b([A-Za-z]{2})\b/)
    if (embedded?.[1]) {
      const fromEmbed = normalizeUsStateCode(embedded[1])
      if (fromEmbed) codes.add(fromEmbed)
    }
  }
  const byName = US_STATES.find((row) =>
    new RegExp(`\\b${row.name}\\b`, "i").test(raw)
  )
  if (byName) codes.add(byName.code)
  return [...codes]
}

export function vendorServiceStateCodes(input: {
  serviceArea?: unknown
  licenseState?: string | null
}): string[] {
  const codes = new Set<string>()
  const area = input.serviceArea && typeof input.serviceArea === "object"
    ? input.serviceArea as Record<string, unknown>
    : null
  if (area) {
    for (const code of collectStateCodes(Array.isArray(area.counties) ? area.counties : [])) {
      codes.add(code)
    }
    if (typeof area.centerAddress === "string") {
      for (const code of statesFromCenterAddress(area.centerAddress)) codes.add(code)
    }
    if (typeof area.state === "string") {
      const code = normalizeUsStateCode(area.state)
      if (code) codes.add(code)
    }
    if (Array.isArray(area.states)) {
      for (const code of collectStateCodes(area.states)) codes.add(code)
    }
  }
  const license = normalizeUsStateCode(input.licenseState)
  if (license) codes.add(license)
  return [...codes]
}

/**
 * When the job's state is known, the vendor must serve that state.
 * Unknown job location does not block matching.
 */
export function vendorCoversJobState(
  vendorStates: string[],
  jobState: string | null | undefined,
): boolean {
  const job = normalizeUsStateCode(jobState ?? "")
  if (!job) return true
  if (vendorStates.length === 0) return false
  return vendorStates.includes(job)
}
