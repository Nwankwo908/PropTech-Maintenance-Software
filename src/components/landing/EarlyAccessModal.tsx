import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import homeAutomationIllustration from '@/assets/landing/Home_Automation.png'
import { IconClose } from '@/components/landing/LandingIcons'
import {
  joinWaitlistByEmail,
  signInWaitlistWithGoogle,
} from '@/lib/landingWaitlist'

function IconGoogle({ className = 'size-[18px]' }: { className?: string }) {
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

function IconCheck({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type EarlyAccessModalProps = {
  open: boolean
  onClose: () => void
  initialSuccess?: boolean
  initialReferralLink?: string
}

export function EarlyAccessModal({
  open,
  onClose,
  initialSuccess = false,
  initialReferralLink = '',
}: EarlyAccessModalProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(initialSuccess)
  const [referralLink, setReferralLink] = useState(initialReferralLink)
  const [copyLabel, setCopyLabel] = useState('Copy Link')

  useEffect(() => {
    if (!open) return
    setSuccess(initialSuccess)
    setReferralLink(initialReferralLink)
    setCopyLabel('Copy Link')
    if (!initialSuccess) {
      setError(null)
      setEmail('')
    }
  }, [open, initialSuccess, initialReferralLink])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await joinWaitlistByEmail(email)
      setReferralLink(result.referralLink)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the waitlist.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onGoogleSignIn() {
    setError(null)
    setSubmitting(true)
    try {
      await signInWaitlistWithGoogle()
      if (import.meta.env.DEV) {
        setReferralLink(`${window.location.origin}/?ref=preview`)
        setSuccess(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onCopyReferralLink() {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopyLabel('Copied!')
      window.setTimeout(() => setCopyLabel('Copy Link'), 2000)
    } catch {
      setCopyLabel('Copy failed')
      window.setTimeout(() => setCopyLabel('Copy Link'), 2000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(147,137,199,0.4)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="early-access-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[min(90dvh,640px)] w-full max-w-[896px] flex-col overflow-hidden rounded-3xl bg-[#f5f3ff] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] lg:max-h-[500px] lg:min-h-[500px] lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/5 text-[#6b7280] transition hover:bg-black/10"
          aria-label="Close"
        >
          <IconClose />
        </button>

        <div
          className="early-access-art-panel relative isolate hidden shrink-0 overflow-hidden lg:block lg:w-[368px] lg:min-h-[500px]"
          style={{
            backgroundImage: `url(${homeAutomationIllustration}), linear-gradient(125.71deg, rgb(245, 243, 255) 0%, rgb(237, 233, 254) 100%)`,
            backgroundSize: '85%, cover',
            backgroundPosition: 'center, center',
            backgroundRepeat: 'no-repeat, no-repeat',
          }}
          aria-hidden
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-8 sm:p-12 lg:justify-center">
          {success ? (
            <div className="flex w-full flex-col items-center text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-[#10b981] text-white">
                <IconCheck />
              </div>

              <h2
                id="early-access-title"
                className="mt-6 font-[family-name:var(--font-landing-heading)] text-[clamp(1.5rem,4vw,1.875rem)] font-bold leading-tight text-[#1f2937]"
              >
                You&apos;re on the list!
              </h2>

              <p className="mt-2 max-w-md text-sm leading-5 text-[#6b7280]">
                Thanks for signing up! We&apos;ll notify you when Ulo is available and ready to try.{' '}
                <Link
                  to="/#how-it-works"
                  onClick={onClose}
                  className="font-medium text-[#6366f1] hover:underline"
                >
                  Learn more about Ulo Home →
                </Link>
              </p>

              <div className="mt-8 w-full max-w-md text-left">
                <p className="text-xs font-medium text-[#6b7280]">Your referral link</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div className="flex min-h-[58px] min-w-0 flex-1 items-center rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-[17px] py-3">
                    <p className="truncate text-left text-base text-[#1f2937]">{referralLink}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onCopyReferralLink()}
                    disabled={!referralLink}
                    className="h-[58px] shrink-0 rounded-2xl bg-[#1f2937] px-5 text-sm font-semibold text-white transition hover:bg-[#111827] disabled:opacity-60 sm:min-w-[114px]"
                  >
                    {copyLabel}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2
                  id="early-access-title"
                  className="font-[family-name:var(--font-landing-heading)] text-[clamp(1.5rem,4vw,1.875rem)] font-bold leading-tight text-[#1f2937]"
                >
                  Sign up to join the Ulo Home waitlist!
                </h2>
                <p className="mt-2 text-sm text-[#6b7280]">Sign up with your email address</p>
              </div>

              <form className="mt-8 flex flex-col" onSubmit={onSubmit} noValidate>
                <label
                  htmlFor="waitlist-email"
                  className="text-xs font-medium text-[#6b7280]"
                >
                  Email address
                </label>
                <input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  className="mt-2 h-[50px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-[17px] text-base text-[#1f2937] outline-none placeholder:text-[rgba(31,41,55,0.5)] focus:border-emerald-500/35 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
                />

                {error ? (
                  <p className="mt-3 text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-4 h-11 w-full rounded-2xl bg-[#0e5c45] text-sm font-semibold text-white outline-none transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                >
                  {submitting ? 'Joining…' : 'Continue'}
                </button>
              </form>

              <div className="mt-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#e5e7eb]" />
                <span className="text-xs text-[#9ca3af]">OR</span>
                <div className="h-px flex-1 bg-[#e5e7eb]" />
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void onGoogleSignIn()}
                className="mt-6 flex h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-sm font-medium text-[#1f2937] outline-none transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                <IconGoogle />
                Continue with Google
              </button>

              <p className="mt-6 text-center text-xs text-[#6b7280]">
                Already using Ulo Home?{' '}
                <Link
                  to="/admin/login"
                  onClick={onClose}
                  className="font-medium text-[#6366f1] hover:underline"
                >
                  Sign in here.
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
