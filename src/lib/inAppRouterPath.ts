const ULO_PRODUCTION_HOSTS = new Set(['ulohome.io', 'www.ulohome.io', 'app.ulohome.io'])

function isNonProductionAppHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false
  return !ULO_PRODUCTION_HOSTS.has(host)
}

/**
 * Paths for React Router `navigate` / `<Link to>`.
 * Absolute URLs (including production Ulo hosts) become same-origin paths so
 * local/dev never does a full document load of app.ulohome.io.
 */
export function inAppRouterPath(to: string): string {
  const raw = to.trim()
  if (!raw) return '/'

  const asUrl = raw.startsWith('//')
    ? `https:${raw}`
    : /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)
      ? raw
      : null

  if (asUrl) {
    try {
      const url = new URL(asUrl)
      const path = `${url.pathname}${url.search}${url.hash}`
      return path.startsWith('/') ? path : `/${path}`
    } catch {
      return raw.startsWith('/') ? raw : `/${raw}`
    }
  }

  return raw.startsWith('/') ? raw : `/${raw}`
}

/** Explicit href on the current origin (avoids resolving `/admin/…` against www.ulohome.io). */
export function sameOriginHref(
  path: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const p = inAppRouterPath(path)
  const base = origin.replace(/\/$/, '')
  if (!base) return p
  return `${base}${p}`
}

/**
 * When browsing localhost, rewrite a production Ulo URL to an in-app path.
 * Used so property-card clicks cannot leave :5173/:5175 for www.ulohome.io.
 */
export function rewriteProductionUloHrefToPath(
  href: string,
  currentOrigin: string,
): string | null {
  let current: URL
  try {
    current = new URL(currentOrigin)
  } catch {
    return null
  }
  if (!isNonProductionAppHost(current.hostname)) return null

  let url: URL
  try {
    url = new URL(href, currentOrigin)
  } catch {
    return null
  }
  if (!ULO_PRODUCTION_HOSTS.has(url.hostname)) return null
  const path = `${url.pathname}${url.search}${url.hash}`
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Click path to keep localhost admin navigation in this SPA.
 * Covers production Ulo hrefs and relative `/admin/…` that a preview may
 * otherwise resolve against www.ulohome.io.
 */
export function localhostInAppClickPath(
  href: string,
  currentOrigin: string,
): string | null {
  const fromProd = rewriteProductionUloHrefToPath(href, currentOrigin)
  if (fromProd) return fromProd

  let current: URL
  try {
    current = new URL(currentOrigin)
  } catch {
    return null
  }
  if (!isNonProductionAppHost(current.hostname)) return null

  const raw = href.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
    return null
  }

  let url: URL
  try {
    url = new URL(raw, currentOrigin)
  } catch {
    return null
  }
  if (!url.pathname.startsWith('/admin')) return null
  if (url.origin !== current.origin && !ULO_PRODUCTION_HOSTS.has(url.hostname)) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

/** Rewrite a history URL so localhost never pushState/assign to www.ulohome.io. */
export function historyUrlOnLoopback(
  url: string,
  currentOrigin: string,
): string {
  return rewriteProductionUloHrefToPath(url, currentOrigin) ?? url
}

/**
 * Install before React boots. React Router falls back to location.assign when
 * pushState rejects a cross-origin URL — that is how localhost jumps to www.
 */
export function installLoopbackNavigationGuards(): void {
  if (typeof window === 'undefined') return
  if (!isNonProductionAppHost(window.location.hostname)) return
  const w = window as Window & { __uloLoopbackNavGuards?: boolean }
  if (w.__uloLoopbackNavGuards) return
  w.__uloLoopbackNavGuards = true

  const origin = () => window.location.origin
  const push = window.history.pushState.bind(window.history)
  window.history.pushState = function pushState(data, unused, url) {
    const next =
      url == null || url === '' ? url : historyUrlOnLoopback(String(url), origin())
    return push(data, unused, next)
  }

  const replace = window.history.replaceState.bind(window.history)
  window.history.replaceState = function replaceState(data, unused, url) {
    const next =
      url == null || url === '' ? url : historyUrlOnLoopback(String(url), origin())
    return replace(data, unused, next)
  }

  const assign = window.location.assign.bind(window.location)
  try {
    window.location.assign = (url: string | URL) => {
      const rewritten = rewriteProductionUloHrefToPath(String(url), origin())
      if (rewritten) {
        window.history.pushState(window.history.state, '', rewritten)
        return
      }
      assign(url)
    }
  } catch {
    // Some browsers freeze Location.prototype
  }

  const replaceLoc = window.location.replace.bind(window.location)
  try {
    window.location.replace = (url: string | URL) => {
      const rewritten = rewriteProductionUloHrefToPath(String(url), origin())
      if (rewritten) {
        window.history.replaceState(window.history.state, '', rewritten)
        return
      }
      replaceLoc(url)
    }
  } catch {
    // Some browsers freeze Location.prototype
  }
}
