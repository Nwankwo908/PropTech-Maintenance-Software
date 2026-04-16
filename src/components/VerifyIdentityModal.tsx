import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isValidEmailOtpToken,
  normalizeEmailOtpInput,
  shouldAutoSubmitEmailOtp,
  EMAIL_OTP_MAX_LEN,
} from '@/lib/emailOtp'
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  sendEmailOtp,
  verifyEmailOtpAndSignIn,
  type ResidentAuthPayload,
} from '@/lib/residentAuth'

/** Reported to parent so review-step buttons can disable during OTP send/verify. */
export type OtpModalFlowState =
  | 'idle'
  | 'sending'
  | 'enter_code'
  | 'verifying'

type VerifyIdentityModalProps = {
  open: boolean
  email: string
  onExit: () => void
  /** Called synchronously after successful `verifyOtp`; parent runs submit (do not await heavy work here). */
  onVerified: (auth: ResidentAuthPayload) => void
  /** Fires whenever the async step changes (for disabling Confirm / review UI). */
  onFlowStateChange?: (state: OtpModalFlowState) => void
}

export function VerifyIdentityModal({
  open,
  email,
  onExit,
  onVerified,
  onFlowStateChange,
}: VerifyIdentityModalProps) {
  const [step, setStep] = useState<'sending' | 'enter_code' | 'verifying'>(
    'sending',
  )
  const [busy, setBusy] = useState(false)
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [isResending, setIsResending] = useState(false)
  const otpInputRef = useRef<HTMLInputElement>(null)
  const verifyAttemptRef = useRef(false)
  const sendGenerationRef = useRef(0)

  const emitFlow = useCallback(
    (s: OtpModalFlowState) => {
      onFlowStateChange?.(s)
    },
    [onFlowStateChange],
  )

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1))
    }, 1000)
    return () => window.clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    if (!open) {
      setStep('sending')
      setBusy(false)
      setOtp('')
      setError(null)
      setSendError(null)
      setCooldown(0)
      setIsResending(false)
      verifyAttemptRef.current = false
      sendGenerationRef.current += 1
      emitFlow('idle')
      return
    }

    setOtp('')
    setError(null)
    setSendError(null)
    setCooldown(0)
    verifyAttemptRef.current = false
    const gen = ++sendGenerationRef.current
    emitFlow('sending')
    setStep('sending')
    setBusy(true)

    void (async () => {
      try {
        await sendEmailOtp(email)
        if (gen !== sendGenerationRef.current) return
        setStep('enter_code')
        emitFlow('enter_code')
        setCooldown(OTP_RESEND_COOLDOWN_SECONDS)
      } catch (e) {
        if (gen !== sendGenerationRef.current) return
        setSendError(
          e instanceof Error ? e.message : 'Could not send verification code.',
        )
        emitFlow('idle')
      } finally {
        if (gen === sendGenerationRef.current) setBusy(false)
      }
    })()
  }, [open, email, emitFlow])

  useEffect(() => {
    if (!open || step !== 'enter_code') return
    const id = window.requestAnimationFrame(() => {
      otpInputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, step])

  const startCooldown = useCallback(() => {
    setCooldown(OTP_RESEND_COOLDOWN_SECONDS)
  }, [])

  const retrySend = useCallback(async () => {
    setSendError(null)
    setError(null)
    setBusy(true)
    emitFlow('sending')
    setStep('sending')
    const gen = ++sendGenerationRef.current
    try {
      await sendEmailOtp(email)
      if (gen !== sendGenerationRef.current) return
      setStep('enter_code')
      emitFlow('enter_code')
      startCooldown()
    } catch (e) {
      if (gen !== sendGenerationRef.current) return
      setSendError(
        e instanceof Error ? e.message : 'Could not send verification code.',
      )
      emitFlow('idle')
    } finally {
      if (gen === sendGenerationRef.current) setBusy(false)
    }
  }, [email, emitFlow, startCooldown])

  const handleVerify = useCallback(
    async (code: string) => {
      const token = normalizeEmailOtpInput(code)
      if (!isValidEmailOtpToken(token)) {
        setError(
          'Enter the full code from your email (same length and characters as in the message).',
        )
        return
      }
      if (verifyAttemptRef.current) return
      verifyAttemptRef.current = true
      setError(null)
      setBusy(true)
      setStep('verifying')
      emitFlow('verifying')
      try {
        const auth = await verifyEmailOtpAndSignIn(email, token)
        setBusy(false)
        onVerified(auth)
      } catch (e) {
        verifyAttemptRef.current = false
        setBusy(false)
        setStep('enter_code')
        emitFlow('enter_code')
        const msg = e instanceof Error ? e.message : 'Verification failed.'
        const lower = msg.toLowerCase()
        if (
          lower.includes('expired') ||
          lower.includes('invalid') ||
          lower.includes('otp')
        ) {
          setError(
            'That code is invalid or has expired. Request a new code and try again.',
          )
        } else {
          setError(msg)
        }
      }
    },
    [email, onVerified, emitFlow],
  )

  function onOtpChange(raw: string) {
    const token = normalizeEmailOtpInput(raw)
    if (token.length < 6) verifyAttemptRef.current = false
    setOtp(token)
    setError(null)
    if (shouldAutoSubmitEmailOtp(token) && !busy) {
      void handleVerify(token)
    }
  }

  async function handleResend() {
    if (cooldown > 0 || busy || isResending) return
    setError(null)
    setIsResending(true)
    const gen = ++sendGenerationRef.current
    try {
      await sendEmailOtp(email)
      if (gen !== sendGenerationRef.current) return
      setOtp('')
      verifyAttemptRef.current = false
      startCooldown()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not resend the code.',
      )
    } finally {
      setIsResending(false)
    }
  }

  if (!open) return null

  const resendDisabled = busy || cooldown > 0 || isResending
  const resendLabel =
    cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-identity-title"
    >
      <div className="w-full max-w-md rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-lg">
        <h2
          id="verify-identity-title"
          className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
        >
          Confirm your request
        </h2>

        <p className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          Enter the <span className="font-medium text-[#0a0a0a]">verification code</span>{' '}
          sent to <span className="font-medium text-[#0a0a0a]">{email}</span> to confirm your
          maintenance request. Check spam if you don&apos;t see it.
        </p>

        {sendError && step === 'sending' && !busy && (
          <p
            className="mt-3 text-[13px] font-medium leading-4 text-red-600"
            role="alert"
          >
            {sendError}
          </p>
        )}

        {error && (
          <p
            className="mt-3 text-[13px] font-medium leading-4 text-red-600"
            role="alert"
          >
            {error}
          </p>
        )}

        {step === 'sending' && (
          <div className="mt-5">
            {busy ? (
              <p className="text-[14px] leading-5 text-[#364153]">
                Sending verification email…
              </p>
            ) : sendError ? (
              <button
                type="button"
                onClick={() => void retrySend()}
                className="h-9 w-full rounded-lg bg-[#9810fa] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#8710e0]"
              >
                Try again
              </button>
            ) : null}
          </div>
        )}

        {step === 'enter_code' && (
          <div className="mt-4">
            <label
              htmlFor="verify-otp"
              className="text-[12px] font-medium text-[#364153]"
            >
              One-time code
            </label>
            <input
              ref={otpInputRef}
              id="verify-otp"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={EMAIL_OTP_MAX_LEN}
              value={otp}
              onChange={(e) => onOtpChange(e.target.value)}
              placeholder="e.g. 12345678"
              disabled={busy}
              aria-describedby="verify-otp-hint"
              className="mt-1 w-full rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-center font-mono text-[24px] font-semibold tracking-[0.35em] text-[#0a0a0a] outline-none ring-[#944c73] focus:ring-2 disabled:opacity-60"
            />
            <p id="verify-otp-hint" className="mt-2 text-[12px] text-[#6a7282]">
              Use every character shown in the email. We continue automatically
              when the code length matches (e.g. 6, 8, or 10 digits).
            </p>
            <button
              type="button"
              disabled={busy || !isValidEmailOtpToken(otp)}
              onClick={() => void handleVerify(otp)}
              className="mt-3 h-9 w-full rounded-lg bg-[#9810fa] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#8710e0] disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Verify & submit'}
            </button>
            <button
              type="button"
              disabled={resendDisabled}
              onClick={() => void handleResend()}
              className="mt-2 h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-4 text-[14px] font-medium text-[#364153] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResending ? 'Sending…' : resendLabel}
            </button>
          </div>
        )}

        {step === 'verifying' && (
          <p className="mt-5 text-[14px] leading-5 text-[#364153]">
            Verifying code…
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null)
              setOtp('')
              sendGenerationRef.current += 1
              onExit()
            }}
            className="h-9 flex-1 rounded-lg border border-transparent px-4 text-[14px] font-medium text-[#6a7282] transition-colors hover:bg-[#f3f3f5] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
