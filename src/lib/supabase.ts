import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Web Locks can stay held if another tab died mid-auth. A hung lock makes
 * getSession() never resolve, so login stays on a blank “Signing you in” screen.
 * Abort the lock wait and run the auth work anyway.
 */
async function authLock<R>(
  _name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const timeoutMs = Number.isFinite(acquireTimeout) && acquireTimeout > 0 ? acquireTimeout : 2500
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return await fn()

  try {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), timeoutMs)
    try {
      return await locks.request(_name, { mode: 'exclusive', signal: ac.signal }, () => fn())
    } finally {
      window.clearTimeout(timer)
    }
  } catch {
    return await fn()
  }
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          lock: authLock,
        },
      })
    : null

if (!supabase) {
  console.warn(
    '[supabase] Missing client env: save `.env` to disk with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart `npm run dev`.',
  )
}
