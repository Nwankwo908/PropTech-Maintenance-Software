import { useEffect, useRef, useState, type FormEvent } from 'react'
import cleanPlatformIllustration from '@/assets/landing/clean-platform.png'
import puzzleHouseIllustration from '@/assets/landing/puzzle-house.png'
import technicianSinkRepairIllustration from '@/assets/landing/technician-sink-repair.png'
import tenantSinkLeakIllustration from '@/assets/landing/tenant-sink-leak.png'
import { IconClose } from '@/components/landing/LandingIcons'
import { prepareTryDemoLandlordScope } from '@/lib/activeLandlord'
import {
  applyTryDemoSession,
  mintTryDemoSession,
  sendTryDemoExperienceSms,
} from '@/lib/tryDemoSms'
import { playUiClickSound } from '@/lib/uiClickSound'

const PROPERTY_COUNT_OPTIONS = [
  { id: '1-10', label: '1–10' },
  { id: '11-50', label: '11–50' },
  { id: 'none', label: 'I don’t own any properties yet.' },
] as const

type PropertyCountId = (typeof PROPERTY_COUNT_OPTIONS)[number]['id']

const EXPERIENCE_OPTIONS = [
  {
    id: 'landlord',
    title: 'I’m a landlord',
    description: 'See how Ulo handles a tenant issue and keeps you informed.',
    image: puzzleHouseIllustration,
  },
  {
    id: 'resident',
    title: 'I’m a resident',
    description: 'Submit a sample maintenance request by text.',
    image: tenantSinkLeakIllustration,
  },
  {
    id: 'vendor',
    title: 'I’m a vendor',
    description: 'See how a job arrives and what to do next.',
    image: technicianSinkRepairIllustration,
  },
] as const

type ExperienceId = (typeof EXPERIENCE_OPTIONS)[number]['id']

const DEMO_STEP_TOTAL = 5

/** Survives HMR remounts so “no properties” still reaches step 6. */
const TRY_DEMO_PROPERTY_COUNT_KEY = 'ulo.tryDemoPropertyCount'
/** True while the modal is open — prevents HMR remounts from wiping mid-flow. */
const TRY_DEMO_FLOW_ACTIVE_KEY = 'ulo.tryDemoFlowActive'
const TRY_DEMO_STEP_KEY = 'ulo.tryDemoStep'

function readLockedPropertyCount(): PropertyCountId | null {
  try {
    const raw = window.sessionStorage.getItem(TRY_DEMO_PROPERTY_COUNT_KEY)
    if (raw === 'none' || raw === '1-10' || raw === '11-50') return raw
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
    if (Number.isInteger(n) && n >= 1 && n <= 6) return n
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
  const [propertyCount, setPropertyCount] = useState<PropertyCountId | null>(() => readLockedPropertyCount())
  const [workEmail, setWorkEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [experience, setExperience] = useState<ExperienceId | null>(null)
  const [experienceError, setExperienceError] = useState<string | null>(null)
  const [experienceSubmitting, setExperienceSubmitting] = useState(false)
  const wasOpenRef = useRef(false)
  /** Locked when leaving step 1 so remounts/HMR cannot skip the no-properties outcome. */
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
      setFirstName('')
      setLastName('')
      setNameError(null)
      setPhone('')
      setPhoneError(null)
      setExperience(null)
      setExperienceError(null)
      setExperienceSubmitting(false)
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

  const isNoPropertiesOutcome = step === 6
  const progressPct = isNoPropertiesOutcome ? 100 : Math.round((step / DEMO_STEP_TOTAL) * 100)
  const displayFirstName = firstName.trim() || 'there'

  function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  function looksLikePhone(value: string): boolean {
    const digits = value.replace(/\D/g, '')
    return digits.length >= 10 && digits.length <= 15
  }

  async function establishDemoAndNavigate(options?: {
    sendSampleSms?: boolean
  }): Promise<void> {
    prepareTryDemoLandlordScope()

    const sendSampleSms = options?.sendSampleSms !== false
    const result =
      sendSampleSms && experience
        ? await sendTryDemoExperienceSms({
            experience,
            phone,
            email: workEmail,
            firstName,
            forceResend: true,
          })
        : await mintTryDemoSession({ email: workEmail })

    if (!result.ok) {
      throw new Error(result.error || 'Could not open the demo account.')
    }

    if (result.smsError) {
      console.warn('[try-demo] sample SMS failed', result.smsError)
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
    if (experienceSubmitting) return
    playUiClickSound()
    setEmailError(null)
    setNameError(null)
    setPhoneError(null)
    setExperienceError(null)
    setStep((current) => Math.max(1, current - 1))
  }

  function onNextFromProperties() {
    if (!propertyCount) return
    propertyCountRef.current = propertyCount
    lockPropertyCount(propertyCount)
    playUiClickSound()
    setStep(2)
  }

  function onNextFromEmail(e: FormEvent) {
    e.preventDefault()
    const email = workEmail.trim()
    if (!looksLikeEmail(email)) {
      setEmailError('Enter a valid work email.')
      return
    }
    setEmailError(null)
    playUiClickSound()
    setStep(3)
  }

  function onNextFromNames(e: FormEvent) {
    e.preventDefault()
    const first = firstName.trim()
    const last = lastName.trim()
    if (!first || !last) {
      setNameError('Enter your first and last name.')
      return
    }
    setNameError(null)
    playUiClickSound()
    setStep(4)
  }

  function onNextFromPhone(e: FormEvent) {
    e.preventDefault()
    const value = phone.trim()
    if (!looksLikePhone(value)) {
      setPhoneError('Enter a valid phone number.')
      return
    }
    setPhoneError(null)
    playUiClickSound()
    setStep(5)
  }

  async function onNextFromExperience() {
    if (!experience || experienceSubmitting) return
    playUiClickSound()
    setExperienceError(null)
    setExperienceSubmitting(true)

    try {
      const lockedCount = propertyCountRef.current ?? propertyCount ?? readLockedPropertyCount()
      if (lockedCount === 'none') {
        // Sample text only — do not apply the demo session yet. LandingPage
        // redirects to /admin on SIGNED_IN, which would skip this outcome step.
        const result = await sendTryDemoExperienceSms({
          experience,
          phone,
          email: workEmail,
          firstName,
          forceResend: true,
        })
        if (!result.ok) {
          throw new Error(result.error || 'Could not send the sample text.')
        }
        if (result.smsError) {
          console.warn('[try-demo] sample SMS failed', result.smsError)
          setExperienceError(
            'We could not send the sample text yet. You can still explore the demo, or tap Next again to retry.',
          )
        }
        setStep(6)
        return
      }

      await establishDemoAndNavigate({ sendSampleSms: true })
    } catch (err) {
      console.error('[try-demo] enter failed', err)
      setExperienceError(
        err instanceof Error ? err.message : 'Could not open the demo account.',
      )
    } finally {
      setExperienceSubmitting(false)
    }
  }

  async function onExploreUlo() {
    if (experienceSubmitting) return
    playUiClickSound()
    setExperienceError(null)
    setExperienceSubmitting(true)
    try {
      // Re-send sample on Explore so “no properties” visitors still get the text
      // even if the earlier send was skipped or failed quietly.
      await establishDemoAndNavigate({ sendSampleSms: true })
    } catch (err) {
      console.error('[try-demo] explore enter failed', err)
      setExperienceError(
        err instanceof Error ? err.message : 'Could not open the demo account.',
      )
    } finally {
      setExperienceSubmitting(false)
    }
  }

  function onBackToHome() {
    playUiClickSound()
    onClose()
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
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
              {isNoPropertiesOutcome
                ? 'Ulo is built for rental property owners'
                : 'Get a live demo of Ulo Home'}
            </h2>
          </div>

          {!isNoPropertiesOutcome ? (
            <div className="mt-6" aria-label={`Step ${step} of ${DEMO_STEP_TOTAL}`}>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
                <div
                  className="h-full rounded-full bg-[#55B6A1] transition-[width] duration-[var(--sa-duration)] ease-[var(--sa-ease)]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <fieldset className="mt-8 border-0 p-0">
                <legend className="w-full text-left text-sm font-medium text-[#1f2937]">
                  How many properties do you have?
                </legend>
                <div
                  className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
                  role="radiogroup"
                  aria-label="Property count"
                >
                  {PROPERTY_COUNT_OPTIONS.map((option) => {
                    const selected = propertyCount === option.id
                    const fullWidth = option.id === 'none'
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setPropertyCount(option.id)}
                        className={[
                          'sa-press sa-surface flex min-h-[50px] items-center justify-center rounded-2xl border px-3 py-3 text-center text-sm font-semibold outline-none transition-[border-color,background-color,box-shadow] duration-[var(--sa-fast)] ease-[var(--sa-ease)] focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2',
                          fullWidth ? 'sm:col-span-2' : '',
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
                <button type="button" onClick={onBack} className={BACK_CLASS}>
                  Back
                </button>
                <button type="submit" disabled={!workEmail.trim()} className={NEXT_CLASS}>
                  Next
                </button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <form className="mt-8 flex flex-col" onSubmit={onNextFromNames} noValidate>
              <p className="text-left text-sm font-medium text-[#1f2937]">What&apos;s your name?</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="try-demo-first-name" className="sr-only">
                    First name
                  </label>
                  <input
                    id="try-demo-first-name"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value)
                      if (nameError) setNameError(null)
                    }}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="try-demo-last-name" className="sr-only">
                    Last name
                  </label>
                  <input
                    id="try-demo-last-name"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value)
                      if (nameError) setNameError(null)
                    }}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
              <div className="mt-2 min-h-4" aria-live="polite">
                {nameError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {nameError}
                  </p>
                ) : null}
              </div>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={onBack} className={BACK_CLASS}>
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!firstName.trim() || !lastName.trim()}
                  className={NEXT_CLASS}
                >
                  Next
                </button>
              </div>
            </form>
          ) : null}

          {step === 4 ? (
            <form className="mt-8 flex flex-col" onSubmit={onNextFromPhone} noValidate>
              <label htmlFor="try-demo-phone" className="text-left text-sm font-medium text-[#1f2937]">
                Thanks {displayFirstName}, what&apos;s your phone number?
              </label>
              <input
                id="try-demo-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  if (phoneError) setPhoneError(null)
                }}
                className={`${INPUT_CLASS} mt-4`}
              />
              <div className="mt-2 min-h-4" aria-live="polite">
                {phoneError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {phoneError}
                  </p>
                ) : null}
              </div>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={onBack} className={BACK_CLASS}>
                  Back
                </button>
                <button type="submit" disabled={!phone.trim()} className={NEXT_CLASS}>
                  Next
                </button>
              </div>
            </form>
          ) : null}

          {step === 5 ? (
            <>
              <fieldset className="mt-8 border-0 p-0">
                <legend className="w-full text-left text-sm font-medium text-[#1f2937]">
                  What would you like to experience?
                </legend>
                <div
                  className="mt-4 grid grid-cols-3 gap-3"
                  role="radiogroup"
                  aria-label="Demo experience"
                >
                  {EXPERIENCE_OPTIONS.map((option) => {
                    const selected = experience === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setExperience(option.id)
                          if (experienceError) setExperienceError(null)
                        }}
                        className={[
                          'sa-press sa-surface flex min-h-[50px] flex-col items-start gap-2 rounded-2xl border px-3 py-3 text-left outline-none transition-[border-color,background-color,box-shadow] duration-[var(--sa-fast)] ease-[var(--sa-ease)] focus-visible:ring-2 focus-visible:ring-[#55B6A1]/40 focus-visible:ring-offset-2',
                          selected
                            ? 'border-[#C68EC6] bg-[#faf5ff] text-[#0f1623] shadow-[0_0_0_1px_#C68EC6]'
                            : 'border-[#e5e7eb] bg-white text-[#1f2937] hover:border-[#d1d5db] hover:bg-[#f9fafb]',
                        ].join(' ')}
                      >
                        {option.image ? (
                          <img
                            src={option.image}
                            alt=""
                            aria-hidden
                            className="pointer-events-none mb-1 block h-auto w-auto max-h-[88px] max-w-full shrink-0 self-start"
                          />
                        ) : null}
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm font-semibold">{option.title}</span>
                          <span className="text-sm font-normal leading-snug text-[#6b7280]">
                            {option.description}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <div className="mt-2 min-h-4" aria-live="polite">
                {experienceError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {experienceError}
                  </p>
                ) : null}
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  disabled={experienceSubmitting}
                  className={BACK_CLASS}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!experience || experienceSubmitting}
                  onClick={() => {
                    void onNextFromExperience()
                  }}
                  className={NEXT_CLASS}
                >
                  {experienceSubmitting ? 'Opening…' : 'Next'}
                </button>
              </div>
            </>
          ) : null}

          {isNoPropertiesOutcome ? (
            <div className="mt-8 flex flex-col">
              <p className="text-left text-sm leading-relaxed text-[#4b5563]">
                Our demo is designed for landlords managing at least one rental property. Planning to
                become a landlord? You&apos;re welcome to explore what Ulo can do.
              </p>
              <div className="mt-2 min-h-4" aria-live="polite">
                {experienceError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {experienceError}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={experienceSubmitting}
                onClick={() => {
                  void onExploreUlo()
                }}
                className={`${CTA_CLASS} mt-8`}
              >
                {experienceSubmitting ? 'Opening…' : 'Explore Demo'}
              </button>
              <button
                type="button"
                onClick={onBackToHome}
                disabled={experienceSubmitting}
                className="sa-press mt-4 text-center text-sm font-medium text-[#6b7280] underline-offset-2 outline-none hover:text-[#1f2937] hover:underline focus-visible:ring-2 focus-visible:ring-[#d1d5db]/80 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Back to home
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
