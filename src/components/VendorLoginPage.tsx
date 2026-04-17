import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

function isProbablyEmail(value: string): boolean {
  const t = value.trim()
  if (!t) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

export function VendorLoginPage() {
  const [searchParams] = useSearchParams()
  const redirect = searchParams.get('redirect')?.trim() || '/vendor'
  const kFromLoginUrl = searchParams.get('k')?.trim() || null

  const kFromRedirect = useMemo(() => {
    try {
      // `redirect` is already decoded by URLSearchParams (e.g. "/vendor/ticket/:id?k=...").
      const asUrl = new URL(redirect, 'https://vendor.local')
      return asUrl.searchParams.get('k')?.trim() || null
    } catch {
      return null
    }
  }, [redirect])

  const portalKey = kFromLoginUrl || kFromRedirect

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null)

  const emailOk = useMemo(() => isProbablyEmail(email), [email])

  useEffect(() => {
    console.log('[vendor-login] recovered k:', portalKey)
    if (!portalKey) return
    try {
      sessionStorage.setItem('vendor_portal_bearer', portalKey)
    } catch {
      /* private mode / quota */
    }
    setAlreadyAuthed(true)
  }, [portalKey])

  useEffect(() => {
    if (!supabase) {
      setAlreadyAuthed(import.meta.env.DEV)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setAlreadyAuthed(!!data.session)
    })
  }, [])

  if (alreadyAuthed === true) {
    return <Navigate to={redirect} replace />
  }

  if (alreadyAuthed === null) {
    return <div className="min-h-dvh bg-[#080913]" aria-busy="true" aria-label="Loading" />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSent(false)

    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }

    if (!emailOk) {
      setError('Enter a valid email address.')
      return
    }

    setSubmitting(true)
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const emailRedirectTo = origin ? `${origin}${redirect.startsWith('/') ? '' : '/'}${redirect}` : undefined
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      })
      if (err) throw new Error(err.message)
      setSent(true)
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to send login email')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#080913] px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]">
          <div className="px-8 pb-0 pt-6">
            <h1 className="text-center text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">
              Vendor Portal Login
            </h1>
            <p className="mt-2 text-center text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
              We’ll email you a magic link to sign in.
            </p>
          </div>

          <form className="flex flex-col gap-4 px-8 pb-8 pt-6" onSubmit={onSubmit} noValidate>
            <label className="flex flex-col gap-2">
              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#99a1af] focus:border-[#2b7fff] focus:ring-1 focus:ring-[#2b7fff]"
              />
            </label>

            {error ? (
              <p className="text-[13px] leading-4 text-[#c10007]" role="alert">
                {error}
              </p>
            ) : null}

            {sent ? (
              <p className="rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-[13px] leading-5 text-[#166534]">
                Check your email for a sign-in link. You can close this tab once you’re signed in.
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="h-10 w-full rounded-[10px] bg-[#155dfc] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-colors hover:bg-[#1447e6] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>

            {import.meta.env.DEV && !supabase ? (
              <p className="text-center text-[12px] text-[#6a7282]">
                Dev mode: Supabase env missing — vendor portal is unlocked.
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  )
}

