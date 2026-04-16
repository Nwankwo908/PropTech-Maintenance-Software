import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type GateState = 'loading' | 'authed' | 'anon'

/**
 * Requires a Supabase session for /admin/* (except /admin/login, which renders outside this gate).
 * In Vite dev without Supabase env, children render so local UI work stays possible.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('loading')

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
    return (
      <div
        className="min-h-dvh w-full bg-[#f3f4f6]"
        aria-busy="true"
        aria-label="Loading"
      />
    )
  }

  if (state === 'anon') {
    return <Navigate to="/admin/login" replace />
  }

  return <>{children}</>
}
