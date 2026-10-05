import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'

export type TryDemoExperienceId = 'landlord' | 'resident' | 'vendor'

export type TryDemoSessionPayload =
  | { email: string; hashed_token: string }
  | { email: string; access_token: string; refresh_token: string }

export type SendTryDemoSmsResult = {
  ok: boolean
  sent?: boolean
  alreadySent?: boolean
  skipped?: boolean
  message?: string
  error?: string
  smsError?: string
  demoSession?: TryDemoSessionPayload
}

const TRY_DEMO_REQUEST_TIMEOUT_MS = 18_000

function sendTryDemoSmsUrl(): string | null {
  const explicit = import.meta.env.VITE_SEND_TRY_DEMO_SMS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (base) return `${base}/functions/v1/send-try-demo-sms`
  return null
}

function sendTryDemoSmsHeaders(url: string): Record<string, string> | null {
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

function parseDemoSession(raw: unknown): TryDemoSessionPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const email = typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : ''
  if (!email) return undefined
  if (typeof obj.hashed_token === 'string' && obj.hashed_token.trim()) {
    return { email, hashed_token: obj.hashed_token.trim() }
  }
  if (
    typeof obj.access_token === 'string' &&
    obj.access_token.trim() &&
    typeof obj.refresh_token === 'string' &&
    obj.refresh_token.trim()
  ) {
    return {
      email,
      access_token: obj.access_token.trim(),
      refresh_token: obj.refresh_token.trim(),
    }
  }
  return undefined
}

/** Establish a Demo portal Supabase session from the edge mint payload. */
export async function applyTryDemoSession(
  demoSession: TryDemoSessionPayload | undefined,
): Promise<boolean> {
  if (!supabase || !demoSession) return false

  if ('hashed_token' in demoSession) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: demoSession.hashed_token,
      type: 'magiclink',
    })
    if (error) {
      console.warn('[try-demo] verifyOtp failed', error.message)
      return false
    }
    return true
  }

  const { error } = await supabase.auth.setSession({
    access_token: demoSession.access_token,
    refresh_token: demoSession.refresh_token,
  })
  if (error) {
    console.warn('[try-demo] setSession failed', error.message)
    return false
  }
  return true
}

async function postTryDemo(body: Record<string, unknown>): Promise<SendTryDemoSmsResult> {
  const url = sendTryDemoSmsUrl()
  if (!url) {
    if (import.meta.env.DEV) {
      console.info('[try-demo] Dev mode — demo entry without edge SMS:', body)
      return { ok: true, sent: true, message: 'Sample text sent (dev).' }
    }
    return { ok: false, error: 'Demo messaging is not configured.' }
  }

  const headers = sendTryDemoSmsHeaders(url) ?? { 'Content-Type': 'application/json' }
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), TRY_DEMO_REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Demo request timed out. Please try again.' }
    }
    return {
      ok: false,
      error: getErrorMessage(err, 'Could not open the demo account.'),
    }
  } finally {
    window.clearTimeout(timeoutId)
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch {
    payload = {}
  }

  const demoSession = parseDemoSession(payload.demoSession)
  const ok = res.ok && payload.ok !== false

  if (!ok) {
    return {
      ok: false,
      error: getErrorMessage(
        payload.error ?? payload.message,
        'Could not open the demo account.',
      ),
      demoSession,
    }
  }

  return {
    ok: true,
    sent: Boolean(payload.sent),
    alreadySent: Boolean(payload.alreadySent),
    skipped: Boolean(payload.skipped),
    message: typeof payload.message === 'string' ? payload.message : undefined,
    smsError: typeof payload.smsError === 'string' ? payload.smsError : undefined,
    demoSession,
  }
}

export async function sendTryDemoExperienceSms(input: {
  experience: TryDemoExperienceId
  phone: string
  email: string
  firstName: string
  /** Final Next should force a fresh sample even if a prior attempt recorded a send. */
  forceResend?: boolean
}): Promise<SendTryDemoSmsResult> {
  return postTryDemo({
    experience: input.experience,
    phone: input.phone,
    email: input.email,
    firstName: input.firstName,
    forceResend: input.forceResend === true,
  })
}

/** Mint a Demo portal session without (re)sending the sample SMS. */
export async function mintTryDemoSession(input: {
  email: string
}): Promise<SendTryDemoSmsResult> {
  return postTryDemo({
    email: input.email,
    sessionOnly: true,
  })
}
