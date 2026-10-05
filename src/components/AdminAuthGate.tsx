import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getAdminSession, isAdminSessionAllowed, signOutAdmin, emailFromAuthSession } from '@/lib/adminAuth'
import {
  bindSessionLandlordFromEmail,
  isTryDemoWelcomePending,
  isTryDemoWelcomeSeen,
  markTryDemoWelcomePending,
  prepareTryDemoLandlordScope,
} from '@/lib/activeLandlord'
import { persistAnonymousAttributionForSessionLandlord } from '@/lib/analytics/persistLandlordAttribution'
import { TryDemoWelcomeModal } from '@/components/TryDemoWelcomeModal'
import { supabase } from '@/lib/supabase'

type GateState = 'loading' | 'authed' | 'anon'

async function gateStateForSession(session: Session | null): Promise<GateState> {
  if (!session) {
    await bindSessionLandlordFromEmail(null)
    return 'anon'
  }
  if (!(await isAdminSessionAllowed(session))) {
    // Do not clear Try Demo visitor/welcome flags here — this runs during the
    // /demo → /admin hop when a stale session is swapped for demo@ulohome.io.
    await signOutAdmin({ clearTryDemo: false })
    await bindSessionLandlordFromEmail(null)
    return 'anon'
  }
  // Bind the landlord scope before any dashboard renders/fetches.
  await bindSessionLandlordFromEmail(emailFromAuthSession(session) || session.user.email)
  void persistAnonymousAttributionForSessionLandlord()
  return 'authed'
}

function shouldOpenTryDemoWelcome(search: string): boolean {
  if (isTryDemoWelcomeSeen()) return false
  const params = new URLSearchParams(search)
  if (params.get('welcome') === '1' || params.get('from') === 'try-demo') {
    prepareTryDemoLandlordScope()
    markTryDemoWelcomePending()
    return true
  }
  return isTryDemoWelcomePending()
}

function stripTryDemoWelcomeParams(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('welcome') && !url.searchParams.has('from')) return
    url.searchParams.delete('welcome')
    url.searchParams.delete('from')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', next)
  } catch {
    // ignore
  }
}

/**
 * Requires a Supabase session for /admin/* (except /admin/login and /admin/get-started, which render outside this gate).
 * Access is limited to allowlisted portal emails (staff, Alpha, demo accounts).
 * In Vite dev without Supabase env, children render so local UI work stays possible.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<GateState>('loading')
  const [tryDemoWelcomeOpen, setTryDemoWelcomeOpen] = useState(() =>
    shouldOpenTryDemoWelcome(
      typeof window !== 'undefined' ? window.location.search : location.search,
    ),
  )

  useEffect(() => {
    if (shouldOpenTryDemoWelcome(location.search) || shouldOpenTryDemoWelcome(window.location.search)) {
      setTryDemoWelcomeOpen(true)
    }
  }, [location.pathname, location.search])

  // Re-check after auth settles — session swap can remount children without remounting the gate.
  useEffect(() => {
    if (state !== 'authed') return
    if (isTryDemoWelcomeSeen()) return
    if (shouldOpenTryDemoWelcome(location.search) || isTryDemoWelcomePending()) {
      setTryDemoWelcomeOpen(true)
    }
  }, [state, location.search])

  function dismissTryDemoWelcome() {
    stripTryDemoWelcomeParams()
    setTryDemoWelcomeOpen(false)
  }

  useEffect(() => {
    if (!supabase) {
      setState(import.meta.env.DEV ? 'authed' : 'anon')
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      console.warn('[AdminAuthGate] session check timed out')
      setState((prev) =>
        prev === 'loading' ? (import.meta.env.DEV ? 'authed' : 'anon') : prev,
      )
    }, 5_000)

    void getAdminSession(4_000)
      .then(async (session) => {
        if (cancelled) return
        setState(await gateStateForSession(session))
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminAuthGate] getSession threw', err)
        setState(import.meta.env.DEV ? 'authed' : 'anon')
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void gateStateForSession(session)
        .then((next) => {
          if (!cancelled) setState(next)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[AdminAuthGate] auth state threw', err)
          setState(import.meta.env.DEV ? 'authed' : 'anon')
        })
    })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  if (state === 'loading') {
    return (
      <>
        <div
          className="min-h-dvh w-full bg-secondary"
          aria-busy="true"
          aria-label="Loading"
        />
        <TryDemoWelcomeModal
          open={tryDemoWelcomeOpen}
          onClose={dismissTryDemoWelcome}
        />
      </>
    )
  }

  if (state === 'anon') {
    const next = `${location.pathname}${location.search}`
    const loginTo =
      next.startsWith('/admin') && next !== '/admin/login' && !next.startsWith('/admin/get-started')
        ? `/admin/login?next=${encodeURIComponent(next)}`
        : '/admin/login'
    return <Navigate to={loginTo} replace />
  }

  return (
    <>
      {children}
      <TryDemoWelcomeModal
        open={tryDemoWelcomeOpen}
        onClose={dismissTryDemoWelcome}
      />
    </>
  )
}
