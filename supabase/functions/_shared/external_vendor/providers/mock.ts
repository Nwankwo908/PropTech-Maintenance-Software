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
      phone: "(312) 555-0182",
      website: "rapidplumb.com",
    },
    {
      name: "Metro Plumbing Services",
      rating: 4.6,
      reviewCount: 142,
      priceLabel: "$ · Inexpensive",
      source: "mock",
      etaMinutes: 35,
      phone: "(312) 555-0047",
      website: "metroplumb.com",
    },
    {
      name: "Apex Pipe & Drain",
      rating: 4.8,
      reviewCount: 96,
      priceLabel: "$$ · Moderate",
      source: "mock",
      etaMinutes: 25,
      phone: "(312) 555-0219",
      website: "apexpipedrain.com",
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
      phone: "(312) 555-0144",
      website: "brightwireelectric.com",
    },
    {
      name: "SafePanel Contractors",
      rating: 4.9,
      reviewCount: 88,
      priceLabel: "$$$ · Expensive",
      source: "mock",
      etaMinutes: 55,
      phone: "(312) 555-0199",
      website: "safepanelelectric.com",
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
      phone: "(312) 555-0177",
      website: "summitclimatehvac.com",
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
      phone: "(312) 555-0100",
      website: "alliedhomerepair.com",
    },
    {
      name: "Neighborhood Fix-It",
      rating: 4.4,
      reviewCount: 52,
      priceLabel: "$ · Inexpensive",
      source: "mock",
      etaMinutes: 90,
      phone: "(312) 555-0111",
      website: "neighborhoodfixit.com",
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
