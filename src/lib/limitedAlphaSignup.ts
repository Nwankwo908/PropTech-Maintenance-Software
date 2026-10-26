import { supabase } from '@/lib/supabase'

const INTENT = 'ulo.alphaSignup'
/** UI intent only. Provisioning trusts the server-verified Auth identity, never this cookie. */
export function markLimitedAlphaSignupIntent(): void {
  const domain = /(^|\.)ulohome\.io$/.test(window.location.hostname) ? '; Domain=.ulohome.io' : ''
  document.cookie = `${INTENT}=1; Path=/; Max-Age=1800; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}${domain}`
}
export function hasLimitedAlphaSignupIntent(): boolean {
  return typeof document !== 'undefined' && document.cookie.split(';').some(v => v.trim() === `${INTENT}=1`)
}
const inflight = new Map<string, Promise<string>>()
export async function ensureMyLimitedAlphaProfile(userId: string): Promise<string> {
  const pending = inflight.get(userId)
  if (pending) return pending
  const request = (async () => {
    if (!supabase) throw new Error('Signup service is unavailable.')
    const { data, error } = await supabase.rpc('ensure_my_limited_alpha_profile')
    if (error) throw new Error('Could not create your private profile. Please try again.')
    if (!data || typeof data.landlord_id !== 'string') throw new Error('Signup returned no profile.')
    return data.landlord_id as string
  })()
  inflight.set(userId, request)
  try { return await request } finally { inflight.delete(userId) }
}
