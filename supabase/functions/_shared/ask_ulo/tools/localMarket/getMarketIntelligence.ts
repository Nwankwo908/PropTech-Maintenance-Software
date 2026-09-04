/**
 * getMarketIntelligence — domain tool wrapping marketDataLookup (AVM / comps).
 */

import {
  marketDataLookup,
  type MarketDataLookupResult,
} from "../../retrieval/marketDataLookup.ts"

export type GetMarketIntelligenceParams = {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
  portfolioMonthlyRent?: number | null
}

export type GetMarketIntelligenceResult = MarketDataLookupResult & {
  toolId: "get_market_intelligence"
  params: Record<string, unknown>
}

export async function getMarketIntelligence(
  params: GetMarketIntelligenceParams,
): Promise<GetMarketIntelligenceResult> {
  const base = await marketDataLookup({
    buildingName: params.buildingName,
    cityLabel: params.cityLabel,
    stateCode: params.stateCode,
    addressLine: params.addressLine,
    portfolioMonthlyRent: params.portfolioMonthlyRent,
  })

  return {
    ...base,
    toolId: "get_market_intelligence",
    params: {
      buildingName: params.buildingName,
      cityLabel: params.cityLabel,
      stateCode: params.stateCode,
      addressLine: params.addressLine ?? null,
      provider: base.provider,
      available: base.available,
      compCount: base.comps.length,
      estimatedRent: base.estimatedRent,
    },
  }
}
