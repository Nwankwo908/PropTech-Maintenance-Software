import { sameOriginHref } from '@/lib/inAppRouterPath'

/** Build `/admin/…` (+ optional search) from a React Router `to` value. */
export function adminPathFromTo(to: string | { pathname: string; search?: string }): string {
  if (typeof to === 'string') return to
  const search =
    !to.search || to.search.startsWith('?') ? (to.search ?? '') : `?${to.search}`
  return `${to.pathname}${search}`
}

/**
 * Full document navigation to an admin path on the current origin.
 * Prefer this over React Router when SPA navigate/Link has proven unreliable
 * (stale router after HMR, localhost↔www preview origin issues).
 */
export function assignAdminPath(to: string | { pathname: string; search?: string }): void {
  window.location.assign(sameOriginHref(adminPathFromTo(to)))
}
