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
} from '@/lib/onboarding'
import { getErrorMessage } from '@/lib/errorMessage'

/**
 * Prefer in-memory guard state once loaded. Exception: after Complete, localStorage
 * (and a fresh fetch) may already be `completed` while this guard still holds a
 * stale in-progress snapshot — prefer completed so we don't bounce off /admin.
 */
function resolveGuardOnboardingState(
  state: LandlordOnboardingState | null,
  localState: LandlordOnboardingState | null,
): LandlordOnboardingState | null {
  if (
    localState?.onboardingStatus === 'completed' &&
    state?.onboardingStatus !== 'completed'
  ) {
    return localState
  }
  if (state) return state
  return localState
}

/**
 * Redirects Alpha + New Landlord accounts to onboarding until setup is complete.
 * Demo showcase data is never affected.
 */
export function AdminOnboardingGuard() {
  const location = useLocation()
  const navigate = useNavigate()
  const onOnboardingRoute = location.pathname.startsWith('/admin/onboarding')
  const [state, setState] = useState<LandlordOnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetError, setResetError] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)
  const fetchGenerationRef = useRef(0)

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
        setResetError(getErrorMessage(err, "Couldn't reset setup. Please try again."))
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
    const generation = ++fetchGenerationRef.current
    // First load shows the spinner; later refreshes (e.g. after Complete) stay quiet.
    if (!hasFetchedRef.current) {
      setLoading(true)
    }

    const timeoutId = window.setTimeout(() => {
      if (cancelled || hasFetchedRef.current) return
      console.warn('[AdminOnboardingGuard] onboarding fetch timed out')
      setState(readLocalOnboardingState() ?? defaultOnboardingState())
      setLoading(false)
      hasFetchedRef.current = true
    }, 15_000)

    void fetchLandlordOnboarding()
      .then((data) => {
        if (cancelled || generation !== fetchGenerationRef.current) return
        setState(data)
        setLoading(false)
        hasFetchedRef.current = true
      })
      .catch((err) => {
        if (cancelled || generation !== fetchGenerationRef.current) return
        console.error('[AdminOnboardingGuard] fetch threw', err)
        setState(readLocalOnboardingState() ?? defaultOnboardingState())
        setLoading(false)
        hasFetchedRef.current = true
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [isOnboardingAccount, shouldReset, location.pathname])

  useEffect(() => {
    const onCompleted = () => {
      const local = readLocalOnboardingState()
      if (local?.onboardingStatus === 'completed') {
        setState(local)
      }
      // Force a server refresh on next effect pass.
      fetchGenerationRef.current += 1
      void fetchLandlordOnboarding()
        .then((data) => {
          setState(data)
          hasFetchedRef.current = true
        })
        .catch((err) => {
          console.error('[AdminOnboardingGuard] post-complete refresh failed', err)
        })
    }
    window.addEventListener('ulo:onboarding-completed', onCompleted)
    return () => window.removeEventListener('ulo:onboarding-completed', onCompleted)
  }, [])

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
