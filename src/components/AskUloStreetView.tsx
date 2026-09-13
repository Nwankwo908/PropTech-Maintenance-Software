import { useEffect, useId, useRef, useState } from 'react'
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'
import {
  googleStreetViewEmbedUrl,
  googleStreetViewStaticUrl,
  streetViewStaticReferrerPolicy,
} from '@/lib/streetViewUrls'

type AskUloStreetViewProps = {
  address: string | null
  lat?: number | null
  lng?: number | null
  label?: string | null
  /** Skip the Ask Ulo heading; fill a parent card instead. */
  embedded?: boolean
  /** Maps JS panorama. Overview skips this — Static Street View is enough and avoids ApiNotActivatedMapError. */
  interactive?: boolean
  frameClassName?: string
}

type LatLng = { lat: number; lng: number }

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
  address: string
  label?: string | null
}): Promise<LatLng | null> {
  for (const query of geocodeQueries(input.address, input.label)) {
    if (input.g) {
      const fromJs = await geocodeGoogleJs(input.g, query, 6000)
      if (fromJs) return fromJs
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

function mapsJsAuthErrorIn(el: HTMLElement | null): boolean {
  if (!el) return false
  return Boolean(el.querySelector('.gm-err-container'))
}

/**
 * Street View for a property address.
 * Uses Maps JS only when it authenticates. Otherwise a static Street View image
 * (never the unofficial maps embed that shows “didn’t load Google Maps correctly”).
 */
export function AskUloStreetView({
  address,
  lat,
  lng,
  label,
  embedded = false,
  interactive = true,
  frameClassName,
}: AskUloStreetViewProps) {
  const titleId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const query = address?.trim() || (lat != null && lng != null ? `${lat},${lng}` : null)
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
  const [jsReady, setJsReady] = useState(false)
  const [resolved, setResolved] = useState<LatLng | null>(null)
  const [staticMode, setStaticMode] = useState<'coords' | 'address'>(
    hasCoords ? 'coords' : 'address',
  )
  const [staticFailed, setStaticFailed] = useState(false)
  const [jsAttempted, setJsAttempted] = useState(false)

  const apiKey = resolveGoogleMapsApiKey()
  const viewLat = resolved?.lat ?? (hasCoords ? lat! : null)
  const viewLng = resolved?.lng ?? (hasCoords ? lng! : null)

  useEffect(() => {
    let cancelled = false
    let panorama: google.maps.StreetViewPanorama | null = null
    let authFailed = false
    setJsReady(false)
    setJsAttempted(false)
    setStaticFailed(false)
    setStaticMode(hasCoords ? 'coords' : 'address')
    setResolved(hasCoords ? { lat: lat!, lng: lng! } : null)

    const previousAuth = window.gm_authFailure
    window.gm_authFailure = () => {
      authFailed = true
      setJsReady(false)
      if (typeof previousAuth === 'function') previousAuth()
    }

    async function mount() {
      if (!query) {
        if (!cancelled) setJsAttempted(true)
        return
      }

      let g: typeof google | null = null
      if (apiKey && interactive) {
        try {
          g = await loadGoogleMapsApi(apiKey)
        } catch {
          g = null
        }
      }
      if (cancelled) return

      let location: LatLng | null = hasCoords ? { lat: lat!, lng: lng! } : null
      if (address) {
        const geocoded = await resolveLatLng({ g: authFailed ? null : g, address, label })
        if (geocoded) location = geocoded
      }
      if (cancelled) return
      if (location) setResolved(location)

      if (g && location && containerRef.current && !authFailed) {
        let panoData = await lookupPanorama(g, location, 8000)
        if (!panoData && address && hasCoords) {
          const geocoded = await resolveLatLng({ g, address, label })
          if (geocoded) {
            location = geocoded
            if (!cancelled) setResolved(geocoded)
            panoData = await lookupPanorama(g, geocoded, 8000)
          }
        }
        if (!cancelled && containerRef.current && !authFailed) {
          const position = panoData?.location?.latLng
          if (position) {
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
            await new Promise((resolve) => window.setTimeout(resolve, 400))
            if (!cancelled && !authFailed && !mapsJsAuthErrorIn(containerRef.current)) {
              setJsReady(true)
            } else {
              containerRef.current?.replaceChildren()
            }
          }
        }
      }

      if (!cancelled) setJsAttempted(true)
    }

    void mount()
    return () => {
      cancelled = true
      panorama = null
      window.gm_authFailure = previousAuth
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [address, apiKey, hasCoords, interactive, label, lat, lng, query])

  if (!query) return null

  const staticSrc = !staticFailed
    ? googleStreetViewStaticUrl({
        apiKey: apiKey ?? '',
        lat: staticMode === 'coords' ? viewLat : null,
        lng: staticMode === 'coords' ? viewLng : null,
        query: typeof address === 'string' ? address : query,
      })
    : null

  const defaultFrameClass =
    'h-[280px] w-full overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-[#f3f4f6] sm:h-[320px]'
  const frameClass = frameClassName ?? defaultFrameClass

  const embedSrc =
    interactive &&
    jsAttempted &&
    !jsReady &&
    apiKey &&
    viewLat != null &&
    viewLng != null
      ? googleStreetViewEmbedUrl({
          apiKey,
          lat: viewLat,
          lng: viewLng,
        })
      : null

  const fallback = embedSrc ? (
    <iframe
      title={`Street View of ${address ?? query}`}
      className="absolute inset-0 h-full w-full border-0"
      src={embedSrc}
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-popups"
      referrerPolicy="origin"
    />
  ) : staticSrc ? (
    <img
      src={staticSrc}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      referrerPolicy={streetViewStaticReferrerPolicy()}
      onError={() => {
        if (staticMode === 'coords' && (typeof address === 'string' ? address.trim() : '')) {
          setStaticMode('address')
          return
        }
        setStaticFailed(true)
      }}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-4 text-center">
      <p className="text-[13px] leading-5 text-[#6a7282]">Loading Street View…</p>
    </div>
  )

  const viewer = (
    <div className={`relative w-full overflow-hidden bg-[#f3f4f6] ${frameClass}`}>
      <div
        ref={containerRef}
        className={
          jsReady
            ? 'absolute inset-0 z-10 h-full w-full'
            : 'pointer-events-none absolute inset-0 z-0 h-full w-full opacity-0'
        }
      />
      {!jsReady ? fallback : null}
    </div>
  )

  if (embedded) {
    return <div className="h-full min-h-[240px] min-w-0">{viewer}</div>
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
