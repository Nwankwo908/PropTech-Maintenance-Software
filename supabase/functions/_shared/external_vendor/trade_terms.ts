/** Map maintenance issue_category to external search trade terms. */
export function tradeTermsFromCategory(
  issueCategory: string | null | undefined,
): string {
  const c = String(issueCategory ?? "").trim().toLowerCase()
  if (!c) return "home maintenance repair"
  if (c.includes("plumb")) return "plumbing contractor"
  if (c.includes("hvac") || c.includes("heat") || c.includes("air")) {
    return "HVAC air conditioning heating"
  }
  if (c.includes("electric")) return "electrical contractor"
  if (c.includes("appliance")) return "appliance repair"
  if (c.includes("door") || c.includes("window")) return "door window repair"
  return `${c} repair service`
}

export function buildExternalSearchQuery(
  issueCategory: string | null,
  searchLocation: string,
): { tradeTerms: string; textQuery: string; searchLocation: string } {
  const loc = searchLocation.trim() || "United States"
  const tradeTerms = tradeTermsFromCategory(issueCategory)
  return {
    tradeTerms,
    textQuery: `${tradeTerms} near ${loc}`,
    searchLocation: loc,
  }
}
