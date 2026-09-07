import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { analytics } from '@/lib/analytics'
import { applyClarityRootMask } from '@/lib/analytics/clarityMasking'
import { isAnalyticsEnabled } from '@/lib/analytics/isAnalyticsEnabled'
import { persistAnonymousAttributionForSessionLandlord } from '@/lib/analytics/persistLandlordAttribution'

/**
 * Production GA4 + Clarity bootstrap.
 *
 * Clarity loads once from analytics.initialize(). Attribution is captured on
 * pathname + search so UTMs survive SPA navigation and auth redirects.
 * Session-replay masking is applied on `#root` for operational routes.
 * Product events are not fired here.
 */
export function AnalyticsRoot() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    analytics.initialize()
  }, [])

  useEffect(() => {
    analytics.captureAttribution()
    void persistAnonymousAttributionForSessionLandlord()
  }, [pathname, search])

  useEffect(() => {
    analytics.pageView(pathname)
  }, [pathname])

  useEffect(() => {
    if (!isAnalyticsEnabled()) return
    applyClarityRootMask(pathname)
  }, [pathname])

  return null
}
