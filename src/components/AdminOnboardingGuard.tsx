import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  defaultOnboardingState,
  fetchLandlordOnboarding,
  isOnboardingLandlordAccount,
  readLocalOnboardingState,
  shouldBlockDashboard,
  type LandlordOnboardingState,
} from '@/lib/onboarding'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { shouldShowLimitedAlphaPostOnboardingWelcome } from '@/lib/postOnboardingWelcome'

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
 * Redirects Limited Alpha accounts to onboarding until setup is complete.
 * Demo showcase data is never affected.
 */
export function AdminOnboardingGuard() {
  const location = useLocation()
  const navigate = useNavigate()
  const onOnboardingRoute = location.pathname.startsWith('/admin/onboarding')
  const [state, setState] = useState<LandlordOnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const hasFetchedRef = useRef(false)
  const fetchGenerationRef = useRef(0)

  const isOnboardingAccount = isOnboardingLandlordAccount()
  const wantsUrlReset = new URLSearchParams(location.search).get('reset') === '1'

  useEffect(() => {
    if (!wantsUrlReset) return
    navigate({ pathname: location.pathname, search: '', hash: location.hash }, { replace: true })
  }, [wantsUrlReset, location.pathname, location.hash, navigate])

  useEffect(() => {
    if (!isOnboardingAccount) {
      setLoading(false)
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
  }, [isOnboardingAccount, location.pathname])

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
        <p className="text-[14px] text-[#6a7282]">Loading…</p>
      </div>
    )
  }

  const resolvedState = resolveGuardOnboardingState(state, readLocalOnboardingState())
  const blockDashboard = resolvedState ? shouldBlockDashboard(resolvedState) : true
  const showPostOnboardingWelcome = shouldShowLimitedAlphaPostOnboardingWelcome(
    resolvedState?.onboardingStatus === 'completed',
    getActiveLandlordId(),
  )

  if (blockDashboard && !onOnboardingRoute) {
    return <Navigate to="/admin/onboarding" replace />
  }

  if (
    !blockDashboard &&
    onOnboardingRoute &&
    resolvedState?.onboardingStatus === 'completed' &&
    !showPostOnboardingWelcome
  ) {
    return <Navigate to="/admin" replace />
  }

  return <Outlet />
}
