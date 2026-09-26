/**
 * Resolve US city + state from a ZIP via Google Geocoder (Maps already loaded for the app).
 */
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'
import {
  parseGooglePlaceAddress,
  type GooglePlaceAddressComponent,
} from '@/lib/parseGooglePlaceAddress'

export type UsZipLocation = {
  city: string
  state: string
  zipCode: string
}

function normalizeZip(input: string): string | null {
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

export async function lookupCityStateFromUsZip(
  zipInput: string,
): Promise<UsZipLocation | null> {
  const zipCode = normalizeZip(zipInput)
  if (!zipCode) return null

  const apiKey = resolveGoogleMapsApiKey()
  if (!apiKey) return null

  try {
    const g = await loadGoogleMapsApi(apiKey)
    if (typeof g.maps.importLibrary === 'function') {
      await g.maps.importLibrary('geocoding').catch(() => undefined)
    }
    const geocoder = new g.maps.Geocoder()
    const result = await new Promise<google.maps.GeocoderResult | null>((resolve) => {
      geocoder.geocode(
        {
          address: zipCode,
          componentRestrictions: { country: 'US', postalCode: zipCode },
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
    if (!parsed?.city || !parsed.state) return null
    return {
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode || zipCode,
    }
  } catch {
    return null
  }
}
