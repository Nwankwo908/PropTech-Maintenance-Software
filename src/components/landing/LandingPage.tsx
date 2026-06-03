import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EarlyAccessModal } from '@/components/landing/EarlyAccessModal'
import uloLogo from '@/assets/landing/ulo-logo.png'
import { playUiClickSound, primeUiClickSound } from '@/lib/uiClickSound'
import {
  captureWaitlistReferralFromUrl,
  consumeWaitlistOAuthIntent,
  joinWaitlistFromSessionEmail,
} from '@/lib/landingWaitlist'
import { supabase } from '@/lib/supabase'
import {
  IconArrowRight,
  IconClose,
  IconCpu,
  IconExcel,
  IconLayout,
  IconMenu,
  IconMessage,
  IconUsers,
} from '@/components/landing/LandingIcons'
import { Step1SmsChatMockup } from '@/components/landing/Step1SmsChatMockup'
import { CompletionRateDonut } from '@/components/landing/CompletionRateDonut'
import { Step2AiIntakeMockup } from '@/components/landing/Step2AiIntakeMockup'
import { FeaturesShowcase } from '@/components/landing/FeaturesShowcase'
import { BeforeAfterWorkflowSection } from '@/components/landing/BeforeAfterWorkflowSection'
import { HowItWorksStepReveal, HowItWorksStepsGrid } from '@/components/landing/HowItWorksStepReveal'

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

function LandingContentShell({
  className = '',
  contentClassName = '',
  children,
  ...props
}: React.ComponentProps<'div'> & { contentClassName?: string }) {
  return (
    <div className={[`w-full ${LANDING_VIEWPORT_GUTTER}`, className].filter(Boolean).join(' ')} {...props}>
      <div className={['min-w-0', LANDING_CONTENT_ALIGN, contentClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </div>
  )
}

function StepBadge({ n, variant = 'green' }: { n: number; variant?: 'green' | 'purple' }) {
  const bg =
    variant === 'purple'
      ? 'linear-gradient(180deg, #892383 0%, #ac60a6 100%)'
      : 'linear-gradient(135deg, rgb(16, 185, 129) 0%, rgb(5, 150, 105) 100%)'
  return (
    <span
      className="absolute -left-3 -top-3 flex size-7 items-center justify-center rounded-full border-[3px] border-white font-mono text-xs font-bold text-white shadow-[0_4px_6px_rgba(16,185,129,0.3)]"
      style={{ backgroundImage: bg }}
    >
      {n}
    </span>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [earlyAccessOpen, setEarlyAccessOpen] = useState(false)
  const [earlyAccessSuccess, setEarlyAccessSuccess] = useState(false)
  const [earlyAccessReferralLink, setEarlyAccessReferralLink] = useState('')
  useEffect(() => {
    primeUiClickSound()
  }, [])

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
    <div className="relative flex min-h-dvh flex-col bg-gradient-to-b from-white to-[#f0fdf4] font-[family-name:var(--font-landing)] text-[#111827]">
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
        <section className="overflow-x-clip">
          <LandingContentShell
            className="pb-12 pt-10 sm:pb-28 sm:pt-14 md:pb-32 lg:pt-14"
            contentClassName="min-w-0 w-full max-w-none"
          >
            <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase leading-snug tracking-wide text-black sm:px-4 sm:py-2 sm:text-xs">
              <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
              What If Rental Maintenance Ran Itself?
            </span>

            <h1 className="mt-4 w-full max-w-full text-balance font-[family-name:var(--font-landing-heading)] text-[clamp(1.875rem,5vw+1rem,7.5rem)] font-bold leading-[1.12] tracking-[-0.03em] text-[#111827] sm:mt-6 lg:leading-[1.05] lg:tracking-[-0.025em]">
              <span className="block">Your Tenants</span>
              <span className="block [overflow-wrap:anywhere]">
                <span className="text-[#0f1623]">Text. </span>
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(174deg, rgb(24, 121, 96) 0%, rgb(174, 225, 239) 100%)',
                  }}
                >
                  Ulo
                </span>
                <span className="text-[#0f1623]"> does the rest.</span>
              </span>
            </h1>

            <p className="mt-4 w-full max-w-full border-l-[3px] border-[#187960] pl-4 text-base leading-relaxed text-[#4b5563] sm:mt-6 sm:max-w-xl sm:pl-5 sm:text-lg lg:max-w-3xl">
              Tenant texts become completed repairs, automatically. From routine maintenance to
              emergency repairs, Ulo creates work orders, dispatches the right vendor, and tracks
              every repair from request to resolution.
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
          </LandingContentShell>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell>
          <div className="rounded-3xl border border-gray-200/80 bg-white p-6 shadow-[0_20px_30px_rgba(0,0,0,0.03),0_1px_1.5px_rgba(0,0,0,0.02)] sm:p-10 lg:shadow-none">
            <h2 className="inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-black">
              <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
              How it Works
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10 lg:items-start">
              <p className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-[#111827]">
                From report to resolution in four simple steps
              </p>
              <p className="text-lg font-normal leading-relaxed text-[#4b5563]">
                Ulo automates the day to day work of rental property ownership so landlords get their time back and tenants get faster, better service.
              </p>
            </div>

            <HowItWorksStepsGrid className="mt-10 grid grid-cols-1 items-start gap-4 lg:grid-cols-4">
              {/* Step 1 */}
              <HowItWorksStepReveal
                index={0}
                className="relative rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
              >
                <StepBadge n={1} />
                <Step1SmsChatMockup />
                <div className="mt-4 flex items-center gap-2">
                  <IconMessage className="size-4 text-emerald-600" />
                  <span className="text-sm font-bold">Resident SMS</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                  Residents text dedicated Ulo Maintenance number 24/7. No app, Install needed.
                </p>
              </HowItWorksStepReveal>

              {/* Step 2 */}
              <HowItWorksStepReveal
                index={1}
                className="relative h-fit self-start rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
              >
                <StepBadge n={2} />
                <Step2AiIntakeMockup />
                <div className="mt-4 flex items-center gap-2">
                  <IconCpu className="size-4 text-emerald-600" />
                  <span className="text-sm font-bold">AI Work Order</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                  AI assesses and capture details, urgency and category instantly.
                </p>
              </HowItWorksStepReveal>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2 lg:items-stretch">
                {/* Step 3 */}
                <HowItWorksStepReveal
                  index={2}
                  className="relative flex h-full flex-col rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
                >
                  <StepBadge n={3} />
                  <div className="rounded-2xl border border-[#e5e7eb] bg-white p-3">
                    <div className="flex flex-col gap-2">
                      {[
                        ['M', 'Mike P.', 'Plumber', '4.9', '2h away', '98%'],
                        ['J', 'Jess L.', 'Plumber', '4.7', '4h away', '91%'],
                      ].map(([initial, name, trade, rating, availability, match]) => (
                        <div
                          key={name}
                          className="flex items-center gap-2 rounded bg-[#f0f0f4] px-2 py-1"
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0f1623] font-mono text-[8px] font-bold text-white">
                            {initial}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-[10px] text-[#1e2939]">{name}</p>
                            <p className="truncate font-mono text-[10px] text-[#99a1af]">{trade}</p>
                            <p className="truncate font-mono text-[9px] text-[#6a7282]">
                              <span>Rating {rating}</span>
                              <span className="mx-1 text-[#d1d5db]">·</span>
                              <span>Avail. {availability}</span>
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-[#2a7a3b]">{match}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <IconUsers className="size-4 text-emerald-600" />
                    <span className="text-sm font-bold">Vendor Assignment</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                    You approve vendor. Scheduling done automatically. Zero back and forth.
                  </p>
                </HowItWorksStepReveal>

                {/* Step 4 */}
                <HowItWorksStepReveal
                  index={3}
                  className="relative flex h-full flex-col rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
                >
                  <StepBadge n={4} />
                  <div className="flex flex-1 flex-col">
                    <div className="rounded-xl border border-black/[0.04] bg-white p-[11px]">
                      <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ['Open', '14'],
                            ['In Progress', '8'],
                          ].map(([label, val]) => (
                            <div key={label} className="rounded bg-[#f0f0f4] px-2 py-1 text-center">
                              <p className="font-mono text-[10px] text-[#6a7282]">{label}</p>
                              <p className="font-mono text-sm font-bold text-[#1e2939]">{val}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded bg-[#f0f0f4] px-2 py-2">
                          <span className="font-mono text-[10px] text-[#6a7282]">Completion rate</span>
                          <CompletionRateDonut percent={87} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <IconLayout className="size-4 text-emerald-600" />
                    <span className="text-sm font-bold">Job Tracking</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                    Live status updates. Photo receipt and vendor payment on completion.
                  </p>
                </HowItWorksStepReveal>
              </div>
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
                Ulo can automate up to 80% of landlord coordination work.
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
          <LandingContentShell>
            <BeforeAfterWorkflowSection />
          </LandingContentShell>
        </section>
      </main>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-[#6b7280]">
        <p>© {new Date().getFullYear()} ülo home. All rights reserved.</p>
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
