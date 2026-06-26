import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  profileFromAccountSetup,
  profileFromSessionUser,
  type SidebarAdminProfile,
} from '@/constants/sidebarAdminProfile'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  fetchLandlordOnboarding,
  isOnboardingLandlordAccount,
  readLocalOnboardingState,
  shouldBlockDashboard,
  type LandlordOnboardingState,
} from '@/lib/landlordOnboarding'
import { supabase } from '@/lib/supabase'

type SidebarAdminProfileState = {
  profile: SidebarAdminProfile | null
  hideProfile: boolean
}

function resolveProfile(
  onboardingState: LandlordOnboardingState | null,
  sessionEmail: string | null,
  sessionName: string | null,
): SidebarAdminProfile | null {
  if (isOnboardingLandlordAccount()) {
    const fromSetup = onboardingState
      ? profileFromAccountSetup(onboardingState.accountSetup)
      : null
    if (fromSetup) return fromSetup
  }

  return profileFromSessionUser(sessionEmail, sessionName)
}

function shouldHideSidebarProfile(
  onOnboardingRoute: boolean,
  onboardingState: LandlordOnboardingState | null,
): boolean {
  if (!isOnboardingLandlordAccount()) return false
  if (onOnboardingRoute) return true
  if (onboardingState) return shouldBlockDashboard(onboardingState)
  const local = readLocalOnboardingState()
  return local ? shouldBlockDashboard(local) : true
}

export function useSidebarAdminProfile(): SidebarAdminProfileState {
  const location = useLocation()
  const onOnboardingRoute = location.pathname.startsWith('/admin/onboarding')
  const landlordId = getActiveLandlordId()

  const [onboardingState, setOnboardingState] = useState<LandlordOnboardingState | null>(() =>
    isOnboardingLandlordAccount(landlordId) ? readLocalOnboardingState(landlordId) : null,
  )
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return

    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSessionEmail(data.session?.user.email ?? null)
      const meta = data.session?.user.user_metadata as { full_name?: string; name?: string } | undefined
      setSessionName(meta?.full_name ?? meta?.name ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null)
      const meta = session?.user.user_metadata as { full_name?: string; name?: string } | undefined
      setSessionName(meta?.full_name ?? meta?.name ?? null)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isOnboardingLandlordAccount(landlordId)) {
      setOnboardingState(null)
      return
    }

    let cancelled = false
    void fetchLandlordOnboarding(landlordId).then((state) => {
      if (!cancelled) setOnboardingState(state)
    })

    return () => {
      cancelled = true
    }
  }, [landlordId, location.pathname])

  return useMemo(() => {
    const hideProfile = shouldHideSidebarProfile(onOnboardingRoute, onboardingState)
    if (hideProfile) {
      return { profile: null, hideProfile: true }
    }

    return {
      profile: resolveProfile(onboardingState, sessionEmail, sessionName),
      hideProfile: false,
    }
  }, [onOnboardingRoute, onboardingState, sessionEmail, sessionName])
}
