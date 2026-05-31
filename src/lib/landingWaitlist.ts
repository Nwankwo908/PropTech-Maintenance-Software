import { supabase } from '@/lib/supabase'

const WAITLIST_OAUTH_FLAG = 'ulo_waitlist_oauth'
const WAITLIST_REF_KEY = 'ulo_waitlist_ref'

export type JoinWaitlistResult = {
  referralLink: string
  referralCode: string
}

function extractReferralCode(referralLink?: string | null): string | null {
  if (!referralLink) return null
  try {
    const ref = new URL(referralLink, window.location.origin).searchParams.get('ref')?.trim()
    if (!ref) return null
    const normalized = ref.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
    return normalized.length >= 4 ? normalized : null
  } catch {
    return null
  }
}

/** Always point referrals at the landing page on the current site origin. */
function buildClientReferralLink(referralCode: string): string {
  return `${window.location.origin}/?ref=${referralCode}`
}

/** Persist `?ref=` from the landing URL for attribution on signup. */
export function captureWaitlistReferralFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  const ref = new URLSearchParams(window.location.search).get('ref')?.trim()
  if (!ref) return false
  const normalized = ref.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  if (normalized.length < 4) return false
  sessionStorage.setItem(WAITLIST_REF_KEY, normalized)
  return true
}

export function getWaitlistReferral(): string | null {
  if (typeof window === 'undefined') return null
  const ref = sessionStorage.getItem(WAITLIST_REF_KEY)?.trim()
  return ref && ref.length >= 4 ? ref : null
}

export function clearWaitlistReferral(): void {
  sessionStorage.removeItem(WAITLIST_REF_KEY)
}

export function markWaitlistOAuthIntent(): void {
  sessionStorage.setItem(WAITLIST_OAUTH_FLAG, '1')
}

export function consumeWaitlistOAuthIntent(): boolean {
  const pending = sessionStorage.getItem(WAITLIST_OAUTH_FLAG) === '1'
  if (pending) sessionStorage.removeItem(WAITLIST_OAUTH_FLAG)
  return pending
}

function joinWaitlistUrl(): string | null {
  const explicit = import.meta.env.VITE_JOIN_WAITLIST_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (base) return `${base}/functions/v1/join-waitlist`
  return null
}

function joinWaitlistHeaders(url: string): Record<string, string> | null {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!anon) return null
  try {
    const { hostname } = new URL(url)
    if (!hostname.endsWith('.supabase.co')) return null
    return {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    }
  } catch {
    return null
  }
}

function devReferralCode(email: string): string {
  const slug = email.split('@')[0]?.replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'guest'
  return slug.slice(0, 10)
}

async function callJoinWaitlist(
  email: string,
  source: 'email' | 'google',
): Promise<JoinWaitlistResult> {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) {
    throw new Error('Enter a valid email address.')
  }

  const url = joinWaitlistUrl()
  if (!url) {
    if (import.meta.env.DEV) {
      console.info('[waitlist] Dev mode — would join waitlist:', normalized, source)
      const referralCode = devReferralCode(normalized)
      return { referralLink: buildClientReferralLink(referralCode), referralCode }
    }
    throw new Error('Waitlist is not configured.')
  }

  const headers = joinWaitlistHeaders(url)
  if (!headers) {
    throw new Error('Waitlist is not configured.')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: normalized,
      source,
      origin: window.location.origin,
      ref: getWaitlistReferral(),
    }),
  })

  const raw = await res.text()
  let payload: { error?: string; referralLink?: string; referralCode?: string } = {}
  if (raw) {
    try {
      payload = JSON.parse(raw) as typeof payload
    } catch {
      /* not JSON */
    }
  }

  if (!res.ok) {
    throw new Error(
      payload.error ||
        (raw.trim().length > 0 && raw.length <= 200 ? raw.trim() : 'Could not join the waitlist.'),
    )
  }

  clearWaitlistReferral()

  const referralCode =
    payload.referralCode?.trim() ||
    extractReferralCode(payload.referralLink) ||
    devReferralCode(normalized)

  return {
    referralLink: buildClientReferralLink(referralCode),
    referralCode,
  }
}

export async function joinWaitlistByEmail(email: string): Promise<JoinWaitlistResult> {
  return callJoinWaitlist(email, 'email')
}

export async function joinWaitlistFromSessionEmail(email: string): Promise<JoinWaitlistResult> {
  return callJoinWaitlist(email, 'google')
}

export async function signInWaitlistWithGoogle(): Promise<void> {
  if (!supabase) {
    if (import.meta.env.DEV) {
      console.info('[waitlist] Dev mode — Google waitlist signup skipped (no Supabase).')
      return
    }
    throw new Error('Waitlist is not configured.')
  }

  markWaitlistOAuthIntent()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  })
  if (error) throw new Error(error.message)
}
