import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EarlyAccessModal } from '@/components/landing/EarlyAccessModal'
import uloLogo from '@/assets/landing/ulo-logo.png'
import uloInteractionVideo from '@/assets/landing/Ulo Intereaction.webm'
import { playUiClickSound, primeUiClickSound } from '@/lib/uiClickSound'
import {
  captureWaitlistReferralFromUrl,
  consumeWaitlistOAuthIntent,
  hasWaitlistOAuthIntent,
  joinWaitlistFromSessionEmail,
} from '@/lib/landingWaitlist'
import { isAdminSessionAllowed } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'
import {
  IconArrowRight,
  IconClose,
  IconExcel,
  IconMenu,
} from '@/components/landing/LandingIcons'
import { FeaturesShowcase } from '@/components/landing/FeaturesShowcase'
import { BeforeAfterWorkflowSection } from '@/components/landing/BeforeAfterWorkflowSection'
import { HowItWorksStepReveal, HowItWorksStepsGrid } from '@/components/landing/HowItWorksStepReveal'
import smrStep from '@/assets/SMR.png'
import vaStep from '@/assets/VA.png'
import vcStep from '@/assets/VC.png'
import jtStep from '@/assets/JT.png'

const HOW_IT_WORKS_STEPS = [
  { src: smrStep, alt: 'Smart Maintenance Requests' },
  { src: vaStep, alt: 'Vendor Communication' },
  { src: vcStep, alt: 'Vendor Coordination dashboard' },
  { src: jtStep, alt: 'Job Tracking' },
] as const

const TEAL_GRADIENT =
  'linear-gradient(169deg, rgb(34, 154, 127) 0%, rgb(14, 92, 68) 100%)'

/** Viewport edge gutters — 24px mobile/tablet, 56px desktop. */
const LANDING_VIEWPORT_GUTTER = 'px-6 lg:px-14'

/** Full-width nav row — spans viewport with edge gutters only. */
const LANDING_NAV = `mx-auto flex w-full ${LANDING_VIEWPORT_GUTTER}`

/** Desktop offset from gutter (logo zone + 56px divider gap). */
const LANDING_CONTENT_ALIGN = 'lg:ml-[calc(8.25rem+3.5rem)]'

/** Full-page vertical divider — desktop only. */
const LANDING_NAV_DIVIDER =
  'pointer-events-none absolute inset-y-0 left-[calc(3.5rem+8.25rem)] z-[51] hidden w-px bg-gray-200/60 lg:block'

/** Horizontal section rules — align with LANDING_NAV_DIVIDER on desktop (8.25rem past lg gutter). */
const LANDING_SECTION_RULE = 'border-gray-200/80 lg:ml-[8.25rem]'

/** Consistent vertical gap between landing sections — 64px. */
const LANDING_SECTION_GAP = 'pb-16'

/** Hero video display width (px), scaled from metadata on load. */
const HERO_INTERACTION_VIDEO_WIDTH = 350

/** How long the last frame stays visible before the clip replays. */
const HERO_INTERACTION_VIDEO_LAST_FRAME_HOLD_MS = 10_000

function LandingContentShell({
  className = '',
  contentClassName = '',
  allowContentShrink = true,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  contentClassName?: string
  allowContentShrink?: boolean
}) {
  return (
    <div className={[`w-full ${LANDING_VIEWPORT_GUTTER}`, className].filter(Boolean).join(' ')} {...props}>
      <div
        className={[
          allowContentShrink ? 'min-w-0' : 'min-w-min',
          LANDING_CONTENT_ALIGN,
          contentClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    </div>
  )
}

function HeroInteractionVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  function syncSize(video: HTMLVideoElement) {
    const { videoWidth, videoHeight } = video
    if (!videoWidth || !videoHeight) return
    const scale = Math.min(1, HERO_INTERACTION_VIDEO_WIDTH / videoWidth)
    setSize({
      width: Math.round(videoWidth * scale),
      height: Math.round(videoHeight * scale),
    })
  }

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const video: HTMLVideoElement = el

    let holdTimeout: ReturnType<typeof setTimeout> | undefined

    function clearHoldTimeout() {
      if (holdTimeout !== undefined) {
        clearTimeout(holdTimeout)
        holdTimeout = undefined
      }
    }

    function startCycle() {
      clearHoldTimeout()
      video.currentTime = 0
      void video.play()
    }

    function onEnded() {
      video.pause()
      holdTimeout = setTimeout(startCycle, HERO_INTERACTION_VIDEO_LAST_FRAME_HOLD_MS)
    }

    video.addEventListener('ended', onEnded)
    startCycle()

    return () => {
      clearHoldTimeout()
      video.removeEventListener('ended', onEnded)
      video.pause()
    }
  }, [])

  return (
    <video
      ref={videoRef}
      src={uloInteractionVideo}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => syncSize(event.currentTarget)}
      style={
        size
          ? { width: size.width, height: size.height }
          : { width: HERO_INTERACTION_VIDEO_WIDTH, height: 'auto' }
      }
      className="block max-w-full bg-transparent"
      aria-label="Ulo handling a tenant maintenance text conversation"
    />
  )
}

function PrimaryButton({
  children,
  className = '',
  ...props
}: React.ComponentProps<'button'> & { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5',
        'text-sm font-semibold text-white',
        'shadow-[0_4px_14px_rgba(14,92,68,0.4)]',
        'transition-[transform,box-shadow,filter] duration-150 ease-out',
        'hover:brightness-110 hover:shadow-[0_10px_28px_rgba(14,92,68,0.5)] hover:-translate-y-0.5',
        'active:translate-y-px active:scale-[0.98] active:brightness-[0.92] active:shadow-[0_2px_10px_rgba(14,92,68,0.35)]',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0fdf4]',
        'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:translate-y-0 disabled:scale-100 disabled:brightness-100',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundImage: TEAL_GRADIENT }}
      {...props}
    >
      {children}
    </button>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [earlyAccessOpen, setEarlyAccessOpen] = useState(false)
  const [earlyAccessSuccess, setEarlyAccessSuccess] = useState(false)
  const [earlyAccessReferralLink, setEarlyAccessReferralLink] = useState('')
  useEffect(() => {
    primeUiClickSound()
  }, [])

  // Safety net for admin Google sign-in: if Supabase's redirect-URL allowlist
  // sends an OAuth return to the Site URL ("/") instead of /auth/callback, catch
  // the fresh SIGNED_IN here and forward authorized admins straight to /admin
  // (no second Login click). Waitlist Google returns are handled separately and
  // are skipped via the intent flag captured at mount.
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const waitlistReturn = hasWaitlistOAuthIntent()
    if (waitlistReturn) return

    let cancelled = false
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (cancelled || event !== 'SIGNED_IN' || !session) return
      if (isAdminSessionAllowed(session)) {
        navigate('/admin', { replace: true })
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [navigate])

  useEffect(() => {
    const fromReferral = captureWaitlistReferralFromUrl()
    if (fromReferral) {
      setEarlyAccessOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!consumeWaitlistOAuthIntent() || !supabase) return
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user.email
      if (!email) return
      try {
        const result = await joinWaitlistFromSessionEmail(email)
        setEarlyAccessReferralLink(result.referralLink)
        setEarlyAccessSuccess(true)
        setEarlyAccessOpen(true)
      } catch {
        setEarlyAccessOpen(true)
      } finally {
        await supabase.auth.signOut()
      }
    })()
  }, [])

  function openEarlyAccess() {
    playUiClickSound()
    setMobileMenuOpen(false)
    setEarlyAccessSuccess(false)
    setEarlyAccessReferralLink('')
    setEarlyAccessOpen(true)
  }

  function closeEarlyAccess() {
    setEarlyAccessOpen(false)
    setEarlyAccessSuccess(false)
    setEarlyAccessReferralLink('')
  }

  const navLinks = [
    { label: 'Home', target: 'top' },
    { label: 'How it Works', target: 'how-it-works' },
    { label: 'Features', target: 'features' },
  ] as const

  function scrollTo(id: string) {
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-gradient-to-b from-white to-[#f0fdf4] font-[family-name:var(--font-landing)] text-[#111827]">
      <div aria-hidden className={LANDING_NAV_DIVIDER} />
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-emerald-500/10 bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] backdrop-blur-sm">
        <div className={`${LANDING_NAV} h-16 items-center gap-0`}>
          <div className="flex h-full shrink-0 items-center border-r border-gray-200/60 pr-6">
            <Link to="/" className="block h-11 w-[121px] lg:h-11 lg:w-[108px]">
              <img src={uloLogo} alt="ülo home" className="h-full w-full object-contain object-left" />
            </Link>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end lg:justify-between lg:pl-14">
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
              {navLinks.map(({ label, target }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => scrollTo(target)}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] transition hover:bg-gray-50 hover:text-[#111827]"
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="hidden items-center gap-3 lg:flex">
              <Link
                to="/admin/login"
                className="rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] transition hover:bg-gray-50 hover:text-[#111827]"
              >
                Login
              </Link>
              <PrimaryButton onClick={openEarlyAccess} className="inline-flex">
                Request Early Access
                <IconArrowRight />
              </PrimaryButton>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 text-[#6b7280] transition hover:bg-gray-50 lg:hidden"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>
        {mobileMenuOpen ? (
          <div className="border-t border-gray-200/80 bg-white px-6 py-4 lg:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {navLinks.map(({ label, target }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => scrollTo(target)}
                  className="rounded-xl px-3 py-3 text-left text-sm font-medium text-[#6b7280] transition hover:bg-gray-50 hover:text-[#111827]"
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
              <Link
                to="/admin/login"
                className="rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] transition hover:bg-gray-50 hover:text-[#111827]"
                onClick={() => setMobileMenuOpen(false)}
              >
                Login
              </Link>
              <PrimaryButton
                onClick={openEarlyAccess}
                className="w-full justify-center py-3.5"
              >
                Request Early Access
                <IconArrowRight />
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </header>

      <main id="top" className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="overflow-visible">
          <LandingContentShell
            allowContentShrink={false}
            className="pb-12 pt-10 sm:pb-28 sm:pt-14 md:pb-32 lg:pt-14"
            contentClassName="w-full max-w-none overflow-visible"
          >
            <div className="grid grid-cols-1 items-start gap-10 overflow-visible lg:grid-cols-[minmax(0,1.5fr)_auto] lg:items-center lg:gap-12 xl:gap-16">
              <div className="relative z-10 min-w-0 w-full">
                <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase leading-snug tracking-wide text-black sm:px-4 sm:py-2 sm:text-xs">
                  <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
                  What If Rental Maintenance Ran Itself?
                </span>

                <h1 className="mt-4 w-full max-w-full text-balance font-[family-name:var(--font-landing-heading)] text-[clamp(1.875rem,5vw+1rem,7.5rem)] font-bold leading-[1.12] tracking-[-0.03em] text-[#111827] sm:mt-6 lg:leading-[1.05] lg:tracking-[-0.025em]">
                  <span className="block text-[#0f1623]">Your Tenants Text.</span>
                  <span className="block text-[#0f1623]">
                    <span
                      className="bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          'linear-gradient(174deg, rgb(24, 121, 96) 0%, rgb(174, 225, 239) 100%)',
                      }}
                    >
                      Ulo
                    </span>
                    {' does the rest.'}
                  </span>
                </h1>

                <p className="mt-4 w-full max-w-full border-l-[3px] border-[#187960] pl-4 text-base leading-relaxed text-[#4b5563] sm:mt-6 sm:pl-5 sm:text-lg lg:max-w-none">
                  <span className="block">
                    Tenant texts become completed repairs, automatically. From routine maintenance to emergency
                    repairs,
                  </span>
                  <span className="block">
                    Ulo creates work orders, dispatches the right vendor, and tracks every repair from request to
                    resolution.
                  </span>
                </p>

                <div className="mt-5 flex w-full max-w-full flex-col gap-4 sm:mt-6 md:flex-row md:flex-wrap md:items-center">
                  <PrimaryButton
                    onClick={openEarlyAccess}
                    className="w-full justify-center px-7 py-3.5 sm:py-4 md:w-auto"
                  >
                    Request Early Access
                    <IconArrowRight />
                  </PrimaryButton>
                  <div className="flex items-center justify-center gap-1 md:justify-start">
                    <IconExcel className="size-[25px] shrink-0" />
                    <button
                      type="button"
                      className="text-sm font-medium text-[#6b7280] underline decoration-solid underline-offset-2"
                    >
                      Instant Excel import
                    </button>
                  </div>
                </div>
              </div>

              <div className="mx-auto shrink-0 overflow-visible lg:mx-0 lg:-translate-x-[400px]">
                <HeroInteractionVideo />
              </div>
            </div>
          </LandingContentShell>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell>
          <div className="rounded-3xl border border-gray-200/80 bg-white p-6 shadow-[0_20px_30px_rgba(0,0,0,0.03),0_1px_1.5px_rgba(0,0,0,0.02)] sm:p-10 lg:shadow-none">
            <h2 className="inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-slate-900">
              <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
              How it Works
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10 lg:items-start">
              <p className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900">
                From report to resolution in four simple steps
              </p>
              <p className="text-lg font-normal leading-relaxed text-slate-700">
                Ulo automates the day to day work of rental property ownership so landlords get their time back and tenants get faster, better service.
              </p>
            </div>

            <HowItWorksStepsGrid className="mt-10 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS_STEPS.map((step, index) => (
                <HowItWorksStepReveal
                  key={`${step.alt}-${index}`}
                  index={index}
                  className="group mx-auto w-[91%] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-500 ease-out hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.05)] motion-reduce:transition-none"
                >
                  <img
                    src={step.src}
                    alt={step.alt}
                    className="block h-auto w-full origin-center transition-transform duration-500 ease-out group-hover:-translate-y-2 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100"
                    loading="lazy"
                    decoding="async"
                  />
                </HowItWorksStepReveal>
              ))}
            </HowItWorksStepsGrid>
          </div>
          </LandingContentShell>
        </section>

        {/* Features */}
        <section id="features" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <div className={LANDING_VIEWPORT_GUTTER}>
            <div className={`border-t ${LANDING_SECTION_RULE}`} aria-hidden />
          </div>
          <LandingContentShell className="py-16">
          <div>
            <h2 className="inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-black">
              <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
              Features
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10 lg:items-start">
              <p className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-[#111827]">
                Everything your property needs, automated.
              </p>
              <p className="text-lg font-normal leading-relaxed text-[#4b5563]">
              Ulo communicates with vendors, tracks progress, and follows up automatically so repairs stay on track. It can automate up to 80% of the coordination work that normally falls on landlords.
              </p>
            </div>
          </div>

          <FeaturesShowcase />
          </LandingContentShell>
          <div className={LANDING_VIEWPORT_GUTTER}>
            <div className={`border-b ${LANDING_SECTION_RULE}`} aria-hidden />
          </div>
        </section>

        {/* Before / After workflow */}
        <section id="workflow-comparison" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell contentClassName="max-w-none">
            <BeforeAfterWorkflowSection />
          </LandingContentShell>
        </section>
      </main>

      <footer className="flex flex-col items-center border-t border-gray-100 px-6 py-12 text-center sm:py-16">
        <img
          src={uloLogo}
          alt="ülo home"
          className="mx-auto h-auto w-[min(85vw,22rem)] max-w-full sm:w-96 md:w-[28rem] lg:w-[32rem]"
        />
        <p className="mt-8 text-sm text-[#6b7280]">
          © {new Date().getFullYear()} ülo home. All rights reserved.
        </p>
      </footer>

      <EarlyAccessModal
        open={earlyAccessOpen}
        onClose={closeEarlyAccess}
        initialSuccess={earlyAccessSuccess}
        initialReferralLink={earlyAccessReferralLink}
      />
    </div>
  )
}
