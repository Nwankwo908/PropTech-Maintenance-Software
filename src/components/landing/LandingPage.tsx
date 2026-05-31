import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EarlyAccessModal } from '@/components/landing/EarlyAccessModal'
import uloLogo from '@/assets/landing/ulo-logo.png'
import skyscraperIcon from '@/assets/landing/skyscraper.png'
import mechanicIcon from '@/assets/landing/mechanic.png'
import peopleIcon from '@/assets/landing/people.png'
import {
  computeLandingRoi,
  formatAnnualSavings,
  formatHoursSaved,
  formatResolutionHours,
} from '@/lib/landingRoiCalculator'
import {
  captureWaitlistReferralFromUrl,
  consumeWaitlistOAuthIntent,
  joinWaitlistFromSessionEmail,
} from '@/lib/landingWaitlist'
import { supabase } from '@/lib/supabase'
import {
  IconArrowRight,
  IconChevronRight,
  IconClose,
  IconCpu,
  IconExcel,
  IconLayout,
  IconMenu,
  IconMessage,
  IconUsers,
} from '@/components/landing/LandingIcons'

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

/** Consistent vertical gap between hero, How it Works, and Features. */
const LANDING_SECTION_GAP = 'pb-8 lg:pb-10'

const ROI_PRIMARY_STATS = [
  {
    valueKey: 'hours' as const,
    label: 'Hours saved/week',
    sub: 'on ticket triage',
  },
  {
    valueKey: 'turnaround' as const,
    label: 'Faster turnaround',
    sub: 'avg. resolution time',
  },
  {
    valueKey: 'savings' as const,
    label: 'Annual savings',
    sub: 'labor & efficiency',
  },
]

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
  const [units, setUnits] = useState(50)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [earlyAccessOpen, setEarlyAccessOpen] = useState(false)
  const [earlyAccessSuccess, setEarlyAccessSuccess] = useState(false)
  const [earlyAccessReferralLink, setEarlyAccessReferralLink] = useState('')
  const roi = useMemo(() => computeLandingRoi(units), [units])
  const sliderPct = ((units - 1) / (500 - 1)) * 100

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

  function roiPrimaryValue(key: (typeof ROI_PRIMARY_STATS)[number]['valueKey']) {
    if (key === 'hours') return formatHoursSaved(roi.hoursSavedPerWeek)
    if (key === 'turnaround') return `${roi.fasterTurnaroundPct}%`
    return formatAnnualSavings(roi.annualSavings)
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
        <section className="min-h-[calc(100dvh-4rem)] lg:min-h-0">
          <LandingContentShell
            className={`pt-12 sm:pt-16 lg:pt-14 ${LANDING_SECTION_GAP}`}
            contentClassName="max-w-3xl min-w-0"
          >
                <span className="inline-flex rounded-full bg-[#d3f4ff] px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-[#5796aa]">
                  What If Rental Maintenance Ran Itself?
                </span>

                <h1 className="mt-6 font-[family-name:var(--font-landing-heading)] text-[clamp(2rem,11vw,3rem)] font-bold leading-[1.15] tracking-[-0.03em] text-[#111827] lg:text-[clamp(2.25rem,6vw,4.5rem)] lg:leading-[1.05] lg:tracking-[-0.025em]">
                  The SMS first
                  <br />
                  <span className="lg:whitespace-nowrap">Maintenance Operating System for</span>
                  <br />
                  <span className="inline-block lg:whitespace-nowrap">
                    <span
                      className="bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          'linear-gradient(174deg, rgb(24, 121, 96) 0%, rgb(180, 222, 234) 100%)',
                      }}
                    >
                      Independent
                    </span>
                    <span className="text-[#0f1623]"> Landlords.</span>
                  </span>
                </h1>

                <p className="mt-6 max-w-xl border-l-[3px] border-[#187960] pl-5 text-lg leading-relaxed text-[#4b5563] lg:max-w-3xl">
                  Your tenants already text about maintenance. Ulo organizes every request, coordinates
                  vendors, and keeps repairs moving without the constant back and forth.
                </p>

                <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
                  <PrimaryButton
                    onClick={openEarlyAccess}
                    className="w-full justify-center px-7 py-4 lg:w-auto"
                  >
                    Request Early Access
                    <IconArrowRight />
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={() => scrollTo('calculator')}
                    className="w-full rounded-lg border border-[#e5e7eb] bg-white px-6 py-4 text-sm font-semibold text-[#1f2937] transition hover:bg-gray-50 lg:w-auto"
                  >
                    Calculate Savings
                  </button>
                  <div className="flex items-center gap-4">
                    <IconExcel className="size-[25px]" />
                    <button
                      type="button"
                      className="text-sm font-medium text-[#6b7280] underline decoration-solid underline-offset-2"
                    >
                      Instant Excel import
                    </button>
                  </div>
                </div>

                <p className="mt-6 font-mono text-xs text-[#4b5563] lg:mt-6">
                  Workflow Automation · Operational decisions · No Setup Fee
                </p>
          </LandingContentShell>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell>
          <div className="rounded-3xl border border-gray-200/80 bg-white p-6 shadow-[0_20px_30px_rgba(0,0,0,0.03),0_1px_1.5px_rgba(0,0,0,0.02)] sm:p-10 lg:shadow-none">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="font-[family-name:var(--font-landing-heading)] text-2xl font-bold text-[#111827]">
                  How it Works
                </h2>
                <p className="mt-2 text-sm text-[#6b7280]">
                  From report to resolution — four steps, fully automated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => scrollTo('calculator')}
                className="hidden w-fit items-center gap-1.5 rounded-2xl border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#6b7280] transition hover:bg-gray-50 lg:inline-flex"
              >
                Calculate your Savings
                <IconChevronRight className="size-4" />
              </button>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-4">
              {/* Step 1 */}
              <div className="relative rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                <StepBadge n={1} />
                <div className="rounded-2xl border border-[#e5e7eb] bg-white p-3">
                  <div className="rounded-xl bg-[#e8e8ec] p-2">
                    <div className="mb-1.5 max-w-[126px] rounded-2xl rounded-bl-lg bg-white px-2 py-1 font-mono text-[10px] leading-snug text-[#364153] shadow-sm">
                      Bathroom faucet leaking — #204
                    </div>
                    <div className="flex justify-end">
                      <div className="max-w-[126px] rounded-2xl rounded-br-lg bg-[#0f1623] px-2 py-1 font-mono text-[10px] leading-snug text-white">
                        Got it! How urgent?
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <IconMessage className="size-4 text-emerald-600" />
                  <span className="text-sm font-bold">Resident SMS</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                  Residents text their issue 24/7 — no app, no login.
                </p>
              </div>

              {/* Step 2 */}
              <div className="relative rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                <StepBadge n={2} />
                <div className="rounded-2xl border border-[#e5e7eb] bg-white p-3">
                  <div className="flex flex-col gap-2">
                    {[
                      ['Category', 'Plumbing', 'bg-[#dbeafe] text-[#1447e6]'],
                      ['Urgency', 'High', 'bg-[#ffe2e2] text-[#c10007]'],
                      ['Unit', '#204', 'bg-[#f3f4f6] text-[#364153]'],
                    ].map(([label, value, chipClass]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded bg-[#f0f0f4] px-2 py-1"
                      >
                        <span className="font-mono text-[10px] text-[#6a7282]">{label}</span>
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${chipClass}`}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <IconCpu className="size-4 text-emerald-600" />
                  <span className="text-sm font-bold">AI Intake</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                  AI captures details, urgency, and category instantly.
                </p>
              </div>

              {/* Step 3 */}
              <div className="relative rounded-2xl border-2 border-[#e5e7eb] bg-[#f9fafb] p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                <StepBadge n={3} />
                <div className="rounded-2xl border border-[#e5e7eb] bg-white p-3">
                  <div className="flex flex-col gap-2">
                    {[
                      ['M', 'Mike P.', 'Plumber · 2h away', '98%'],
                      ['J', 'Jess L.', 'Plumber · 4h away', '91%'],
                    ].map(([initial, name, meta, score]) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 rounded bg-[#f0f0f4] px-2 py-1"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0f1623] font-mono text-[8px] font-bold text-white">
                          {initial}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[10px] text-[#1e2939]">{name}</p>
                          <p className="truncate font-mono text-[10px] text-[#99a1af]">{meta}</p>
                        </div>
                        <span className="font-mono text-[10px] text-[#2a7a3b]">{score}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <IconUsers className="size-4 text-emerald-600" />
                  <span className="text-sm font-bold">Vendor Assignment</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                  Best-matched vendor auto-routed with one-click confirm.
                </p>
              </div>

              {/* Step 4 */}
              <div
                className="relative rounded-2xl border-2 border-emerald-500 p-5 shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
                style={{ backgroundImage: TEAL_GRADIENT }}
              >
                <StepBadge n={4} variant="purple" />
                <div className="rounded-2xl border border-white/20 bg-white/15 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Open', '14'],
                      ['In Progress', '8'],
                    ].map(([label, val]) => (
                      <div key={label} className="rounded bg-white/10 px-2 py-1 text-center">
                        <p className="font-mono text-[10px] text-white/50">{label}</p>
                        <p className="font-mono text-sm font-bold text-white">{val}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded bg-white/10 px-2 py-1">
                    <span className="font-mono text-[10px] text-white/60">Avg. Resolution</span>
                    <span className="font-mono text-[10px] text-[#f5b800]">4.2h</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <IconLayout className="size-4 text-white" />
                  <span className="text-sm font-bold text-white">Dashboard Update</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-white/80">
                  Live status for managers, vendors, and residents.
                </p>
              </div>
            </div>
          </div>
          </LandingContentShell>
        </section>

        {/* Features */}
        <section id="features" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {[
              {
                icon: skyscraperIcon,
                label: 'Property Managers',
                labelClass: 'text-[#398398]',
                title: 'Full operational control',
                body: 'Maintenance intake, vendor routing, suspend payments, and real-time reporting — all from one dashboard.',
                link: '/admin',
              },
              {
                icon: mechanicIcon,
                label: 'Vendors & Contractors',
                labelClass: 'text-[#0284c7]',
                title: 'Kanban-style job board',
                body: 'Accept jobs, update status, upload photos, and flag delays directly from a mobile-first portal.',
                link: '/vendor',
              },
              {
                icon: peopleIcon,
                label: 'Residents',
                labelClass: 'text-[#52aad8]',
                title: 'SMS — no download needed',
                body: "Text any issue, get confirmation in seconds, and receive real-time updates until it's resolved.",
                link: '/request',
                iconWrap: true,
              },
            ].map((card) => (
              <Link
                key={card.label}
                to={card.link}
                className="group rounded-2xl border border-[#e5e7eb] bg-white p-7 shadow-[0_4px_8px_rgba(0,0,0,0.04)] transition hover:border-emerald-200 hover:shadow-md lg:shadow-none"
              >
                {card.iconWrap ? (
                  <div
                    className="flex size-11 items-center justify-center rounded-2xl"
                    style={{
                      backgroundImage:
                        'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
                    }}
                  >
                    <img src={card.icon} alt="" className="size-8 object-contain" />
                  </div>
                ) : (
                  <img src={card.icon} alt="" className="size-[42px] object-contain" />
                )}
                <p
                  className={`mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${card.labelClass}`}
                >
                  {card.label}
                </p>
                <h3 className="mt-2 font-[family-name:var(--font-landing-heading)] text-base font-bold">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">{card.body}</p>
              </Link>
            ))}
          </div>
          </LandingContentShell>
        </section>

        {/* ROI Calculator */}
        <section id="calculator" className="scroll-mt-20 pb-20">
          <LandingContentShell>
          <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-b from-white to-[#f0fdf4] shadow-[0_0_0_1px_rgba(16,185,129,0.05)]">
            <div className="pointer-events-none absolute -right-20 top-0 size-[500px] rounded-full bg-emerald-500/10 blur-[64px]" />
            <div className="pointer-events-none absolute -left-20 bottom-0 size-[400px] rounded-full bg-sky-500/10 blur-[64px]" />

            <div className="relative px-4 py-10 lg:px-0 lg:py-16">
              <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
                <span className="inline-flex rounded-full bg-[#d3f4ff] px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-[#5796aa]">
                  Interactive ROI Calculator
                </span>
                <h2 className="mt-6 font-[family-name:var(--font-landing-heading)] text-[clamp(1.75rem,8vw,3rem)] font-bold leading-tight text-[#111827]">
                  See Your Potential Savings
                </h2>
                <p className="mt-4 max-w-xl text-lg text-[#4b5563]">
                  Calculate how much time and money Ulo can save your property management team
                </p>

                <label className="mt-10 block w-full max-w-lg text-base font-bold lg:mt-12" htmlFor="units-slider">
                  How many units do you manage?
                </label>

                <div className="relative mt-5 w-full max-w-lg">
                  <div className="flex flex-col items-center rounded-2xl border-[3px] border-[#e5e7eb] bg-white px-9 py-6 shadow-[0_8px_12px_rgba(0,0,0,0.06)] lg:block lg:py-7 lg:shadow-none">
                    <output
                      htmlFor="units-slider"
                      className="block font-mono text-5xl font-bold text-[#111827]"
                    >
                      {units}
                    </output>
                    <span className="mt-1 font-mono text-base font-bold text-[#9ca3af] lg:absolute lg:right-9 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2">
                      units
                    </span>
                  </div>
                </div>

                <input
                  id="units-slider"
                  type="range"
                  min={1}
                  max={500}
                  value={units}
                  onChange={(e) => setUnits(Number(e.target.value))}
                  className="mt-6 h-3 w-full max-w-lg cursor-pointer appearance-none rounded-full bg-[#e5e7eb] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-300 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm"
                  style={{
                    background: `linear-gradient(to right, rgb(156,163,175) 0%, rgb(156,163,175) ${sliderPct}%, rgb(229,231,235) ${sliderPct}%, rgb(229,231,235) 100%)`,
                  }}
                  aria-valuemin={1}
                  aria-valuemax={500}
                  aria-valuenow={units}
                />

                <div className="mt-10 grid w-full max-w-5xl grid-cols-1 gap-5 lg:mt-12 lg:grid-cols-3">
                  {ROI_PRIMARY_STATS.map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-2xl border-2 border-[#e5e7eb] bg-white px-6 py-8 text-center shadow-[0_10px_15px_rgba(0,0,0,0.06)] lg:border-2 lg:shadow-none"
                    >
                      <p className="font-mono text-4xl font-bold leading-none text-[#8c8985] lg:text-[clamp(2.5rem,6vw,3.75rem)]">
                        {roiPrimaryValue(stat.valueKey)}
                      </p>
                      <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-[#6b7280]">
                        {stat.label}
                      </p>
                      <p className="mt-2 text-sm text-[#9ca3af]">{stat.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-8 border-t border-gray-200/50 pt-10 lg:mt-12 lg:grid-cols-3">
                  {[
                    { value: `${roi.timeRecoveredPerMonth} hrs/mo`, label: 'Time recovered' },
                    { value: `${roi.residentSatisfactionPct}%`, label: 'Resident satisfaction' },
                    {
                      value: formatResolutionHours(roi.avgResolutionHours),
                      label: 'Avg. resolution time',
                    },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <p className="font-[family-name:var(--font-landing-heading)] text-3xl font-bold">
                        {stat.value}
                      </p>
                      <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-[#6b7280]">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-10 flex w-full max-w-lg flex-col items-center gap-4 lg:mt-14 lg:max-w-none lg:flex-row lg:flex-wrap lg:justify-center">
                  <PrimaryButton
                    onClick={openEarlyAccess}
                    className="w-full gap-2.5 px-10 py-5 text-base font-bold shadow-[0_12px_20px_rgba(16,185,129,0.35)] lg:w-auto"
                  >
                    Request Early Access
                    <IconArrowRight className="size-5" />
                  </PrimaryButton>
                  <Link
                    to="/admin/login"
                    className="px-4 text-base font-semibold text-[#6b7280] underline underline-offset-2"
                  >
                    Login
                  </Link>
                </div>
              </div>
            </div>
          </div>
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
