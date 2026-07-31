import { useLayoutEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { prepareDemoLandlordScope } from '@/lib/activeLandlord'

/** Public entry: scope admin to Demo Property Management, then open the overview. */
export function DemoPageRedirect() {
  useLayoutEffect(() => {
    prepareDemoLandlordScope()
  }, [])

  return <Navigate to="/admin" replace />
}
