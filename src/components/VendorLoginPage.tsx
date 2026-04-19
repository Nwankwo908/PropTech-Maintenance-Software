import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  isValidEmailOtpToken,
  normalizeEmailOtpInput,
  shouldAutoSubmitEmailOtp,
} from '@/lib/emailOtp'
import { supabase } from '@/lib/supabase'

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export function VendorLoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null)

  const redirectTo =
    new URLSearchParams(location.search).get('redirect')?.trim() || '/vendor'

  useEffect(() => {
    if (!supabase) {
      setAlreadyAuthed(false)
      return
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setAlreadyAuthed(!!session)
    })
  }, [])

  if (alreadyAuthed === true) {
    return <Navigate to={redirectTo.startsWith('/') ? redirectTo : '/vendor'} replace />
  }

  if (alreadyAuthed === null) {
    return (
      <div className="min-h-dvh bg-[#f3f4f6]" aria-busy="true" aria-label="Loading" />
    )
  }

  async function sendOtp(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!supabase) {
      setError('Supabase is not configured.')
      return
    }
    const em = email.trim().toLowerCase()
    if (!isValidEmail(em)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: em,
        options: { shouldCreateUser: true },
      })
      if (err) throw new Error(err.message)
      setStep('otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code')
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!supabase) {
      setError('Supabase is not configured.')
      return
    }
    const em = email.trim().toLowerCase()
    const token = normalizeEmailOtpInput(otp)
    if (!isValidEmailOtpToken(token)) {
      setError('Enter the verification code from your email.')
      return
    }
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: em,
        token,
        type: 'email',
      })
      if (err) throw new Error(err.message)
      navigate(redirectTo.startsWith('/') ? redirectTo : '/vendor', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  function onOtpChange(v: string) {
    const n = normalizeEmailOtpInput(v)
    setOtp(n)
    if (shouldAutoSubmitEmailOtp(n) && isValidEmailOtpToken(n) && !busy) {
      setTimeout(() => {
        const form = document.getElementById('vendor-otp-form') as HTMLFormElement | null
        form?.requestSubmit()
      }, 0)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center bg-[#f3f4f6] px-6 py-12 font-sans">
      <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-8 shadow-sm">
        <h1 className="text-[22px] font-bold leading-7 text-[#101828]">Vendor sign in</h1>
        <p className="mt-2 text-[14px] leading-5 text-[#4a5565]">
          {step === 'email'
            ? 'Enter your work email. We’ll send a one-time code.'
            : `We sent a code to ${email.trim()}. Enter it below.`}
        </p>

        {error ? (
          <p
            className="mt-4 rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[14px] text-[#991b1b]"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {step === 'email' ? (
          <form className="mt-6 flex flex-col gap-4" onSubmit={sendOtp}>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-[#364153]">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-[10px] border border-[#d1d5dc] px-3 text-[16px] text-[#101828] outline-none focus:border-[#944c73] focus:ring-1 focus:ring-[#944c73]"
                placeholder="you@company.com"
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center rounded-[10px] bg-[#944c73] text-[15px] font-medium text-white outline-none hover:bg-[#7a3f5f] disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form id="vendor-otp-form" className="mt-6 flex flex-col gap-4" onSubmit={verifyOtp}>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-[#364153]">Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => onOtpChange(e.target.value)}
                className="h-11 rounded-[10px] border border-[#d1d5dc] px-3 text-[16px] tracking-widest text-[#101828] outline-none focus:border-[#944c73] focus:ring-1 focus:ring-[#944c73]"
                placeholder="Enter code"
                autoFocus
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center rounded-[10px] bg-[#944c73] text-[15px] font-medium text-white outline-none hover:bg-[#7a3f5f] disabled:opacity-60"
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="text-[14px] font-medium text-[#944c73] underline outline-none"
              onClick={() => {
                setStep('email')
                setOtp('')
                setError(null)
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
