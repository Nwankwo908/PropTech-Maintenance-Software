import { resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'

function shouldUseDevStreetViewProxy(explicit?: boolean): boolean {
  if (explicit != null) return explicit
  return Boolean(import.meta.env.DEV && typeof window !== 'undefined')
}

export function googleStreetViewStaticUrl(input: {
  apiKey?: string | null
  lat?: number | null
  lng?: number | null
  query?: string | null
  size?: string
  /** Same-origin Vite proxy (dev). Tests should leave this unset. */
  useDevProxy?: boolean
}): string | null {
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
    size: input.size ?? '800x640',
    location,
    fov: '90',
    return_error_code: 'true',
  })

  if (shouldUseDevStreetViewProxy(input.useDevProxy)) {
    return `/ulo-streetview?${params.toString()}`
  }

  const apiKey = input.apiKey?.trim() ?? ''
  if (!apiKey) return null
  params.set('key', apiKey)
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

/**
 * Localhost / LAN HTTP pages often send a Referer Google rejects (key allowlisted
 * for production or for empty referrers). Drop the referrer so Static Street View
 * can still load in `npm run dev`.
 */
export function streetViewStaticReferrerPolicy(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
): 'no-referrer' | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return 'no-referrer'
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'no-referrer'
  return undefined
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
