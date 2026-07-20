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
 * Prefer in-memory guard state once loaded. Do not let a stale localStorage
 * "completed" flag override an explicit reset / in-progress server state.
 */
function resolveGuardOnboardingState(
  state: LandlordOnboardingState | null,
  localState: LandlordOnboardingState | null,
): LandlordOnboardingState | null {
  if (state) return state
  return localState
}

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
  const [resetError, setResetError] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)

  const isOnboardingAccount = isOnboardingLandlordAccount()
  const shouldReset = new URLSearchParams(location.search).get('reset') === '1'

  useEffect(() => {
    if (!isOnboardingAccount || !shouldReset) {
      return
    }

    let cancelled = false
    setLoading(true)
    setResetError(null)

    void restartNewLandlordOnboarding()
      .then((result) => {
        if (cancelled) return
        const next = result.state ?? defaultOnboardingState()
        setState(next)
        setLoading(false)
        hasFetchedRef.current = true
        if (!result.ok) {
          setResetError(result.error ?? 'Could not fully clear portfolio data.')
        }
        navigate('/admin/onboarding', { replace: true })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminOnboardingGuard] reset threw', err)
        setState(defaultOnboardingState())
        setLoading(false)
        hasFetchedRef.current = true
        setResetError(err instanceof Error ? err.message : 'Reset failed.')
        navigate('/admin/onboarding', { replace: true })
      })

    return () => {
      cancelled = true
    }
  }, [isOnboardingAccount, shouldReset, navigate])

  useEffect(() => {
    if (!isOnboardingAccount) {
      setLoading(false)
      return
    }
    if (shouldReset) {
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
        <p className="text-[14px] text-[#6a7282]">
          {shouldReset ? 'Resetting onboarding…' : 'Loading…'}
        </p>
      </div>
    )
  }

  const resolvedState = resolveGuardOnboardingState(state, readLocalOnboardingState())
  const blockDashboard = resolvedState ? shouldBlockDashboard(resolvedState) : true

  if (blockDashboard && !onOnboardingRoute) {
    return <Navigate to="/admin/onboarding" replace />
  }

  if (!blockDashboard && onOnboardingRoute && resolvedState?.onboardingStatus === 'completed') {
    return <Navigate to="/admin" replace />
  }

  return (
    <>
      {resetError ? (
        <div
          className="border-b border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-center text-[13px] text-[#b91c1c]"
          role="alert"
        >
          {resetError} Account status was reset — clear leftover data from Supabase if tasks remain.
        </div>
      ) : null}
      <Outlet />
    </>
  )
}
