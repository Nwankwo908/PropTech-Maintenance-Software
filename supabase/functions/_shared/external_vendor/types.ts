/** One hit from a single external provider before merge/rank. */
export type ExternalVendorHit = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  source: ExternalVendorSource
  /** Optional stable id from the provider (Yelp business id, etc.). */
  providerRef?: string | null
  etaMinutes?: number | null
}

export type ExternalVendorSource = "google" | "yelp" | "mock"

/** Merged, ranked suggestion returned to admin APIs. */
export type ExternalVendorSuggestion = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: ExternalVendorSource[]
  rankScore: number
  etaMinutes: number | null
}

export type ExternalVendorSearchInput = {
  issueCategory: string | null
  searchLocation: string
  tradeTerms: string
  textQuery: string
}

export interface ExternalVendorProvider {
  readonly id: ExternalVendorSource
  isConfigured(): boolean
  search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]>
}

export type ExternalDiscoverySnapshot = {
  sources: ExternalVendorSource[]
  rating: number | null
  review_count: number | null
  price_label: string | null
  rank_score: number | null
}
