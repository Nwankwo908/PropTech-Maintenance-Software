import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  defaultOnboardingState,
  fetchLandlordOnboarding,
  isOnboardingLandlordAccount,
  readLocalOnboardingState,
  restartNewLandlordOnboarding,
  shouldBlockDashboard,
  type LandlordOnboardingState,
} from '@/lib/landlordOnboarding'

/**
 * Redirects New Landlord accounts to onboarding until setup is complete.
 * Demo and Ulo Operations accounts are never affected.
 */
export function AdminOnboardingGuard() {
  const location = useLocation()
  const navigate = useNavigate()
  const onOnboardingRoute = location.pathname.startsWith('/admin/onboarding')
  const [state, setState] = useState<LandlordOnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const hasFetchedRef = useRef(false)
  const resetStartedRef = useRef(false)

  const isOnboardingAccount = isOnboardingLandlordAccount()
  const shouldReset = new URLSearchParams(location.search).get('reset') === '1'

  useEffect(() => {
    if (!isOnboardingAccount || !shouldReset || resetStartedRef.current) {
      return
    }
    resetStartedRef.current = true

    const fresh = defaultOnboardingState()
    setState(fresh)
    hasFetchedRef.current = true
    setLoading(false)
    navigate('/admin/onboarding', { replace: true })

    void restartNewLandlordOnboarding().then((result) => {
      if (!result.ok) {
        console.error('[AdminOnboardingGuard] reset failed', result.error)
        return
      }
      if (result.state) {
        setState(result.state)
      }
    })
  }, [isOnboardingAccount, shouldReset, navigate])

  useEffect(() => {
    if (!isOnboardingAccount) {
      setLoading(false)
      return
    }
    if (shouldReset || resetStartedRef.current) {
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
  }, [isOnboardingAccount, location.pathname, shouldReset])

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
