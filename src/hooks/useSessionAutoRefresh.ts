import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Background session keep-alive interval (10 minutes). */
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000

/**
 * If access token has more than this much wall-clock time left, skip `refreshSession`
 * on this tick (reduces redundant calls while token is still long-lived).
 */
const SKIP_REFRESH_IF_REMAINING_MS = 50 * 60 * 1000

/**
 * Runs `supabase.auth.refreshSession()` on an interval while a session exists.
 * Call **once** from the app root (e.g. `App.tsx`) so only one timer runs globally.
 * Does not replace submit-time refresh in `residentAuth` (`getValidResidentSubmitAuth`, etc.).
 */
export function useSessionAutoRefresh(supabase: SupabaseClient | null): void {
  const tickInFlight = useRef(false)

  useEffect(() => {
    if (!supabase) return
    const client = supabase

    let cancelled = false

    async function tick() {
      if (cancelled || tickInFlight.current) return
      tickInFlight.current = true
      try {
        const {
          data: { session },
          error: sessionError,
        } = await client.auth.getSession()
        if (cancelled) return
        if (sessionError || !session) return

        if (session.expires_at != null) {
          const remainingMs = session.expires_at * 1000 - Date.now()
          if (remainingMs > SKIP_REFRESH_IF_REMAINING_MS) {
            return
          }
        }

        const { error } = await client.auth.refreshSession()
        if (cancelled) return
        if (import.meta.env.DEV) {
          if (error) {
            console.warn('[useSessionAutoRefresh] refreshSession:', error.message)
          } else {
            console.log('[useSessionAutoRefresh] session refreshed')
          }
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[useSessionAutoRefresh]', e)
        }
      } finally {
        tickInFlight.current = false
      }
    }

    const intervalId = window.setInterval(() => {
      void tick()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [supabase])
}
