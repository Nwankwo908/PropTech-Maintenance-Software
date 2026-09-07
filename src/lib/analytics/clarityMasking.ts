import { sanitizePagePath } from './sanitize'

export const CLARITY_MASK_ATTR = 'data-clarity-mask'

/** Spread onto a node to mask it and its children in Clarity recordings. */
export const clarityMaskProps = { [CLARITY_MASK_ATTR]: 'true' } as const

/**
 * Public marketing / legal pages may stay unmasked (Clarity still masks all
 * input boxes). Every other route shows or collects operational PII as rendered
 * text — names, phones, emails, addresses, leases, payments, SMS, ticket copy.
 */
const UNMASKED_PUBLIC_PATHS = new Set(['/', '/demo', '/terms', '/privacy', '/privatepolicy'])

export function shouldMaskClarityDom(pathname: string): boolean {
  const path = sanitizePagePath(pathname).replace(/\/+$/, '') || '/'
  return !UNMASKED_PUBLIC_PATHS.has(path)
}

export function applyClarityRootMask(pathname: string): void {
  try {
    if (typeof document === 'undefined') return
    const root = document.getElementById('root')
    if (!root) return
    if (shouldMaskClarityDom(pathname)) {
      root.setAttribute(CLARITY_MASK_ATTR, 'true')
    } else {
      root.removeAttribute(CLARITY_MASK_ATTR)
    }
  } catch {
    /* never affect the app */
  }
}
