import { resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'

export function googleStreetViewStaticUrl(input: {
  apiKey: string
  lat?: number | null
  lng?: number | null
  query?: string | null
  size?: string
}): string | null {
  const apiKey = input.apiKey.trim()
  if (!apiKey) return null
  const hasCoords =
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  const location = hasCoords
    ? `${input.lat},${input.lng}`
    : input.query?.trim() || ''
  if (!location) return null
  const params = new URLSearchParams({
    size: input.size ?? '640x420',
    location,
    fov: '80',
    source: 'outdoor',
    key: apiKey,
  })
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
}

export function googleStreetViewEmbedUrl(input: {
  apiKey: string
  lat: number
  lng: number
  heading?: number
  pitch?: number
  fov?: number
}): string {
  const params = new URLSearchParams({
    key: input.apiKey.trim(),
    location: `${input.lat},${input.lng}`,
    heading: String(input.heading ?? 0),
    pitch: String(input.pitch ?? 0),
    fov: String(input.fov ?? 80),
  })
  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`
}

export function googleMapsStreetViewPageUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
}

export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function streetViewApiKey(): string | null {
  return resolveGoogleMapsApiKey()
}

/**
 * Maps Embed can send the top tab to www.ulohome.io when the API key’s
 * allowed referrer is the live site. Only use that iframe on production Ulo
 * hosts after a production build — never during `npm run dev`.
 */
export function allowInteractiveStreetViewEmbed(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  isDev: boolean = import.meta.env.DEV,
): boolean {
  if (isDev) return false
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return host === 'ulohome.io' || host === 'www.ulohome.io' || host === 'app.ulohome.io'
}

export async function geocodeAddressNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  const query = address.trim()
  if (!query) return null
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=` +
      encodeURIComponent(query)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>
    const lat = Number(data[0]?.lat)
    const lng = Number(data[0]?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}
