/**
 * Resolve US city + state from a ZIP.
 * Prefer Google Geocoder when Maps is configured; fall back to Zippopotam.us.
 */
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'
import {
  parseGooglePlaceAddress,
  type GooglePlaceAddressComponent,
} from '@/lib/parseGooglePlaceAddress'
import { usStateCodeFromLabel } from '@/lib/usLocations'

export type UsZipLocation = {
  city: string
  state: string
  zipCode: string
}

export function normalizeUsZip(input: string): string | null {
  const match = input.trim().match(/^(\d{5})(?:-\d{4})?$/)
  return match?.[1] ?? null
}

function componentsFromGeocoderResult(
  result: google.maps.GeocoderResult,
): GooglePlaceAddressComponent[] {
  return (result.address_components ?? []).map((part) => ({
    long_name: part.long_name ?? '',
    short_name: part.short_name ?? '',
    types: [...(part.types ?? [])],
  }))
}

async function lookupViaGoogle(zipCode: string): Promise<UsZipLocation | null> {
  const apiKey = resolveGoogleMapsApiKey()
  if (!apiKey) return null

  const g = await loadGoogleMapsApi(apiKey)
  if (typeof g.maps.importLibrary === 'function') {
    await g.maps.importLibrary('geocoding').catch(() => undefined)
  }
  if (typeof g.maps.Geocoder !== 'function') return null

  const geocoder = new g.maps.Geocoder()
  const result = await new Promise<google.maps.GeocoderResult | null>((resolve) => {
    // Geocoder componentRestrictions only supports `country` — do not pass postalCode.
    geocoder.geocode(
      {
        address: zipCode,
        componentRestrictions: { country: 'US' },
      },
      (results, status) => {
        if (status !== 'OK' || !results?.[0]) {
          resolve(null)
          return
        }
        resolve(results[0])
      },
    )
  })
  if (!result) return null

  const parsed = parseGooglePlaceAddress({
    address_components: componentsFromGeocoderResult(result),
  })
  const state = parsed?.state ?? ''
  const city = parsed?.city ?? ''
  if (!city || !state) return null
  return {
    city,
    state,
    zipCode: parsed?.zipCode || zipCode,
  }
}

async function lookupViaZippopotam(zipCode: string): Promise<UsZipLocation | null> {
  const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zipCode)}`)
  if (!res.ok) return null
  const body = (await res.json()) as {
    places?: Array<{
      'place name'?: string
      'state abbreviation'?: string
      state?: string
    }>
  }
  const place = body.places?.[0]
  const city = (place?.['place name'] ?? '').trim()
  const state =
    usStateCodeFromLabel(place?.['state abbreviation'] ?? '') ||
    usStateCodeFromLabel(place?.state ?? '')
  if (!city || !state) return null
  return { city, state, zipCode }
}

export async function lookupCityStateFromUsZip(
  zipInput: string,
): Promise<UsZipLocation | null> {
  const zipCode = normalizeUsZip(zipInput)
  if (!zipCode) return null

  try {
    const fromGoogle = await lookupViaGoogle(zipCode)
    if (fromGoogle) return fromGoogle
  } catch {
    // fall through
  }

  try {
    return await lookupViaZippopotam(zipCode)
  } catch {
    return null
  }
}
