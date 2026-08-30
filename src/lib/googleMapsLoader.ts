/**
 * Load Google Maps JS API (Geocoder + Map + Street View) once per session.
 */

declare global {
  interface Window {
    google?: typeof google
    __uloGoogleMapsPromise?: Promise<typeof google>
    __uloGoogleMapsReady?: () => void
  }
}

const LOAD_TIMEOUT_MS = 10000
const POLL_MS = 80

export function resolveGoogleMapsApiKey(): string | null {
  const key =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
    import.meta.env.VITE_GOOGLE_PLACES_API_KEY?.trim() ||
    ''
  return key || null
}

function isGoogleMapsReady(): boolean {
  try {
    return typeof window.google?.maps?.importLibrary === 'function' ||
      typeof window.google?.maps?.Geocoder === 'function'
  } catch {
    return false
  }
}

async function importMapsLibraries(g: typeof google): Promise<void> {
  if (typeof g.maps.importLibrary !== 'function') return
  await Promise.allSettled([
    g.maps.importLibrary('maps'),
    g.maps.importLibrary('geocoding'),
    g.maps.importLibrary('streetView'),
  ])
}

export function loadGoogleMapsApi(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps requires a browser'))
  }
  if (window.__uloGoogleMapsPromise) return window.__uloGoogleMapsPromise

  if (isGoogleMapsReady() && window.google) {
    window.__uloGoogleMapsPromise = importMapsLibraries(window.google).then(() => window.google as typeof google)
    return window.__uloGoogleMapsPromise
  }

  const scriptPromise = new Promise<typeof google>((resolve, reject) => {
    let settled = false
    let pollTimer: number | undefined
    let timeoutTimer: number | undefined

    const cleanup = () => {
      if (pollTimer != null) window.clearInterval(pollTimer)
      if (timeoutTimer != null) window.clearTimeout(timeoutTimer)
    }

    const finishOk = () => {
      if (settled) return
      if (!isGoogleMapsReady() || !window.google) return
      settled = true
      cleanup()
      resolve(window.google)
    }

    const finishErr = (message = 'Google Maps script error') => {
      if (settled) return
      settled = true
      cleanup()
      window.__uloGoogleMapsPromise = undefined
      reject(new Error(message))
    }

    window.__uloGoogleMapsReady = () => finishOk()

    pollTimer = window.setInterval(() => {
      if (isGoogleMapsReady()) finishOk()
    }, POLL_MS)

    timeoutTimer = window.setTimeout(() => {
      if (isGoogleMapsReady()) finishOk()
      else finishErr('Google Maps timed out')
    }, LOAD_TIMEOUT_MS)

    const existing = document.querySelector<HTMLScriptElement>('script[data-ulo-google-maps]')
    if (existing) {
      if (isGoogleMapsReady()) {
        finishOk()
        return
      }
      existing.addEventListener('load', finishOk)
      existing.addEventListener('error', () => finishErr())
      return
    }

    const script = document.createElement('script')
    script.dataset.uloGoogleMaps = '1'
    script.async = true
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&callback=__uloGoogleMapsReady&loading=async`
    script.onerror = () => finishErr()
    document.head.appendChild(script)
  })

  window.__uloGoogleMapsPromise = scriptPromise.then(async (g) => {
    await importMapsLibraries(g)
    return g
  })

  return window.__uloGoogleMapsPromise
}
