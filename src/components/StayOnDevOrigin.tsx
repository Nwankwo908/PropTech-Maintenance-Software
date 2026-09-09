import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { localhostInAppClickPath } from '@/lib/inAppRouterPath'

/**
 * On localhost, keep admin link clicks in this SPA. Relative `/admin/…` hrefs
 * can otherwise resolve to www.ulohome.io in some previews.
 */
export function StayOnDevOrigin() {
  const navigate = useNavigate()

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
      navigate(path)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [navigate])

  return null
}
