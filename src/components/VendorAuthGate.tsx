import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

function vendorVerifyTokenRequestUrl(): string {
  const explicit = import.meta.env.VITE_VENDOR_VERIFY_TOKEN_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/vendor-verify-token`
  return '/vendor-verify-token'
}

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

    const client = supabase

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

    const params = new URLSearchParams(location.search)
    const token = params.get('token')
    const vendorId = params.get('vendorId')

    let cancelled = false
    let subscription: { unsubscribe: () => void } | null = null

    async function run() {
      if (token && vendorId) {
        try {
          const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
          const res = await fetch(vendorVerifyTokenRequestUrl(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(anon
                ? {
                    Authorization: `Bearer ${anon}`,
                    apikey: anon,
                  }
                : {}),
            },
            body: JSON.stringify({ token, vendorId }),
          })

          const data = (await res.json()) as {
            access_token?: string
            refresh_token?: string
            email?: string
            hashed_token?: string
          }

          if (!cancelled && data?.access_token) {
            await client.auth.setSession({
              access_token: data.access_token,
              refresh_token: data.refresh_token ?? '',
            })
          } else if (!cancelled && data?.email && data?.hashed_token) {
            const { error: vErr } = await client.auth.verifyOtp({
              email: data.email,
              token: data.hashed_token,
              type: 'email',
            })
            if (vErr) {
              const { error: v2 } = await client.auth.verifyOtp({
                email: data.email,
                token: data.hashed_token,
                type: 'magiclink',
              })
              if (v2) console.error('Vendor verifyOtp failed', vErr, v2)
            }
          }

          if (!cancelled) {
            navigate(location.pathname, { replace: true })
          }
        } catch (err) {
          console.error('Vendor auto-login failed', err)
        }
      }

      if (cancelled) return

      const { data: sessionData } = await client.auth.getSession()
      syncSession(sessionData.session)

      const {
        data: { subscription: sub },
      } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) syncSession(session)
      })
      subscription = sub
    }

    void run()

    return () => {
      cancelled = true
      subscription?.unsubscribe()
    }
  }, [location.pathname, location.search, navigate])

  if (status === 'checking') return null
  if (status === 'allowed') return <>{children}</>

  return null
}
