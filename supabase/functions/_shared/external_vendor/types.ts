/** One hit from a single external provider before merge/rank. */
export type ExternalVendorHit = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  source: ExternalVendorSource
  /** Optional stable id from the provider (Thumbtack businessID, etc.). */
  providerRef?: string | null
  etaMinutes?: number | null
  address?: string | null
  phone?: string | null
  website?: string | null
  /** Provider listing page (Thumbtack service page, etc.). */
  listingUrl?: string | null
  /** Thumbtack Request Flow widget URL (`widgets.requestFlowURL`). */
  requestFlowUrl?: string | null
  tags?: string[]
  searchId?: string | null
  categoryId?: string | null
  /** Thumbtack `businessImageURL` (or similar) for the pro’s profile photo. */
  imageUrl?: string | null
}

export type ExternalVendorSource = "thumbtack" | "mock"

/** Merged, ranked suggestion returned to admin APIs. */
export type ExternalVendorSuggestion = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: ExternalVendorSource[]
  rankScore: number
  etaMinutes: number | null
  address?: string | null
  phone?: string | null
  website?: string | null
  /** Provider listing page (Thumbtack service page, etc.). */
  listingUrl?: string | null
  /** Thumbtack Request Flow widget URL (`widgets.requestFlowURL`). */
  requestFlowUrl?: string | null
  tags?: string[]
  searchId?: string | null
  categoryId?: string | null
  providerRef?: string | null
  contactStatus?: "awaiting_response" | "vendor_replied" | "closed" | null
  contactedAt?: string | null
  lastInboundAt?: string | null
  lastInboundPreview?: string | null
  /** Thumbtack `businessImageURL` (or similar) for the pro’s profile photo. */
  imageUrl?: string | null
}

export type ExternalVendorSearchInput = {
  issueCategory: string | null
  searchLocation: string
  tradeTerms: string
  textQuery: string
  /** Tenant / ticket wording for Thumbtack search-filtered. */
  jobDescription?: string | null
  limit?: number
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
  /** License/COI check snapshot from Find External Vendor (optional). */
  compliance?: Record<string, unknown>
}
