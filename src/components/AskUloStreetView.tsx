import { useEffect, useId, useRef, useState } from 'react'
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'

type AskUloStreetViewProps = {
  address: string | null
  lat?: number | null
  lng?: number | null
  label?: string | null
  /** Skip the Ask Ulo heading; fill a parent card instead. */
  embedded?: boolean
  frameClassName?: string
}

type LatLng = { lat: number; lng: number }

function streetViewEmbedUrl(lat: number, lng: number): string {
  return (
    `https://www.google.com/maps?layer=c&cbll=${lat},${lng}` +
    `&cbp=11,0,0,0,0&output=svembed`
  )
}

function streetViewAddressEmbedUrl(query: string): string {
  return (
    `https://www.google.com/maps?q=${encodeURIComponent(query)}` +
    `&layer=c&cbp=11,0,0,0,0&output=svembed`
  )
}

function geocodeQueries(address: string, label: string | null | undefined): string[] {
  const primary = address.trim()
  const name = label?.trim() ?? ''
  const queries = [primary]
  if (name && !primary.toLowerCase().includes(name.toLowerCase())) {
    queries.push(`${name}, ${primary}`)
  }
  if (!/united states|, usa\b/i.test(primary)) {
    queries.push(`${primary}, USA`)
  }
  return [...new Set(queries.filter(Boolean))]
}

async function geocodeGoogleJs(
  g: typeof google,
  address: string,
  timeoutMs: number,
): Promise<LatLng | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs)
    try {
      const geocoder = new g.maps.Geocoder()
      geocoder.geocode({ address, region: 'us' }, (results, status) => {
        window.clearTimeout(timer)
        const loc = status === 'OK' ? results?.[0]?.geometry?.location : null
        resolve(loc ? { lat: loc.lat(), lng: loc.lng() } : null)
      })
    } catch {
      window.clearTimeout(timer)
      resolve(null)
    }
  })
}

async function geocodeGoogleHttp(address: string, apiKey: string): Promise<LatLng | null> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
      `&region=us&key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
    }
    const loc = data.results?.[0]?.geometry?.location
    const lat = Number(loc?.lat)
    const lng = Number(loc?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

async function geocodeNominatim(address: string): Promise<LatLng | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=` +
      encodeURIComponent(address)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>
    const first = data[0]
    const lat = Number(first?.lat)
    const lng = Number(first?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

async function resolveLatLng(input: {
  g: typeof google | null
  apiKey: string | null
  address: string
  label?: string | null
}): Promise<LatLng | null> {
  for (const query of geocodeQueries(input.address, input.label)) {
    if (input.g) {
      const fromJs = await geocodeGoogleJs(input.g, query, 6000)
      if (fromJs) return fromJs
    }
    if (input.apiKey) {
      const fromHttp = await geocodeGoogleHttp(query, input.apiKey)
      if (fromHttp) return fromHttp
    }
    const fromOsm = await geocodeNominatim(query)
    if (fromOsm) return fromOsm
  }
  return null
}

function lookupPanorama(
  g: typeof google,
  location: LatLng,
  timeoutMs: number,
): Promise<google.maps.StreetViewPanoramaData | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs)
    try {
      const sv = new g.maps.StreetViewService()
      sv.getPanorama({ location, radius: 250 }, (data, panoStatus) => {
        window.clearTimeout(timer)
        if (panoStatus === g.maps.StreetViewStatus.OK && data) resolve(data)
        else resolve(null)
      })
    } catch {
      window.clearTimeout(timer)
      resolve(null)
    }
  })
}

/**
 * Street View for a property address. Prefers the official embed (works with an address
 * or lat/lng). Upgrades to Maps JS StreetViewPanorama when that loads.
 */
export function AskUloStreetView({
  address,
  lat,
  lng,
  label,
  embedded = false,
  frameClassName,
}: AskUloStreetViewProps) {
  const titleId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [jsReady, setJsReady] = useState(false)
  const [resolved, setResolved] = useState<LatLng | null>(null)

  const query = address?.trim() || (lat != null && lng != null ? `${lat},${lng}` : null)
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
  const apiKey = resolveGoogleMapsApiKey()
  const viewLat = hasCoords ? lat! : resolved?.lat
  const viewLng = hasCoords ? lng! : resolved?.lng

  useEffect(() => {
    let cancelled = false
    let panorama: google.maps.StreetViewPanorama | null = null
    setJsReady(false)
    setResolved(hasCoords ? { lat: lat!, lng: lng! } : null)

    async function mount() {
      if (!query) return

      let g: typeof google | null = null
      if (apiKey) {
        try {
          g = await loadGoogleMapsApi(apiKey)
        } catch {
          g = null
        }
      }
      if (cancelled) return

      let location: LatLng | null = hasCoords ? { lat: lat!, lng: lng! } : null
      if (!location && address) {
        location = await resolveLatLng({ g, apiKey, address, label })
      }
      if (cancelled) return
      if (location) setResolved(location)

      if (!g || !location || !containerRef.current) return

      const panoData = await lookupPanorama(g, location, 8000)
      if (cancelled || !containerRef.current) return
      const position = panoData?.location?.latLng
      if (!position) return

      panorama = new g.maps.StreetViewPanorama(containerRef.current, {
        position,
        pov: { heading: 0, pitch: 0 },
        zoom: 1,
        addressControl: true,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: true,
        motionTracking: false,
      })
      setJsReady(true)
    }

    void mount()
    return () => {
      cancelled = true
      panorama = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [address, apiKey, hasCoords, label, lat, lng, query])

  if (!query) return null

  const iframeSrc =
    viewLat != null && viewLng != null
      ? streetViewEmbedUrl(viewLat, viewLng)
      : streetViewAddressEmbedUrl(query)

  const defaultFrameClass =
    'h-[280px] w-full overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-[#f3f4f6] sm:h-[320px]'
  const frameClass = frameClassName ?? defaultFrameClass

  const viewer = (
    <div className={`relative w-full overflow-hidden bg-[#f3f4f6] ${frameClass}`}>
      <div
        ref={containerRef}
        className={jsReady ? 'h-full w-full' : 'pointer-events-none absolute inset-0 opacity-0'}
        role="application"
        aria-label="Interactive Street View"
      />
      {!jsReady ? (
        <iframe
          title="Street View"
          src={iframeSrc}
          className="h-full w-full border-0"
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : null}
    </div>
  )

  if (embedded) {
    return <div className="min-w-0">{viewer}</div>
  }

  return (
    <section aria-labelledby={titleId} className="mt-4">
      <h2
        id={titleId}
        className="mb-1.5 text-[15px] font-semibold leading-5 tracking-[-0.15px] text-[#0a0a0a]"
      >
        Street View
      </h2>
      {label || address ? (
        <p className="mb-2 text-[12px] leading-4 text-[#6a7282]">
          {label ? `${label} · ` : null}
          {address ?? query}
        </p>
      ) : null}
      {viewer}
    </section>
  )
}
