import { useEffect } from 'react'
import { localhostInAppClickPath, sameOriginHref } from '@/lib/inAppRouterPath'

/**
 * On localhost, keep clicks that target production Ulo hosts (www/app) inside
 * this SPA origin via a full document load. Does not touch same-origin `/admin`
 * links — those are handled by React Router or assignAdminPath.
 *
 * Uses location.assign (not navigate) so a stale React Router instance cannot
 * silently swallow the click after HMR / long sessions.
 */
export function StayOnDevOrigin() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const raw = anchor.getAttribute('href')
      if (!raw) return
      const path = localhostInAppClickPath(raw, window.location.origin)
      if (!path) return

      event.preventDefault()
      window.location.assign(sameOriginHref(path))
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return null
}
