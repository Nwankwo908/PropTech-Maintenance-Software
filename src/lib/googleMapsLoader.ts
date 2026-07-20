/**
 * Load Google Maps JS API (Street View + Geocoder) once per session.
 */

declare global {
  interface Window {
    google?: typeof google
    __uloGoogleMapsPromise?: Promise<typeof google>
  }
}

export function resolveGoogleMapsApiKey(): string | null {
  const key =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
    import.meta.env.VITE_GOOGLE_PLACES_API_KEY?.trim() ||
    ''
  return key || null
}

export function loadGoogleMapsApi(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps requires a browser'))
  }
  if (window.google?.maps?.StreetViewPanorama) {
    return Promise.resolve(window.google)
  }
  if (window.__uloGoogleMapsPromise) return window.__uloGoogleMapsPromise

  window.__uloGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-ulo-google-maps]')
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.google?.maps) resolve(window.google)
        else reject(new Error('Google Maps failed to load'))
      })
      existing.addEventListener('error', () => reject(new Error('Google Maps script error')))
      return
    }

    const script = document.createElement('script')
    script.dataset.uloGoogleMaps = '1'
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    script.onload = () => {
      if (window.google?.maps) resolve(window.google)
      else reject(new Error('Google Maps failed to load'))
    }
    script.onerror = () => reject(new Error('Google Maps script error'))
    document.head.appendChild(script)
  })

  return window.__uloGoogleMapsPromise
}
