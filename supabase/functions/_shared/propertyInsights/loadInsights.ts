import { loadRentCastFill } from "./rentcastFill.ts"
import { loadZillowInsightFill } from "../zillow/insightFill.ts"

export type PropertyChartPoint = { date: string; value: number }

export type PropertyInsights = {
  photos: string[]
  yearBuilt: number | null
  homeValue: number | null
  rentEstimate: number | null
  rentLow: number | null
  rentHigh: number | null
  latitude: number | null
  longitude: number | null
  valueHistory: PropertyChartPoint[]
  rentHistory: PropertyChartPoint[]
  valueChangeLabel: string | null
  rentChangeLabel: string | null
}

export function emptyPropertyInsights(): PropertyInsights {
  return {
    photos: [],
    yearBuilt: null,
    homeValue: null,
    rentEstimate: null,
    rentLow: null,
    rentHigh: null,
    latitude: null,
    longitude: null,
    valueHistory: [],
    rentHistory: [],
    valueChangeLabel: null,
    rentChangeLabel: null,
  }
}

function hasUsefulInsights(insights: PropertyInsights): boolean {
  return (
    insights.yearBuilt != null ||
    insights.homeValue != null ||
    insights.rentEstimate != null ||
    insights.photos.length > 0 ||
    insights.valueHistory.length > 0
  )
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const insightCache = new Map<string, { at: number; insights: PropertyInsights }>()

export async function loadPropertyInsights(input: {
  address: string
  rentcastKey?: string | null
  zillowKey?: string | null
  zillowHost?: string | null
}): Promise<{ insights: PropertyInsights; configured: boolean; lookupError: string | null }> {
  const rentcastKey = input.rentcastKey?.trim() ?? ""
  const zillowKey = input.zillowKey?.trim() ?? ""
  const configured = Boolean(rentcastKey || zillowKey)
  if (!configured) {
    return {
      insights: emptyPropertyInsights(),
      configured: false,
      lookupError: "Property data isn’t connected (set ZILLOW_RAPIDAPI_KEY or RENTCAST_API_KEY).",
    }
  }

  const cacheKey = input.address.trim().toLowerCase().replace(/\s+/g, " ")
  const cached = insightCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && hasUsefulInsights(cached.insights)) {
    return { insights: cached.insights, configured: true, lookupError: null }
  }

  const [rentcastFill, zillowFill] = await Promise.all([
    rentcastKey ? loadRentCastFill({ address: input.address, apiKey: rentcastKey }) : Promise.resolve(null),
    zillowKey
      ? loadZillowInsightFill({
          address: input.address,
          apiKey: zillowKey,
          host: input.zillowHost,
        })
      : Promise.resolve(null),
  ])

  let insights = emptyPropertyInsights()

  if (rentcastFill) {
    insights = {
      ...insights,
      yearBuilt: rentcastFill.yearBuilt,
      homeValue: rentcastFill.homeValue,
      rentEstimate: rentcastFill.rentEstimate,
      rentLow: rentcastFill.rentLow,
      rentHigh: rentcastFill.rentHigh,
      latitude: rentcastFill.latitude,
      longitude: rentcastFill.longitude,
    }
  }

  if (zillowFill) {
    insights = {
      ...insights,
      photos: zillowFill.photos,
      yearBuilt: insights.yearBuilt ?? zillowFill.yearBuilt,
      homeValue: insights.homeValue ?? zillowFill.homeValue,
      rentEstimate: insights.rentEstimate ?? zillowFill.rentEstimate,
      latitude: insights.latitude ?? zillowFill.latitude,
      longitude: insights.longitude ?? zillowFill.longitude,
    }
  }

  if (insights.rentHistory.length === 0 && insights.rentEstimate != null) {
    insights.rentHistory = [{ date: new Date().toISOString().slice(0, 10), value: insights.rentEstimate }]
  }

  if (hasUsefulInsights(insights)) {
    insightCache.set(cacheKey, { at: Date.now(), insights })
  }
  const lookupError = hasUsefulInsights(insights)
    ? null
    : `No property data found for “${input.address.trim()}”. Check the street, city, and ZIP on Details.`
  console.warn("[property-insights]", {
    address: cacheKey,
    yearBuilt: insights.yearBuilt,
    homeValue: insights.homeValue,
    rentEstimate: insights.rentEstimate,
    photos: insights.photos.length,
    error: lookupError,
  })
  return { insights, configured: true, lookupError }
}
