import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

/**
 * Dev/preview: browser loads Street View from the Vite origin so Google’s
 * HTTP-referrer rules on the Maps key cannot blank the Overview pane.
 */
export function uloStreetViewProxyPlugin(root: string): Plugin {
  async function handle(
    req: { method?: string; url?: string },
    res: {
      statusCode: number
      setHeader: (name: string, value: string) => void
      end: (body?: Buffer | string) => void
    },
    next: () => void,
    mode: string,
  ) {
    const pathOnly = (req.url ?? '').split('?')[0]
    if (pathOnly !== '/ulo-streetview') {
      next()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end()
      return
    }

    const incoming = new URL(req.url ?? '', 'http://127.0.0.1')
    const location = incoming.searchParams.get('location')?.trim() ?? ''
    if (!location) {
      res.statusCode = 400
      res.end()
      return
    }

    const env = loadEnv(mode, root, 'VITE_')
    const key =
      env.VITE_GOOGLE_MAPS_API_KEY?.trim() || env.VITE_GOOGLE_PLACES_API_KEY?.trim() || ''
    if (!key) {
      res.statusCode = 503
      res.end()
      return
    }

    const params = new URLSearchParams({
      size: incoming.searchParams.get('size')?.trim() || '800x640',
      location,
      fov: incoming.searchParams.get('fov')?.trim() || '90',
      return_error_code: 'true',
      key,
    })
    const source = incoming.searchParams.get('source')?.trim()
    if (source) params.set('source', source)

    try {
      const googleRes = await fetch(
        `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
      )
      const body = Buffer.from(await googleRes.arrayBuffer())
      res.statusCode = googleRes.status
      res.setHeader(
        'Content-Type',
        googleRes.headers.get('content-type') || 'image/jpeg',
      )
      res.setHeader('Cache-Control', 'public, max-age=600')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
    } catch {
      res.statusCode = 502
      res.end()
    }
  }

  return {
    name: 'ulo-streetview-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next, server.config.mode)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next, 'production')
      })
    },
  }
}
