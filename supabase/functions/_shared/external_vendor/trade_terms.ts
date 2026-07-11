/** Normalize ticket issue_category for external vendor search + filtering. */
export function normalizeIssueCategoryForSearch(
  issueCategory: string | null | undefined,
): string | null {
  const c = String(issueCategory ?? "").trim().toLowerCase()
  if (!c || c === "maintenance") return null
  if (c.includes("plumb") || c.includes("water")) return "plumbing"
  if (c.includes("hvac") || c.includes("heat") || c.includes("air")) return "hvac"
  if (c.includes("electric")) return "electrical"
  if (c.includes("appliance")) return "appliance"
  if (c.includes("door") || c.includes("window")) return "other"
  return c
}

export type ExternalVendorTradeBucket =
  | "plumbing"
  | "electrical"
  | "hvac"
  | "appliance"
  | "default"

/** Trade bucket for mock providers and result filtering. */
export function tradeBucketFromCategory(
  issueCategory: string | null | undefined,
): ExternalVendorTradeBucket {
  const c = normalizeIssueCategoryForSearch(issueCategory)
  if (c === "plumbing") return "plumbing"
  if (c === "electrical") return "electrical"
  if (c === "hvac") return "hvac"
  if (c === "appliance") return "appliance"
  return "default"
}

/** Map maintenance issue_category to external search trade terms. */
export function tradeTermsFromCategory(
  issueCategory: string | null | undefined,
): string {
  const bucket = tradeBucketFromCategory(issueCategory)
  if (bucket === "plumbing") return "plumbing contractor"
  if (bucket === "hvac") return "HVAC air conditioning heating"
  if (bucket === "electrical") return "electrical contractor"
  if (bucket === "appliance") return "appliance repair"
  const c = String(issueCategory ?? "").trim().toLowerCase()
  if (c.includes("door") || c.includes("window")) return "door window repair"
  if (c) return `${c} repair service`
  return "home maintenance repair"
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
