import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isAdminSessionAllowed, signOutAdmin } from '@/lib/adminAuth'
import { setSessionLandlordFromEmail } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

type GateState = 'loading' | 'authed' | 'anon'

async function gateStateForSession(session: Session | null): Promise<GateState> {
  if (!session) {
    setSessionLandlordFromEmail(null)
    return 'anon'
  }
  if (!isAdminSessionAllowed(session)) {
    await signOutAdmin()
    setSessionLandlordFromEmail(null)
    return 'anon'
  }
  // Bind the landlord scope before any dashboard renders/fetches.
  setSessionLandlordFromEmail(session.user.email)
  return 'authed'
}

/**
 * Requires a Supabase session for /admin/* (except /admin/login, which renders outside this gate).
 * Access is limited to allowlisted portal emails (staff, Alpha, demo accounts).
 * In Vite dev without Supabase env, children render so local UI work stays possible.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<GateState>('loading')

  useEffect(() => {
    if (!supabase) {
      setState(import.meta.env.DEV ? 'authed' : 'anon')
      return
    }

    let cancelled = false

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setState(await gateStateForSession(data.session))
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void gateStateForSession(session).then((next) => {
        if (!cancelled) setState(next)
      })
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (state === 'loading') {
    return (
      <div
        className="min-h-dvh w-full bg-secondary"
        aria-busy="true"
        aria-label="Loading"
      />
    )
  }

  if (state === 'anon') {
    const next = `${location.pathname}${location.search}`
    const loginTo =
      next.startsWith('/admin') && next !== '/admin/login'
        ? `/admin/login?next=${encodeURIComponent(next)}`
        : '/admin/login'
    return <Navigate to={loginTo} replace />
  }

  return <>{children}</>
}
