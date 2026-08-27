import { useEffect } from 'react'
import { DEFAULT_ULO_APP_ORIGIN, uloAppUrl } from '@/lib/uloAppUrl'

export const LANDING_DOCUMENT_TITLE = 'Ulo — SMS-first maintenance for independent landlords'

export const LANDING_DOCUMENT_DESCRIPTION =
  'Tenants text a repair. Ulo classifies the issue, coordinates vendors, and gives independent landlords one dashboard across every property.'

function setMetaContent(selector: string, content: string): string | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const previous = el.getAttribute('content')
  el.setAttribute('content', content)
  return previous
}

/**
 * Sets document title, description, and canonical for public pages.
 * Restores the previous values on unmount (SPA navigations).
 */
export function useDocumentMeta(options: {
  title: string
  description?: string
  canonicalPath?: string
}) {
  const { title, description, canonicalPath } = options

  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    const previousDescription =
      description != null ? setMetaContent('meta[name="description"]', description) : null
    const previousOgTitle = setMetaContent('meta[property="og:title"]', title)
    const previousTwitterTitle = setMetaContent('meta[name="twitter:title"]', title)
    const previousOgDescription =
      description != null ? setMetaContent('meta[property="og:description"]', description) : null
    const previousTwitterDescription =
      description != null ? setMetaContent('meta[name="twitter:description"]', description) : null

    const canonical = document.querySelector('link[rel="canonical"]')
    const previousCanonical = canonical?.getAttribute('href') ?? null
    const previousOgUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null
    if (canonicalPath != null && canonical) {
      const href = uloAppUrl.absolute(canonicalPath, DEFAULT_ULO_APP_ORIGIN)
      canonical.setAttribute('href', href)
      const ogUrl = document.querySelector('meta[property="og:url"]')
      ogUrl?.setAttribute('content', href)
    }

    return () => {
      document.title = previousTitle
      if (previousDescription != null) {
        setMetaContent('meta[name="description"]', previousDescription)
      }
      if (previousOgTitle != null) setMetaContent('meta[property="og:title"]', previousOgTitle)
      if (previousTwitterTitle != null) {
        setMetaContent('meta[name="twitter:title"]', previousTwitterTitle)
      }
      if (previousOgDescription != null) {
        setMetaContent('meta[property="og:description"]', previousOgDescription)
      }
      if (previousTwitterDescription != null) {
        setMetaContent('meta[name="twitter:description"]', previousTwitterDescription)
      }
      if (canonical && previousCanonical != null) {
        canonical.setAttribute('href', previousCanonical)
      }
      if (previousOgUrl != null) {
        document.querySelector('meta[property="og:url"]')?.setAttribute('content', previousOgUrl)
      }
    }
  }, [title, description, canonicalPath])
}
