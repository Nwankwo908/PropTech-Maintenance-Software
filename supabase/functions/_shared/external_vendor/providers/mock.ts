import { tradeBucketFromCategory } from "../trade_terms.ts"
import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"

const MOCK_BY_TRADE: Record<string, ExternalVendorHit[]> = {
  plumbing: [
    {
      name: "Rapid Plumb Co.",
      rating: 4.9,
      reviewCount: 218,
      priceLabel: "$$ · Moderate",
      source: "mock",
      etaMinutes: 18,
    },
    {
      name: "Metro Plumbing Services",
      rating: 4.6,
      reviewCount: 142,
      priceLabel: "$ · Inexpensive",
      source: "mock",
      etaMinutes: 35,
    },
    {
      name: "Apex Pipe & Drain",
      rating: 4.8,
      reviewCount: 96,
      priceLabel: "$$ · Moderate",
      source: "mock",
      etaMinutes: 25,
    },
  ],
  electrical: [
    {
      name: "BrightWire Electric",
      rating: 4.7,
      reviewCount: 164,
      priceLabel: "$$ · Moderate",
      source: "mock",
      etaMinutes: 40,
    },
    {
      name: "SafePanel Contractors",
      rating: 4.9,
      reviewCount: 88,
      priceLabel: "$$$ · Expensive",
      source: "mock",
      etaMinutes: 55,
    },
  ],
  hvac: [
    {
      name: "Summit Climate HVAC",
      rating: 4.8,
      reviewCount: 201,
      priceLabel: "$$ · Moderate",
      source: "mock",
      etaMinutes: 45,
    },
  ],
  default: [
    {
      name: "Allied Home Repair",
      rating: 4.5,
      reviewCount: 77,
      priceLabel: "$ · Inexpensive",
      source: "mock",
      etaMinutes: 60,
    },
    {
      name: "Neighborhood Fix-It",
      rating: 4.4,
      reviewCount: 52,
      priceLabel: "$ · Inexpensive",
      source: "mock",
      etaMinutes: 90,
    },
  ],
}

/** Deterministic external suggestions for dev/demo when live APIs are unavailable. */
export class MockExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "mock" as const

  isConfigured(): boolean {
    return true
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    const bucket = tradeBucketFromCategory(input.issueCategory)
    const rows = MOCK_BY_TRADE[bucket] ?? MOCK_BY_TRADE.default
    return rows.map((row) => ({ ...row }))
  }
}
