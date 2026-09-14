import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'
import {
  geocodablePropertyOrigin,
  haversineMiles,
  isFiniteLatLng,
  metersToMiles,
  roundMiles,
  type GeoLatLng,
} from '@shared/geo/haversineMiles'

export type VendorDistanceTarget = {
  key: string
  name: string
  address: string | null
}

function destinationQuery(vendor: VendorDistanceTarget): string {
  const name = vendor.name.trim()
  const address = vendor.address?.trim() ?? ''
  if (name && address) return `${name}, ${address}`
  return address || name
}

function geocodeResult(g: typeof google, result: google.maps.GeocoderResult | undefined): GeoLatLng | null {
  const loc = result?.geometry?.location
  if (!loc) return null
  const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat)
  const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng)
  const coords = { lat, lng }
  return isFiniteLatLng(coords) ? coords : null
}

function geocodeAddress(g: typeof google, query: string): Promise<GeoLatLng | null> {
  const q = query.trim()
  if (!q) return Promise.resolve(null)
  const geocoder = new g.maps.Geocoder()
  return new Promise((resolve) => {
    geocoder.geocode({ address: q, componentRestrictions: { country: 'US' } }, (results, status) => {
      if (status !== 'OK') {
        resolve(null)
        return
      }
      resolve(geocodeResult(g, results?.[0]))
    })
  })
}

function distanceMatrixBatch(
  g: typeof google,
  origin: string,
  destinations: string[],
): Promise<Array<number | null>> {
  const service = new g.maps.DistanceMatrixService()
  return new Promise((resolve) => {
    service.getDistanceMatrix(
      {
        origins: [origin],
        destinations,
        travelMode: g.maps.TravelMode.DRIVING,
        unitSystem: g.maps.UnitSystem.IMPERIAL,
      },
      (response, status) => {
        if (status !== 'OK' || !response?.rows?.[0]?.elements) {
          resolve(destinations.map(() => null))
          return
        }
        const elements = response.rows[0].elements
        resolve(
          destinations.map((_, i) => {
            const el = elements[i]
            const meters = el?.status === 'OK' ? el.distance?.value : null
            if (meters == null || !Number.isFinite(meters)) return null
            return metersToMiles(meters)
          }),
        )
      },
    )
  })
}

async function drivingMiles(
  g: typeof google,
  origin: string,
  vendors: VendorDistanceTarget[],
): Promise<Record<string, number>> {
  if (typeof g.maps.DistanceMatrixService !== 'function') return {}
  const out: Record<string, number> = {}
  const batchSize = 25
  for (let i = 0; i < vendors.length; i += batchSize) {
    const batch = vendors.slice(i, i + batchSize)
    const named = batch.map(destinationQuery)
    let miles = await distanceMatrixBatch(g, origin, named)
    const retryIdx: number[] = []
    const retryQueries: string[] = []
    for (let j = 0; j < batch.length; j += 1) {
      if (miles[j] != null) continue
      const address = batch[j].address?.trim()
      if (address && address !== named[j]) {
        retryIdx.push(j)
        retryQueries.push(address)
      }
    }
    if (retryQueries.length > 0) {
      const retried = await distanceMatrixBatch(g, origin, retryQueries)
      retryIdx.forEach((j, k) => {
        miles[j] = retried[k]
      })
    }
    for (let j = 0; j < batch.length; j += 1) {
      const value = miles[j]
      if (value != null) out[batch[j].key] = value
    }
  }
  return out
}

async function haversineFallback(
  g: typeof google,
  origin: string,
  vendors: VendorDistanceTarget[],
): Promise<Record<string, number>> {
  const originCoords = await geocodeAddress(g, origin)
  if (!originCoords) return {}
  const pairs = await Promise.all(
    vendors.map(async (vendor) => {
      const coords = await geocodeAddress(g, destinationQuery(vendor))
      if (!coords) return null
      return [vendor.key, roundMiles(haversineMiles(originCoords, coords))] as const
    }),
  )
  const out: Record<string, number> = {}
  for (const pair of pairs) {
    if (pair) out[pair[0]] = pair[1]
  }
  return out
}

type DistanceMatrixPayload = {
  rows?: Array<{
    elements?: Array<{
      status?: string
      distance?: { value?: number; text?: string }
    }>
  }>
}

function milesFromMatrixElements(
  vendors: VendorDistanceTarget[],
  elements: NonNullable<NonNullable<DistanceMatrixPayload['rows']>[number]['elements']> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!elements) return out
  vendors.forEach((vendor, i) => {
    const el = elements[i]
    const meters = el?.status === 'OK' ? el.distance?.value : null
    if (meters == null || !Number.isFinite(meters)) return
    out[vendor.key] = metersToMiles(meters)
  })
  return out
}

async function drivingMilesViaDevProxy(
  origin: string,
  vendors: VendorDistanceTarget[],
): Promise<Record<string, number>> {
  if (!import.meta.env.DEV || typeof window === 'undefined' || vendors.length === 0) return {}
  const destinations = vendors.map(destinationQuery).join('|')
  const url =
    `/ulo-distance-matrix?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destinations)}`
  const res = await fetch(url)
  if (!res.ok) return {}
  const payload = (await res.json()) as DistanceMatrixPayload
  const named = milesFromMatrixElements(vendors, payload.rows?.[0]?.elements)
  const missing = vendors.filter((v) => named[v.key] == null)
  if (missing.length === 0) return named
  const retryDest = missing.map((v) => v.address?.trim() || destinationQuery(v)).join('|')
  const retryUrl =
    `/ulo-distance-matrix?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(retryDest)}`
  const retryRes = await fetch(retryUrl)
  if (!retryRes.ok) return named
  const retryPayload = (await retryRes.json()) as DistanceMatrixPayload
  return {
    ...named,
    ...milesFromMatrixElements(missing, retryPayload.rows?.[0]?.elements),
  }
}

/** Driving miles from the work-order property to each external vendor. */
export async function measureVendorDistancesFromProperty(input: {
  originAddress: string
  vendors: VendorDistanceTarget[]
}): Promise<Record<string, number>> {
  const origin = geocodablePropertyOrigin(input.originAddress)
  const vendors = input.vendors.filter((v) => v.key.trim() && (v.name.trim() || v.address?.trim()))
  if (!origin || vendors.length === 0) return {}

  try {
    const proxied = await drivingMilesViaDevProxy(origin, vendors)
    if (Object.keys(proxied).length === vendors.length) return proxied

    const apiKey = resolveGoogleMapsApiKey()
    if (!apiKey) return proxied

    const g = await loadGoogleMapsApi(apiKey)
    if (typeof g.maps.importLibrary === 'function') {
      await Promise.allSettled([g.maps.importLibrary('routes'), g.maps.importLibrary('geocoding')])
    }
    const driving = { ...proxied, ...(await drivingMiles(g, origin, vendors)) }
    const missing = vendors.filter((v) => driving[v.key] == null)
    if (missing.length === 0) return driving
    const fallback = await haversineFallback(g, origin, missing)
    return { ...fallback, ...driving }
  } catch {
    return {}
  }
}
