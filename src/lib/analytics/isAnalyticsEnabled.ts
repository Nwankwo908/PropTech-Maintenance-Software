/**
 * Analytics run only on the production Ulo site after a production Vite build.
 * Local `npm run dev`, Vitest, staging hosts, and Vercel previews always no-op.
 */

const PRODUCTION_HOSTS = new Set(['ulohome.io', 'www.ulohome.io', 'app.ulohome.io'])
const BLOCKED_HOST_PREFIX_RE = /^(staging|preview|dev|test|qa)\./i

export function isProductionAnalyticsHost(hostname: string | null | undefined): boolean {
  const host = (hostname ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false
  if (BLOCKED_HOST_PREFIX_RE.test(host)) return false
  return PRODUCTION_HOSTS.has(host)
}

export function isAnalyticsEnabled(): boolean {
  try {
    if (!import.meta.env.PROD) return false
    if (import.meta.env.MODE !== 'production') return false
    if (typeof window === 'undefined') return false
    return isProductionAnalyticsHost(window.location.hostname)
  } catch {
    return false
  }
}
