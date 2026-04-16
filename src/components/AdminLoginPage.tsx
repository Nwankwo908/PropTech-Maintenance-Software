import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import bgLogin from '@/assets/bg_Login.svg'
import { ADMIN_LOGIN_EMAIL_DOMAIN, signInAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

function IconEye({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="size-5 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
  return (
    <svg className="size-5 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 102.8 2.8M9.9 4.2A10.2 10.2 0 0112 4c6.5 0 10 7 10 7a18.2 18.2 0 01-4.8 5.2M6.6 6.6C4.2 7.8 2.4 10 2 12c0 0 3.5 7 10 7 1.1 0 2.1-.2 3.1-.5" />
    </svg>
  )
}

export function AdminLoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [alreadyAuthed, setAlreadyAuthed] = useState<boolean | null>(null)

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
    return <Navigate to="/admin" replace />
  }

  if (alreadyAuthed === null) {
    return (
      <div className="min-h-dvh bg-[#080913]" aria-busy="true" aria-label="Loading" />
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    setSubmitting(true)
    try {
      await signInAdmin(username, password)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#080913] font-sans">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src={bgLogin}
          alt=""
          className="h-full w-full min-h-dvh object-cover object-center"
          loading="eager"
          decoding="async"
        />
      </div>

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-10 px-6 pb-14 pt-6 sm:px-12 lg:flex-row lg:items-center lg:gap-[56px] lg:px-14 lg:py-20">
        <div className="w-full max-w-xl shrink-0 lg:w-auto">
          <p className="text-[28px] font-medium leading-snug tracking-[-0.02em] text-white sm:text-[32px] sm:leading-[1.5] sm:tracking-[-0.019em]">
            Maintenance intelligence system for property portfolios.
          </p>
        </div>

        <div className="w-full max-w-md shrink-0 lg:w-[28rem]">
          <div className="w-full">
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]">
              <div className="px-8 pb-0 pt-6">
                <h1 className="text-center text-[24px] font-bold leading-8 tracking-[0.0703px] text-[rgba(16,24,40,0.7)]">
                  Log In
                </h1>
                <p className="mt-2 text-center text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  Property Management Dashboard
                </p>
              </div>

              <form className="flex flex-col gap-6 px-8 pb-8 pt-8" onSubmit={onSubmit} noValidate>
                <div className="flex flex-col gap-2">
                  <label htmlFor="admin-username" className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                    Username
                  </label>
                  <input
                    id="admin-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/35 focus:bg-white focus:ring-2 focus:ring-[#944c73]/20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="admin-password" className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="admin-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-11 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/35 focus:bg-white focus:ring-2 focus:ring-[#944c73]/20"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-[#717182] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[#944c73]"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <IconEye visible={showPassword} />
                    </button>
                  </div>
                </div>

                {error ? (
                  <p className="text-[13px] leading-4 text-[#c10007]" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 w-full rounded-lg bg-[#0a0a0a] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-colors hover:bg-[#262626] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                >
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>

                <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[17px] pb-4 pt-[17px]">
                  <p className="text-[12px] font-medium leading-4 text-[#364153]">Demo Credentials:</p>
                  <div className="mt-2 flex flex-col gap-1 text-[12px] leading-4 text-[#4a5565]">
                    <p>
                      <span className="font-medium">Username:</span>{' '}
                      <span className="font-normal">admin</span>
                    </p>
                    <p>
                      <span className="font-medium">Password:</span>{' '}
                      <span className="font-normal">admin123</span>
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-[#6a7282]">
                      Supabase Auth email:{' '}
                      <span className="font-mono text-[#364153]">admin@{ADMIN_LOGIN_EMAIL_DOMAIN}</span>
                      {' — '}
                      <span className="break-all">
                        create this user in the dashboard with the password above.
                      </span>
                    </p>
                  </div>
                </div>
              </form>
            </div>

            {import.meta.env.DEV && !supabase ? (
              <p className="mt-4 text-center text-[12px] text-white/70">
                Dev mode: Supabase env missing —{' '}
                <span className="font-mono">/admin</span> stays available without login.
              </p>
            ) : null}
            {import.meta.env.PROD &&
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1') ? (
              <p className="mt-4 max-w-md text-center text-[11px] leading-4 text-white/75">
                Local preview uses port <span className="font-mono text-white">4173</span> (
                <code className="font-mono text-white/90">npm run preview</code>
                ); dev uses <span className="font-mono text-white">5173</span>. Open the exact URL from
                your terminal (e.g. <span className="font-mono text-white/90">/admin/login</span> on that origin).
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
