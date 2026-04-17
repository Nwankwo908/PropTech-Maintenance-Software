import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type GateState = 'loading' | 'authed' | 'anon'

/**
 * Requires a Supabase session for /vendor/*, unless the URL carries `?k=` (vendor action token).
 * In Vite dev without Supabase env, children render so local UI work stays possible.
 */
export function VendorAuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<GateState>('loading')

  const k =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('k')?.trim()
      : null
  console.log('[vendor-auth] k from URL:', k)

  // Vendor email-link flow: `?k=` fully bypasses login.
  if (k) {
    return <>{children}</>
  }

  useEffect(() => {
    if (!supabase) {
      setState(import.meta.env.DEV ? 'authed' : 'anon')
      return
    }

    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setState(data.session ? 'authed' : 'anon')
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setState(session ? 'authed' : 'anon')
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (state === 'loading') {
    return <div className="min-h-dvh w-full bg-[#f3f4f6]" aria-busy="true" aria-label="Loading" />
  }

  if (state === 'anon') {
    const from = `${location.pathname}${location.search || ''}`
    return <Navigate to={`/vendor/login?redirect=${encodeURIComponent(from)}`} replace />
  }

  return <>{children}</>
}

