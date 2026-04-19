import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'checking' | 'allowed' | 'blocked'>('checking')

  useEffect(() => {
    if (!supabase) {
      setStatus('blocked')
      navigate('/vendor/login', { replace: true })
      return
    }

    const redirectTarget = `/vendor/login?redirect=${encodeURIComponent(
      location.pathname + location.search,
    )}`

    function syncSession(session: import('@supabase/supabase-js').Session | null) {
      if (session) {
        setStatus('allowed')
      } else {
        setStatus('blocked')
        navigate(redirectTarget, { replace: true })
      }
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      syncSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session)
    })

    return () => subscription.unsubscribe()
  }, [location.pathname, location.search, navigate])

  if (status === 'checking') return null
  if (status === 'allowed') return <>{children}</>

  return null
}
