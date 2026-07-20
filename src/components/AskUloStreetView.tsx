import { useEffect, useId, useRef, useState } from 'react'
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'

type AskUloStreetViewProps = {
  address: string | null
  lat?: number | null
  lng?: number | null
  label?: string | null
}

type ViewMode = 'street-js' | 'street-embed' | 'map' | 'satellite' | 'unavailable'

function streetViewEmbedUrl(lat: number, lng: number): string {
  // Classic interactive Street View embed (works without Maps JS key).
  return (
    `https://www.google.com/maps?layer=c&cbll=${lat},${lng}` +
    `&cbp=11,0,0,0,0&output=svembed`
  )
}

function mapEmbedUrl(query: string, satellite: boolean): string {
  return satellite
    ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed&t=k`
    : `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
}

/**
 * Interactive Google Street View for market analysis (Zillow-style neighborhood peek).
 * Prefers Maps JS StreetViewPanorama when VITE_GOOGLE_MAPS_API_KEY is set;
 * otherwise uses an interactive Street View embed when coordinates are known.
 */
export function AskUloStreetView({ address, lat, lng, label }: AskUloStreetViewProps) {
  const titleId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ViewMode>(() => {
    if (lat != null && lng != null) return 'street-embed'
    return 'street-js'
  })
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  const query = address?.trim() || (lat != null && lng != null ? `${lat},${lng}` : null)
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)

  useEffect(() => {
    let cancelled = false
    let panorama: google.maps.StreetViewPanorama | null = null

    async function mount() {
      if (!query) {
        setStatus('error')
        setMode('unavailable')
        setMessage('No property address available for Street View.')
        return
      }

      const apiKey = resolveGoogleMapsApiKey()

      // No Maps JS key: interactive embed when we have coordinates.
      if (!apiKey) {
        if (hasCoords) {
          setMode('street-embed')
          setStatus('ready')
          setMessage(null)
          return
        }
        setMode('map')
        setStatus('fallback')
        setMessage('Showing map view. Add VITE_GOOGLE_MAPS_API_KEY for full Street View controls.')
        return
      }

      // Need a mount node for the JS panorama.
      if (!containerRef.current) {
        if (hasCoords) {
          setMode('street-embed')
          setStatus('ready')
          return
        }
        setMode('map')
        setStatus('fallback')
        return
      }

      try {
        setMode('street-js')
        const g = await loadGoogleMapsApi(apiKey)
        if (cancelled || !containerRef.current) return

        let location: google.maps.LatLngLiteral | null =
          hasCoords ? { lat: lat!, lng: lng! } : null

        if (!location && address) {
          const geocoder = new g.maps.Geocoder()
          const geo = await geocoder.geocode({ address })
          const first = geo.results[0]?.geometry?.location
          if (first) location = { lat: first.lat(), lng: first.lng() }
        }

        if (!location) {
          setMode('map')
          setStatus('fallback')
          setMessage('Could not locate this address for Street View. Showing map view.')
          return
        }

        const sv = new g.maps.StreetViewService()
        const panoData = await new Promise<google.maps.StreetViewPanoramaData | null>(
          (resolve) => {
            sv.getPanorama(
              { location, radius: 100, sourcePreference: g.maps.StreetViewPreference.NEAREST },
              (data, panoStatus) => {
                if (panoStatus === g.maps.StreetViewStatus.OK && data) resolve(data)
                else resolve(null)
              },
            )
          },
        )

        if (cancelled || !containerRef.current) return

        if (!panoData?.location?.latLng) {
          if (hasCoords) {
            setMode('street-embed')
            setStatus('fallback')
            setMessage('Native Street View panorama unavailable — using embedded Street View.')
            return
          }
          setMode('satellite')
          setStatus('fallback')
          setMessage('Street View is not available for this location. Showing satellite view.')
          return
        }

        panorama = new g.maps.StreetViewPanorama(containerRef.current, {
          position: panoData.location.latLng,
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          addressControl: true,
          linksControl: true,
          panControl: true,
          enableCloseButton: false,
          fullscreenControl: true,
          motionTracking: false,
        })
        setMode('street-js')
        setStatus('ready')
        setMessage(null)
      } catch (err) {
        console.error('[AskUloStreetView]', err)
        if (cancelled) return
        if (hasCoords) {
          setMode('street-embed')
          setStatus('fallback')
          setMessage(null)
          return
        }
        setMode('map')
        setStatus('fallback')
        setMessage('Street View failed to load. Showing map view instead.')
      }
    }

    void mount()
    return () => {
      cancelled = true
      panorama = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [address, lat, lng, query, hasCoords])

  if (!query) return null

  const iframeSrc =
    mode === 'street-embed' && hasCoords
      ? streetViewEmbedUrl(lat!, lng!)
      : mode === 'satellite'
        ? mapEmbedUrl(query, true)
        : mode === 'map'
          ? mapEmbedUrl(query, false)
          : null

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
      {message ? (
        <p className="mb-2 text-[12px] leading-4 text-[#6a7282]">{message}</p>
      ) : null}

      {mode === 'street-js' ? (
        <div
          ref={containerRef}
          className="h-[280px] w-full overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-[#f3f4f6] sm:h-[320px]"
          role="application"
          aria-label="Interactive Street View"
        />
      ) : mode === 'unavailable' ? (
        <div className="rounded-[12px] border border-dashed border-[#e5e7eb] bg-[#f9fafb] px-4 py-6 text-center text-[13px] text-[#6a7282]">
          Street View is not available for this location.
        </div>
      ) : iframeSrc ? (
        <iframe
          title={
            mode === 'street-embed'
              ? 'Interactive Street View'
              : mode === 'satellite'
                ? 'Satellite map'
                : 'Map view'
          }
          src={iframeSrc}
          className="h-[280px] w-full rounded-[12px] border border-[#e5e7eb] sm:h-[320px]"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : null}

      {status === 'loading' && mode === 'street-js' ? (
        <p className="mt-2 text-[12px] text-[#9ca3af]">Loading Street View…</p>
      ) : null}
    </section>
  )
}
