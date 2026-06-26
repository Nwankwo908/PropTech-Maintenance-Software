import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isAdminSessionAllowed, signOutAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

type Phase = 'working' | 'admin' | 'denied'

/**
 * OAuth landing route (`/auth/callback`).
 *
 * Google redirects here after sign-in. The session is established asynchronously
 * by the Supabase client (`detectSessionInUrl`), so we wait for it via
 * getSession() + onAuthStateChange before deciding where to send the user:
 *  - valid admin session  → /admin
 *  - signed in, not admin → sign out → /admin/login
 *  - no session settles   → /admin/login
 *
 * This avoids the "land on splash, click Login again" flow: the redirect target
 * itself resolves the session instead of relying on a later page load.
 */
export function AuthCallback() {
  const [phase, setPhase] = useState<Phase>('working')

  useEffect(() => {
    if (!supabase) {
      setPhase(import.meta.env.DEV ? 'admin' : 'denied')
      return
    }

    const client = supabase
    let settled = false

    const resolve = async (session: Session | null) => {
      if (settled || !session) return
      settled = true
      if (isAdminSessionAllowed(session)) {
        setPhase('admin')
      } else {
        await signOutAdmin()
        setPhase('denied')
      }
    }

    void client.auth.getSession().then(({ data }) => resolve(data.session))

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      void resolve(session)
    })

    // If no session materializes from the URL, fall back to the login page.
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true
        setPhase('denied')
      }
    }, 5000)

    return () => {
      subscription.unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  if (phase === 'admin') return <Navigate to="/admin" replace />
  if (phase === 'denied') return <Navigate to="/admin/login" replace />

  return (
    <div
      className="flex min-h-dvh w-full items-center justify-center bg-gradient-to-b from-white to-[#f0fdf4] font-[family-name:var(--font-admin)]"
      aria-busy="true"
      aria-label="Signing you in"
    >
      <p className="text-[14px] tracking-[-0.1504px] text-[#6a7282]">Signing you in…</p>
    </div>
  )
}
