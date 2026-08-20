import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  contactInitials,
  profileFromAccountSetup,
  profileFromSessionUser,
  type SidebarAdminProfile,
} from '@/constants/sidebarAdminProfile'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchLandlordAccountProfile } from '@/lib/landlordAccountProfile'
import {
  fetchLandlordOnboarding,
  isOnboardingLandlordAccount,
  readLocalOnboardingState,
  shouldBlockDashboard,
  type LandlordOnboardingState,
} from '@/lib/onboarding'
import { supabase } from '@/lib/supabase'

type SidebarAdminProfileState = {
  profile: SidebarAdminProfile | null
  hideProfile: boolean
}

function profileFromLandlordRecord(input: {
  companyName: string
  contactName: string
  email: string
}): SidebarAdminProfile | null {
  const email = input.email.trim()
  const name = input.contactName.trim() || input.companyName.trim()
  if (!name && !email) return null
  const displayName = name || email.split('@')[0] || 'Account'
  return {
    name: displayName,
    email,
    initials: contactInitials(displayName),
  }
}

function resolveProfile(
  landlordProfile: SidebarAdminProfile | null,
  onboardingState: LandlordOnboardingState | null,
  sessionEmail: string | null,
  sessionName: string | null,
): SidebarAdminProfile | null {
  if (landlordProfile) return landlordProfile
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
  const [landlordProfile, setLandlordProfile] = useState<SidebarAdminProfile | null>(null)
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
  }, [landlordId])

  useEffect(() => {
    if (!isOnboardingLandlordAccount(landlordId)) {
      setLandlordProfile(null)
      return
    }

    let cancelled = false
    void fetchLandlordAccountProfile(landlordId).then((profile) => {
      if (cancelled) return
      setLandlordProfile(
        profileFromLandlordRecord({
          companyName: profile.companyName,
          contactName: profile.contactName,
          email: profile.email,
        }),
      )
    })

    return () => {
      cancelled = true
    }
  }, [landlordId])

  return useMemo(() => {
    const hideProfile = shouldHideSidebarProfile(onOnboardingRoute, onboardingState)
    if (hideProfile) {
      return { profile: null, hideProfile: true }
    }

    return {
      profile: resolveProfile(landlordProfile, onboardingState, sessionEmail, sessionName),
      hideProfile: false,
    }
  }, [onOnboardingRoute, onboardingState, landlordProfile, sessionEmail, sessionName])
}
