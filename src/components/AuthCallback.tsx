import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { getAdminSession, isAdminSessionAllowed, signOutAdmin } from '@/lib/adminAuth'
import {
  handoffGoogleOAuthHashToOpener,
  readGoogleIdTokenFromHash,
  readGoogleOAuthErrorFromHash,
  takeStoredGoogleOAuthNonce,
} from '@/lib/googleIdentitySignIn'
import { supabase } from '@/lib/supabase'

type Phase = 'working' | 'admin' | 'denied' | 'retry' | 'google_failed' | 'handed_off'

/**
 * OAuth landing route (`/auth/callback`).
 *
 * Google can return here two ways:
 * 1. App-origin id_token (account picker shows ulohome.io / localhost)
 * 2. Supabase-hosted OAuth (`detectSessionInUrl`) — picker shows *.supabase.co
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

    const completeGoogleIdToken = async (): Promise<boolean> => {
      const hash = window.location.hash
      if (handoffGoogleOAuthHashToOpener(window.opener, hash)) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        setPhase('handed_off')
        window.setTimeout(() => {
          try {
            window.close()
          } catch {
            /* ignore */
          }
        }, 50)
        return true
      }
      if (readGoogleOAuthErrorFromHash(hash)) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        setPhase('google_failed')
        return true
      }
      const idToken = readGoogleIdTokenFromHash(hash)
      if (!idToken) return false
      const nonce = takeStoredGoogleOAuthNonce()
      const { data, error } = await client.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
        ...(nonce ? { nonce } : {}),
      })
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      if (error || !data.session) {
        setPhase('google_failed')
        return true
      }
      await resolve(data.session)
      return true
    }

    void completeGoogleIdToken().then((handled) => {
      if (handled || cancelled) return
      void getAdminSession(8_000).then((session) => {
        void resolve(session)
      })
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
  if (phase === 'google_failed') {
    return <Navigate to="/admin/login?error=google_signin" replace />
  }
  if (phase === 'retry') {
    return <Navigate to="/admin/login" replace />
  }
  if (phase === 'handed_off') {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-gradient-to-b from-white to-[#f0fdf4] font-[family-name:var(--font-admin)]">
        <p className="text-[14px] tracking-[-0.1504px] text-[#6a7282]">
          You can close this window and return to the app.
        </p>
      </div>
    )
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
