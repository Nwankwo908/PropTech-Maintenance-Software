/**
 * Home Data Graph ingest: adapters map a vendor payload into HomeDataFacts.
 * persistHomeDataGraph is the only writer. Swap HOME_DATA_PROVIDER without changing graph columns.
 * Live ingest is Ulo (`ulo`, also the default for `attom`). Historical `rentcast` rows stay readable.
 */
import {
  parseHomeDataProviderId,
  type HomeDataIngestResult,
  type HomeDataProviderId,
} from "../../../../shared/homeDataGraph.ts"
import { fetchUloPropertyFacts } from "./uloPropertyFacts.ts"

export type HomeDataProviderFetch =
  | { status: "ok"; ingest: HomeDataIngestResult }
  | { status: "not_configured"; error: string }
  | { status: "unsupported"; error: string }

export function resolveHomeDataProvider(): HomeDataProviderId {
  return parseHomeDataProviderId(Deno.env.get("HOME_DATA_PROVIDER"))
}

export async function fetchHomeDataFromProvider(input: {
  provider: HomeDataProviderId
  address: string
}): Promise<HomeDataProviderFetch> {
  if (input.provider === "manual") {
    return {
      status: "unsupported",
      error: "Home data is stored on the graph. Automatic refresh is off for this property source.",
    }
  }
  if (input.provider === "rentcast") {
    return {
      status: "not_configured",
      error: "Property data isn’t connected yet.",
    }
  }
  if (input.provider === "ulo" || input.provider === "attom") {
    return await fetchUloPropertyFacts({ address: input.address })
  }

  return {
    status: "unsupported",
    error: "That property data source isn’t connected yet.",
  }
}
