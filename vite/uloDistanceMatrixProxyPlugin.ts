import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

/**
 * Dev/preview: Distance Matrix JSON via the Vite origin so vendor mileage
 * can use the Maps key without browser referrer / CORS issues.
 */
export function uloDistanceMatrixProxyPlugin(root: string): Plugin {
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
    if (pathOnly !== '/ulo-distance-matrix') {
      next()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end()
      return
    }

    const incoming = new URL(req.url ?? '', 'http://127.0.0.1')
    const origins = incoming.searchParams.get('origins')?.trim() ?? ''
    const destinations = incoming.searchParams.get('destinations')?.trim() ?? ''
    if (!origins || !destinations) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'missing origins or destinations' }))
      return
    }

    const env = loadEnv(mode, root, 'VITE_')
    const key =
      env.VITE_GOOGLE_MAPS_API_KEY?.trim() || env.VITE_GOOGLE_PLACES_API_KEY?.trim() || ''
    if (!key) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'missing maps key' }))
      return
    }

    const params = new URLSearchParams({
      origins,
      destinations,
      mode: 'driving',
      units: 'imperial',
      key,
    })

    try {
      const googleRes = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`,
      )
      const body = await googleRes.text()
      res.statusCode = googleRes.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
    } catch {
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'distance matrix upstream failed' }))
    }
  }

  return {
    name: 'ulo-distance-matrix-proxy',
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
