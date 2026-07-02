import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import bgLogin from '@/assets/BG_Login.png'
import uloLogo from '@/assets/Ulo_Logo_small.png'
import {
  isAdminSessionAllowed,
  sendAdminEmailOtp,
  signInAdminWithOAuth,
  signOutAdmin,
  verifyAdminEmailOtp,
} from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

function IconGoogle({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function AdminLoginPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!supabase) {
      setAlreadyAuthed(import.meta.env.DEV)
      return
    }

    const client = supabase
    let cancelled = false

    const evaluate = async (session: Parameters<typeof isAdminSessionAllowed>[0]) => {
      if (cancelled) return
      if (session && !isAdminSessionAllowed(session)) {
        await signOutAdmin()
        if (!cancelled) setAlreadyAuthed(false)
        return
      }
      if (!cancelled) setAlreadyAuthed(isAdminSessionAllowed(session))
    }

    void client.auth.getSession().then(({ data }) => evaluate(data.session))

    // A session can arrive slightly after mount (e.g. OAuth detectSessionInUrl),
    // so react to it instead of requiring the user to click Login again.
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      void evaluate(session)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (alreadyAuthed === true) {
    return <Navigate to="/admin" replace />
  }

  if (alreadyAuthed === null) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-white to-[#f0fdf4]" aria-busy="true" aria-label="Loading" />
    )
  }

  async function onContinue(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    setSubmitting(true)
    try {
      await sendAdminEmailOtp(email)
      setStep('otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code')
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!otp.trim()) {
      setError('Enter the verification code from your email.')
      return
    }
    setSubmitting(true)
    try {
      await verifyAdminEmailOtp(email, otp)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function onGoogleSignIn() {
    setError(null)
    if (!supabase) {
      setError('Supabase is not configured.')
      return
    }
    setSubmitting(true)
    try {
      await signInAdminWithOAuth('google')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-gradient-to-b from-white to-[#f0fdf4] font-[family-name:var(--font-admin)]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src={bgLogin}
          alt=""
          className="h-full w-full min-h-dvh object-cover object-center opacity-90"
          loading="eager"
          decoding="async"
        />
      </div>
      <div
        className="pointer-events-none absolute -right-20 top-0 size-[500px] rounded-full bg-emerald-500/10 blur-[64px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-20 bottom-0 size-[400px] rounded-full bg-sky-500/10 blur-[64px]"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]">
            <div className="px-8 pb-8 pt-8">
              <div className="flex flex-col items-center gap-2 text-center">
                <Link
                  to="/"
                  aria-label="Back to Ulo home"
                  className="rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2"
                >
                  <img src={uloLogo} alt="ülo home" className="h-10 w-auto object-contain" />
                </Link>
                <h1 className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[rgba(16,24,40,0.7)]">
                  Welcome to Ulo Home
                </h1>
                <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {step === 'email'
                    ? 'Sign in with your authorized email'
                    : 'Enter the verification code we sent to your email'}
                </p>
              </div>

              {step === 'email' ? (
                <form className="mt-8 flex flex-col gap-4" onSubmit={onContinue} noValidate>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="admin-email"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]"
                    >
                      Email
                    </label>
                    <input
                      id="admin-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="Enter your email..."
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#717182] focus:border-emerald-500/35 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  {error ? (
                    <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-9 w-full rounded-lg bg-[#0e5c45] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {submitting ? 'Sending…' : 'Continue'}
                  </button>

                  <div className="flex items-center gap-8">
                    <div className="h-px flex-1 bg-[#cac4d0]" />
                    <span className="text-[14px] tracking-[-0.1504px] text-[#6a7282]">or</span>
                    <div className="h-px flex-1 bg-[#cac4d0]" />
                  </div>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onGoogleSignIn}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-black/10 bg-white text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#6a7282] outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    <IconGoogle />
                    Continue with Google
                  </button>
                </form>
              ) : (
                <form className="mt-8 flex flex-col gap-4" onSubmit={onVerifyOtp} noValidate>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="admin-otp"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]"
                    >
                      Verification code
                    </label>
                    <input
                      id="admin-otp"
                      name="otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="Enter code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-center font-mono text-[14px] tracking-[0.2em] text-[#101828] outline-none placeholder:tracking-normal placeholder:text-[#717182] focus:border-emerald-500/35 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  {error ? (
                    <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-9 w-full rounded-lg bg-[#0e5c45] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {submitting ? 'Verifying…' : 'Continue'}
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setStep('email')
                      setOtp('')
                      setError(null)
                    }}
                    className="text-[14px] font-medium text-[#6a7282] underline underline-offset-2"
                  >
                    Use a different email
                  </button>
                </form>
              )}
            </div>
          </div>

          {import.meta.env.DEV && !supabase ? (
            <p className="mt-4 text-center text-[12px] text-[#364153]/80">
              Dev mode: Supabase env missing — <span className="font-mono">/admin</span> stays available
              without login.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
