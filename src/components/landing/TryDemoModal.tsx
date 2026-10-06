import { useEffect, useRef, useState, type FormEvent } from 'react'
import cleanPlatformIllustration from '@/assets/landing/clean-platform.png'
import { IconClose } from '@/components/landing/LandingIcons'
import { prepareTryDemoLandlordScope } from '@/lib/activeLandlord'
import { applyTryDemoSession, mintTryDemoSession } from '@/lib/tryDemoSms'
import { playUiClickSound } from '@/lib/uiClickSound'

const PROPERTY_COUNT_OPTIONS = [
  { id: '0-1', label: '0–1 units' },
  { id: '2-4', label: '2–4 units' },
  { id: '5-10', label: '5–10 units' },
  { id: '11+', label: '11+ units' },
] as const

type PropertyCountId = (typeof PROPERTY_COUNT_OPTIONS)[number]['id']

const PROPERTY_COUNT_IDS = new Set<string>(PROPERTY_COUNT_OPTIONS.map((o) => o.id))

const DEMO_STEP_TOTAL = 2

const TRY_DEMO_PROPERTY_COUNT_KEY = 'ulo.tryDemoPropertyCount'
/** True while the modal is open — prevents HMR remounts from wiping mid-flow. */
const TRY_DEMO_FLOW_ACTIVE_KEY = 'ulo.tryDemoFlowActive'
const TRY_DEMO_STEP_KEY = 'ulo.tryDemoStep'

function readLockedPropertyCount(): PropertyCountId | null {
  try {
    const raw = window.sessionStorage.getItem(TRY_DEMO_PROPERTY_COUNT_KEY)
    if (raw && PROPERTY_COUNT_IDS.has(raw)) return raw as PropertyCountId
  } catch {
    // ignore
  }
  return null
}

function lockPropertyCount(value: PropertyCountId | null): void {
  try {
    if (!value) {
      window.sessionStorage.removeItem(TRY_DEMO_PROPERTY_COUNT_KEY)
      return
    }
    window.sessionStorage.setItem(TRY_DEMO_PROPERTY_COUNT_KEY, value)
  } catch {
    // ignore
  }
}

function readPersistedStep(): number | null {
  try {
    const raw = window.sessionStorage.getItem(TRY_DEMO_STEP_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isInteger(n) && n >= 1 && n <= 2) return n
  } catch {
    // ignore
  }
  return null
}

function persistStep(step: number): void {
  try {
    window.sessionStorage.setItem(TRY_DEMO_STEP_KEY, String(step))
  } catch {
    // ignore
  }
}

function clearPersistedStep(): void {
  try {
    window.sessionStorage.removeItem(TRY_DEMO_STEP_KEY)
  } catch {
    // ignore
  }
}

function isTryDemoFlowActive(): boolean {
  try {
    return window.sessionStorage.getItem(TRY_DEMO_FLOW_ACTIVE_KEY) === '1'
  } catch {
    return false
  }
}

function setTryDemoFlowActive(active: boolean): void {
  try {
    if (active) window.sessionStorage.setItem(TRY_DEMO_FLOW_ACTIVE_KEY, '1')
    else {
      window.sessionStorage.removeItem(TRY_DEMO_FLOW_ACTIVE_KEY)
      clearPersistedStep()
    }
  } catch {
    // ignore
  }
}

/** Caption under the work-email question (swap if product copy differs). */
const WORK_EMAIL_CAPTION = 'We’ll send your live demo access to this address.'

const INPUT_CLASS =
  'sa-surface h-[50px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-[17px] text-base text-[#1f2937] outline-none placeholder:text-[#4b5563] placeholder:opacity-100 focus:border-[#55B6A1]/50 focus:ring-2 focus:ring-[#55B6A1]/20'

const CTA_CLASS =
  'flex h-[46px] w-full shrink-0 items-center justify-center rounded-2xl bg-[#55B6A1] text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

const BACK_CLASS =
  'sa-press sa-surface flex h-[46px] min-w-0 flex-1 items-center justify-center rounded-2xl border border-[#d1d5db] bg-white text-sm font-semibold text-[#1f2937] outline-none hover:border-[#9ca3af] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#d1d5db]/80 focus-visible:ring-offset-2'

const NEXT_CLASS =
  'flex h-[46px] min-w-0 flex-1 items-center justify-center rounded-2xl bg-[#55B6A1] text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

type TryDemoModalProps = {
  open: boolean
  onClose: () => void
}

export function TryDemoModal({ open, onClose }: TryDemoModalProps) {
  const [step, setStep] = useState(() => readPersistedStep() ?? 1)
  const [propertyCount, setPropertyCount] = useState<PropertyCountId | null>(() =>
    readLockedPropertyCount(),
  )
  const [workEmail, setWorkEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const wasOpenRef = useRef(false)
  const propertyCountRef = useRef<PropertyCountId | null>(readLockedPropertyCount())

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      setTryDemoFlowActive(false)
      lockPropertyCount(null)
      return
    }
    const justOpened = !wasOpenRef.current && !isTryDemoFlowActive()
    wasOpenRef.current = true
    setTryDemoFlowActive(true)
    if (justOpened) {
      setStep(1)
      persistStep(1)
      setPropertyCount(null)
      propertyCountRef.current = null
      lockPropertyCount(null)
      setWorkEmail('')
      setEmailError(null)
      setSubmitting(false)
    } else {
      const locked = readLockedPropertyCount()
      if (locked) {
        propertyCountRef.current = locked
        setPropertyCount((prev) => prev ?? locked)
      }
      const savedStep = readPersistedStep()
      if (savedStep) setStep(savedStep)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    persistStep(step)
  }, [open, step])

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

  const progressPct = Math.round((step / DEMO_STEP_TOTAL) * 100)

  function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  async function establishDemoAndNavigate(): Promise<void> {
    prepareTryDemoLandlordScope()

    const result = await mintTryDemoSession({ email: workEmail })

    if (!result.ok) {
      throw new Error(result.error || 'Could not open the demo account.')
    }

    // Dev without edge mint still allows local /demo entry.
    const signedIn = await applyTryDemoSession(result.demoSession)
    if (!signedIn && result.demoSession) {
      throw new Error('Could not open the demo account.')
    }
    if (!signedIn && !import.meta.env.DEV) {
      throw new Error('Could not open the demo account.')
    }

    onClose()
    // Full navigation so AdminAuthGate remounts with the new Demo session.
    // welcome=1 is a durable handoff if storage is cleared mid-auth hop.
    window.location.assign('/demo?from=try-demo&welcome=1')
  }

  function onBack() {
    if (submitting) return
    playUiClickSound()
    setEmailError(null)
    setStep((current) => Math.max(1, current - 1))
  }

  function onNextFromProperties() {
    if (!propertyCount) return
    propertyCountRef.current = propertyCount
    lockPropertyCount(propertyCount)
    playUiClickSound()
    setStep(2)
  }

  async function onNextFromEmail(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    const email = workEmail.trim()
    if (!looksLikeEmail(email)) {
      setEmailError('Enter a valid work email.')
      return
    }
    setEmailError(null)
    playUiClickSound()
    setSubmitting(true)
    try {
      await establishDemoAndNavigate()
    } catch (err) {
      console.error('[try-demo] enter failed', err)
      setEmailError(
        err instanceof Error ? err.message : 'Could not open the demo account.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="sa-scrim fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(147,137,199,0.4)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="try-demo-title"
      onClick={onClose}
    >
      <div
        className="sa-modal relative flex w-full max-w-[896px] flex-col overflow-hidden rounded-3xl bg-[#f5f3ff] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] lg:min-h-[500px] lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="sa-press absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/5 text-[#6b7280] hover:bg-black/10"
          aria-label="Close"
        >
          <IconClose />
        </button>

        <div
          className="early-access-art-panel relative isolate hidden shrink-0 overflow-hidden lg:block lg:w-[368px] lg:self-stretch"
          style={{
            backgroundImage: `url(${cleanPlatformIllustration}), linear-gradient(125.71deg, rgb(245, 243, 255) 0%, rgb(237, 233, 254) 100%)`,
            backgroundSize: 'contain, cover',
            backgroundPosition: 'center, center',
            backgroundRepeat: 'no-repeat, no-repeat',
          }}
          aria-hidden
        />

        <div className="flex flex-1 flex-col overflow-hidden p-8 sm:p-12 lg:justify-center">
          <div className="text-center">
            <h2
              id="try-demo-title"
              className="font-[family-name:var(--font-landing-heading)] text-[clamp(1.5rem,4vw,1.875rem)] font-bold leading-tight text-[#1f2937]"
            >
              Get a live demo of Ulo Home
            </h2>
          </div>

          <div className="mt-6" aria-label={`Step ${step} of ${DEMO_STEP_TOTAL}`}>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
              <div
                className="h-full rounded-full bg-[#55B6A1] transition-[width] duration-[var(--sa-duration)] ease-[var(--sa-ease)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {step === 1 ? (
            <>
              <fieldset className="mt-8 border-0 p-0">
                <legend className="w-full text-left text-sm font-medium text-[#1f2937]">
                  How many units do you have?
                </legend>
                <div
                  className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
                  role="radiogroup"
                  aria-label="Unit count"
                >
                  {PROPERTY_COUNT_OPTIONS.map((option) => {
                    const selected = propertyCount === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setPropertyCount(option.id)}
                        className={[
                          'sa-press sa-surface flex min-h-[50px] items-center justify-center rounded-2xl border px-3 py-3 text-center text-sm font-semibold outline-none transition-[border-color,background-color,box-shadow] duration-[var(--sa-fast)] ease-[var(--sa-ease)] focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2',
                          selected
                            ? 'border-[#C68EC6] bg-[#faf5ff] text-[#0f1623] shadow-[0_0_0_1px_#C68EC6]'
                            : 'border-[#e5e7eb] bg-white text-[#1f2937] hover:border-[#d1d5db] hover:bg-[#f9fafb]',
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <button
                type="button"
                disabled={!propertyCount}
                onClick={onNextFromProperties}
                className={`${CTA_CLASS} mt-8`}
              >
                Get Started
              </button>
            </>
          ) : null}

          {step === 2 ? (
            <form className="mt-8 flex flex-col" onSubmit={onNextFromEmail} noValidate>
              <label htmlFor="try-demo-work-email" className="text-left text-sm font-medium text-[#1f2937]">
                What&apos;s your work email?
              </label>
              <p className="mt-1 text-left text-sm text-[#6b7280]">{WORK_EMAIL_CAPTION}</p>
              <input
                id="try-demo-work-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="name@company.com"
                value={workEmail}
                onChange={(e) => {
                  setWorkEmail(e.target.value)
                  if (emailError) setEmailError(null)
                }}
                className={`${INPUT_CLASS} mt-4`}
              />
              <div className="mt-2 min-h-4" aria-live="polite">
                {emailError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {emailError}
                  </p>
                ) : null}
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  disabled={submitting}
                  className={BACK_CLASS}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!workEmail.trim() || submitting}
                  className={NEXT_CLASS}
                >
                  {submitting ? 'Opening…' : 'Next'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
