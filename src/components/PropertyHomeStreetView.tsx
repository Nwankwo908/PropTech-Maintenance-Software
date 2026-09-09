import { useEffect, useState } from 'react'
import {
  allowInteractiveStreetViewEmbed,
  geocodeAddressNominatim,
  googleMapsSearchUrl,
  googleMapsStreetViewPageUrl,
  googleStreetViewEmbedUrl,
  googleStreetViewStaticUrl,
  streetViewApiKey,
} from '@/lib/streetViewUrls'

type PropertyHomeStreetViewProps = {
  address: string
  lat?: number | null
  lng?: number | null
  label?: string | null
}

type LatLng = { lat: number; lng: number }

function coordsFromProps(lat?: number | null, lng?: number | null): LatLng | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Official Google Street View embed. Page scroll works until the user clicks to pan. */
export function PropertyHomeStreetView({
  address,
  lat,
  lng,
  label,
}: PropertyHomeStreetViewProps) {
  const fromProps = coordsFromProps(lat, lng)
  const [geocoded, setGeocoded] = useState<LatLng | null>(null)
  const [geocodeDone, setGeocodeDone] = useState(Boolean(fromProps))
  const [interactive, setInteractive] = useState(false)
  const apiKey = streetViewApiKey()

  useEffect(() => {
    if (fromProps) {
      setGeocoded(fromProps)
      setGeocodeDone(true)
      return
    }
    let cancelled = false
    setGeocoded(null)
    setGeocodeDone(false)
    void geocodeAddressNominatim(address).then((result) => {
      if (cancelled) return
      setGeocoded(result)
      setGeocodeDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [address, lat, lng])

  const resolved = fromProps ?? geocoded
  const openUrl = resolved
    ? googleMapsStreetViewPageUrl(resolved.lat, resolved.lng)
    : googleMapsSearchUrl(address)
  const stillUrl =
    apiKey && resolved
      ? googleStreetViewStaticUrl({
          apiKey,
          lat: resolved.lat,
          lng: resolved.lng,
        })
      : apiKey
        ? googleStreetViewStaticUrl({ apiKey, query: address })
        : null
  const allowEmbed = allowInteractiveStreetViewEmbed() && import.meta.env.PROD

  if (apiKey && resolved && allowEmbed) {
    return (
      <div
        className="relative h-full w-full overflow-hidden bg-[#f3f4f6] [contain:strict]"
        onMouseLeave={() => setInteractive(false)}
      >
        <iframe
          title={label ? `${label} Street View` : 'Street View'}
          src={googleStreetViewEmbedUrl({
            apiKey,
            lat: resolved.lat,
            lng: resolved.lng,
          })}
          className={`absolute inset-0 h-full w-full border-0 bg-[#f3f4f6] ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
          loading="eager"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          tabIndex={interactive ? 0 : -1}
          allow="accelerometer; gyroscope; magnetometer"
        />
        {!interactive ? (
          <button
            type="button"
            className="absolute inset-0 z-[1] cursor-grab bg-transparent"
            aria-label="Click to pan Street View. Scroll the page to see property facts below."
            onClick={() => setInteractive(true)}
          />
        ) : null}
      </div>
    )
  }

  if (stillUrl) {
    return (
      <div className="relative h-full min-h-[240px] w-full overflow-hidden bg-[#f3f4f6]">
        <img
          src={stillUrl}
          alt={label ? `${label} Street View` : 'Street View'}
          className="h-full min-h-[240px] w-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    )
  }

  if (!geocodeDone) {
    return (
      <div className="flex h-[220px] items-center justify-center bg-[#f3f4f6]">
        <p className="text-[13px] text-[#6a7282]">Loading Street View…</p>
      </div>
    )
  }

  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 bg-[#f3f4f6] px-6 text-center">
      <p className="text-[13px] leading-5 text-[#6a7282]">
        {apiKey
          ? 'Street View isn’t available for this address.'
          : 'Street View needs a Google Maps key in this session.'}
      </p>
      <a
        href={openUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="sa-link text-[13px] font-medium text-[#186179] hover:text-[#0f4a5c]"
      >
        Open Street View in Google Maps
      </a>
    </div>
  )
}
