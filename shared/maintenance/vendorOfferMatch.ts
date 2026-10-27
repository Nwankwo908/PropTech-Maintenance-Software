import { isGasEmergencyText } from "./urgencyPolicy.ts"

/** Thumbtack queries for a gas smell or gas leak. Not a handyman search. */
export const GAS_LEAK_VENDOR_SEARCH_QUERIES = ["gas leak repair", "plumber"] as const

const GAS_VENDOR =
  /\b(gas|propane|plumb\w*|hvac|heating|furnace|boiler|mechanical)\b/i

/**
 * A gas smell is searched as plumbing work. Other categories stay as given.
 */
export function externalSearchCategoryForIssue(
  issueCategory: string | null | undefined,
  description: string | null | undefined,
): string | null {
  if (isGasEmergencyText(description)) return "plumbing"
  const raw = (issueCategory ?? "").trim()
  return raw || null
}

/**
 * A gas smell may only be offered to a gas, plumbing, or heating vendor.
 * Other issues keep the existing search results.
 */
export function vendorOfferMatchesIssue(input: {
  name: string
  tags?: readonly string[] | null
  issueCategory?: string | null
  description?: string | null
}): boolean {
  const issueText = `${input.description ?? ""}\n${input.issueCategory ?? ""}`
  if (!isGasEmergencyText(issueText)) return true
  const blob = [input.name, ...(input.tags ?? [])].join(" ")
  return GAS_VENDOR.test(blob)
}
