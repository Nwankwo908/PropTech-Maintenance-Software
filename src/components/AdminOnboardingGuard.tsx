import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  fetchLandlordOnboarding,
  isOnboardingLandlordAccount,
  readLocalOnboardingState,
  shouldBlockDashboard,
  type LandlordOnboardingState,
} from '@/lib/landlordOnboarding'

/**
 * Redirects New Landlord accounts to onboarding until setup is complete.
 * Demo and Ulo Operations accounts are never affected.
 */
export function AdminOnboardingGuard() {
  const location = useLocation()
  const onOnboardingRoute = location.pathname.startsWith('/admin/onboarding')
  const [state, setState] = useState<LandlordOnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const hasFetchedRef = useRef(false)

  const isOnboardingAccount = isOnboardingLandlordAccount()

  useEffect(() => {
    if (!isOnboardingAccount) {
      setLoading(false)
      return
    }
    let cancelled = false
    if (!hasFetchedRef.current) {
      setLoading(true)
    }
    void fetchLandlordOnboarding().then((data) => {
      if (!cancelled) {
        setState(data)
        setLoading(false)
        hasFetchedRef.current = true
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOnboardingAccount, location.pathname])

  if (!isOnboardingAccount) {
    if (onOnboardingRoute) {
      return <Navigate to="/admin" replace />
    }
    return <Outlet />
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8" aria-busy="true">
        <p className="text-[14px] text-[#6a7282]">Loading…</p>
      </div>
    )
  }

  const localState = readLocalOnboardingState()
  const resolvedState: LandlordOnboardingState | null =
    state?.onboardingStatus === 'completed'
      ? state
      : localState?.onboardingStatus === 'completed'
        ? localState
        : state

  const blockDashboard = resolvedState ? shouldBlockDashboard(resolvedState) : true

  if (blockDashboard && !onOnboardingRoute) {
    return <Navigate to="/admin/onboarding" replace />
  }

  if (!blockDashboard && onOnboardingRoute && resolvedState?.onboardingStatus === 'completed') {
    return <Navigate to="/admin" replace />
  }

  return <Outlet />
}
