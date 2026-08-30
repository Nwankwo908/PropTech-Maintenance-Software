import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'

const MILES_TO_METERS = 1609.34
const MAP_LOAD_MS = 8000
const DEFAULT_PULSE_MILES = 10
const PULSE_MS = 2200

type VendorServiceAreaMapProps = {
  queries: string[]
  radiusMiles: number | null
  emptyHint: string
  className?: string
}

function embedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=11&output=embed`
}

function geocodeOne(
  geocoder: google.maps.Geocoder,
  address: string,
  timeoutMs: number,
): Promise<google.maps.LatLngLiteral | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs)
    try {
      geocoder.geocode({ address }, (results, status) => {
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

function startRadiusPulse(
  g: typeof google,
  map: google.maps.Map,
  center: google.maps.LatLngLiteral,
  baseMeters: number,
  isCancelled: () => boolean,
): () => void {
  const core = new g.maps.Circle({
    map,
    center,
    radius: baseMeters,
    strokeColor: '#186179',
    strokeOpacity: 0.85,
    strokeWeight: 2,
    fillColor: '#186179',
    fillOpacity: 0.14,
    clickable: false,
  })
  const ring = new g.maps.Circle({
    map,
    center,
    radius: baseMeters * 0.55,
    strokeColor: '#186179',
    strokeOpacity: 0.55,
    strokeWeight: 1.5,
    fillColor: '#186179',
    fillOpacity: 0.1,
    clickable: false,
  })

  let frame = 0
  const started = performance.now()

  const tick = (now: number) => {
    if (isCancelled()) return
    const t = ((now - started) % PULSE_MS) / PULSE_MS
    const breathe = 0.5 - 0.5 * Math.cos(t * Math.PI * 2)
    core.setRadius(baseMeters * (0.94 + 0.08 * breathe))
    core.setOptions({
      fillOpacity: 0.1 + 0.1 * breathe,
      strokeOpacity: 0.55 + 0.35 * breathe,
    })
    ring.setRadius(baseMeters * (0.55 + 0.7 * t))
    ring.setOptions({
      fillOpacity: 0.16 * (1 - t),
      strokeOpacity: 0.55 * (1 - t),
    })
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)

  return () => {
    window.cancelAnimationFrame(frame)
    core.setMap(null)
    ring.setMap(null)
  }
}

function CssPulseOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      <span className="absolute size-36 rounded-full border-2 border-[#186179]/45 animate-ping" />
      <span className="size-3 rounded-full bg-[#186179] shadow-[0_0_0_6px_rgba(24,97,121,0.2)]" />
    </div>
  )
}

export function VendorServiceAreaMap({
  queries,
  radiusMiles,
  emptyHint,
  className,
}: VendorServiceAreaMapProps) {
  const mapHostRef = useRef<HTMLDivElement>(null)
  const attachedRef = useRef(false)
  const queryKey = (queries ?? []).filter(Boolean).join('|')
  const uniqueQueries = useMemo(
    () => [...new Set(queryKey.split('|').map((query) => query.trim()).filter(Boolean))],
    [queryKey],
  )
  const embedQuery = uniqueQueries[0] ?? ''
  const [jsMapReady, setJsMapReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let stopPulse: (() => void) | null = null
    attachedRef.current = false
    setJsMapReady(false)

    if (uniqueQueries.length === 0) return undefined

    const apiKey = resolveGoogleMapsApiKey()
    if (!apiKey || !mapHostRef.current) return undefined

    async function mount() {
      try {
        const g = await Promise.race([
          loadGoogleMapsApi(apiKey),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('maps-timeout')), MAP_LOAD_MS)
          }),
        ])
        if (cancelled || !mapHostRef.current) return

        const geocoder = new g.maps.Geocoder()
        const points: google.maps.LatLngLiteral[] = []
        for (const query of uniqueQueries) {
          const point = await geocodeOne(geocoder, query, 4000)
          if (cancelled) return
          if (point) points.push(point)
        }
        if (cancelled || !mapHostRef.current || points.length === 0) return

        const center = points[0]!
        const map = new g.maps.Map(mapHostRef.current, {
          center,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
        attachedRef.current = true

        const bounds = new g.maps.LatLngBounds()
        for (const point of points) {
          try {
            new g.maps.Marker({ map, position: point })
          } catch {
            // Ignore missing Marker constructor.
          }
          bounds.extend(point)
        }

        const pulseMiles =
          radiusMiles != null && radiusMiles > 0 ? radiusMiles : DEFAULT_PULSE_MILES
        const baseMeters = pulseMiles * MILES_TO_METERS
        stopPulse = startRadiusPulse(g, map, center, baseMeters, () => cancelled)

        const pulseCircle = new g.maps.Circle({
          center,
          radius: baseMeters * 1.15,
        })
        const pulseBounds = pulseCircle.getBounds()
        if (pulseBounds) bounds.union(pulseBounds)

        if (!bounds.isEmpty()) map.fitBounds(bounds)
        if (!cancelled) setJsMapReady(true)
      } catch {
        // Embed iframe remains visible.
      }
    }

    void mount()
    return () => {
      cancelled = true
      stopPulse?.()
    }
  }, [uniqueQueries, radiusMiles])

  if (uniqueQueries.length === 0) {
    return (
      <div className={['flex items-center justify-center overflow-hidden rounded-[10px] bg-[#f9fafb] px-5', className ?? 'h-[280px]'].join(' ')}>
        <p className="text-center text-[13px] leading-5 text-[#6a7282]">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className={['relative w-full overflow-hidden rounded-[10px] bg-[#f3f4f6]', className ?? 'h-[280px]'].join(' ')}>
      <div
        ref={mapHostRef}
        className={jsMapReady ? 'h-full w-full' : 'pointer-events-none absolute h-full w-full opacity-0'}
      />
      {!jsMapReady ? (
        <>
          <iframe
            title="Vendor service area map"
            src={embedUrl(embedQuery)}
            className="h-full w-full border-0"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <CssPulseOverlay />
        </>
      ) : null}
    </div>
  )
}
