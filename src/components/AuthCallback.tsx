import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getAdminSession, isAdminSessionAllowed, signOutAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

type Phase = 'working' | 'admin' | 'denied' | 'retry'

/**
 * OAuth landing route (`/auth/callback`).
 *
 * Google redirects here after Supabase OAuth. The session is established
 * asynchronously (`detectSessionInUrl`), so we wait for getSession +
 * onAuthStateChange. Staff emails (osi@ / emeka@) are allowlisted — do not
 * treat a missing session yet as an unauthorized account.
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
    let cancelled = false

    const resolve = async (session: Session | null) => {
      if (cancelled || settled || !session) return
      settled = true
      if (await isAdminSessionAllowed(session)) {
        setPhase('admin')
        return
      }
      await signOutAdmin()
      setPhase('denied')
    }

    void getAdminSession(8_000).then((session) => {
      void resolve(session)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      void resolve(session)
    })

    const timer = window.setTimeout(() => {
      if (cancelled || settled) return
      settled = true
      setPhase('retry')
    }, 20_000)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  if (phase === 'admin') return <Navigate to="/admin" replace />
  if (phase === 'denied') {
    return <Navigate to="/admin/login?error=not_authorized" replace />
  }
  if (phase === 'retry') {
    return <Navigate to="/admin/login" replace />
  }

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
