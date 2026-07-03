import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EarlyAccessModal } from '@/components/landing/EarlyAccessModal'
import uloLogo from '@/assets/landing/ulo-logo.png'
import heroBlueprint from '@/assets/landing/hero-blueprint.png'
import heroArrow from '@/assets/Arrow_01.svg'
import heroVideoCorner from '@/assets/Highlight_05.png'
import uloInteractionSvg from '@/assets/Ulo Intereaction (1).svg'
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
  LANDING_DOCUMENT_IMPORT_ICONS,
  IconMenu,
} from '@/components/landing/LandingIcons'
import { FeaturesShowcase } from '@/components/landing/FeaturesShowcase'
import { BeforeAfterWorkflowSection } from '@/components/landing/BeforeAfterWorkflowSection'
import { HowItWorksStepReveal, HowItWorksStepsGrid } from '@/components/landing/HowItWorksStepReveal'
import smrStep from '@/assets/SMR_1.png'
import vaStep from '@/assets/VC_0_1.png'
import vcStep from '@/assets/VC_2_1.png'
import jtStep from '@/assets/JT_1.png'

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
const LANDING_CONTENT_ALIGN = '2xl:ml-[calc(8.25rem+3.5rem)]'

/** Full-page vertical divider — wide desktop only. */
const LANDING_NAV_DIVIDER =
  'pointer-events-none absolute inset-y-0 left-[calc(3.5rem+8.25rem)] z-[51] hidden w-px bg-gray-200/60 2xl:block'

/** Horizontal section rules — align with LANDING_NAV_DIVIDER on wide desktop. */
const LANDING_SECTION_RULE = 'border-gray-200/80 2xl:ml-[8.25rem]'

/** Consistent vertical gap between landing sections — 64px. */
const LANDING_SECTION_GAP = 'pb-16'

/** Max width of hero copy on wide desktop. */
const HERO_COPY_MAX_WIDTH = '40rem'

/** Hero interaction display width (px). SVG native width is 543px. */
const HERO_INTERACTION_VIDEO_WIDTH = 364
const HERO_INTERACTION_ASPECT = 1010 / 543

/** Layout slot for the hero phone clip — matches rendered width. */
const HERO_VIDEO_COLUMN_WIDTH = `${HERO_INTERACTION_VIDEO_WIDTH}px`

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
  const displayWidth = HERO_INTERACTION_VIDEO_WIDTH
  const displayHeight = Math.round(displayWidth * HERO_INTERACTION_ASPECT)

  return (
    <div className="relative mx-auto bg-transparent [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-[291px] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:inline-block [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:inline-block min-[1440px]:inline-block">
      <img
        src={heroVideoCorner}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 z-10 h-[25px] w-[23px] opacity-80"
      />
      <img
        src={heroVideoCorner}
        alt=""
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 z-10 h-[25px] w-[23px] opacity-80"
        style={{ transform: 'rotate(180deg)' }}
      />
      <object
        data={uloInteractionSvg}
        type="image/svg+xml"
        width={displayWidth}
        height={displayHeight}
        aria-label="Ulo handling a tenant maintenance text conversation"
        className="mx-auto block h-auto w-full max-w-full bg-transparent"
      />
    </div>
  )
}

function HeroHeadlineAndCopy() {
  const headlineRef = useRef<HTMLHeadingElement>(null)
  const [copyWidth, setCopyWidth] = useState<number>()
  const [fullWidthCopy, setFullWidthCopy] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(
      '(max-width: 1004px) and (min-height: 1400px) and (max-height: 1500px)',
    )
    const syncLayoutMode = () => setFullWidthCopy(mq.matches)
    syncLayoutMode()
    mq.addEventListener('change', syncLayoutMode)
    return () => mq.removeEventListener('change', syncLayoutMode)
  }, [])

  useEffect(() => {
    if (fullWidthCopy) return

    const node = headlineRef.current
    if (!node) return

    const syncWidth = () => {
      setCopyWidth(node.getBoundingClientRect().width)
    }

    syncWidth()
    const observer = new ResizeObserver(syncWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [fullWidthCopy])

  return (
    <>
      <h1
        ref={headlineRef}
        className="mt-4 w-fit max-w-full font-[family-name:var(--font-landing-heading)] text-[clamp(2.25rem,6vw+1.2rem,9rem)] font-bold tracking-[-0.03em] text-[#0f1623] sm:mt-6 [@media(max-width:1004px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-full [@media(min-width:451px)_and_(max-width:1004px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,9vw+1.8rem,13.5rem)] [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.475rem,6.6vw+1.32rem,9.9rem)] [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.7rem,7.2vw+1.44rem,10.8rem)] [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(2.5875rem,6.9vw+1.38rem,10.35rem)] [@media(min-width:400px)_and_(max-width:500px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.8125rem,7.5vw+1.5rem,11.25rem)] [@media(min-width:400px)_and_(max-width:450px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(2.5875rem,6.9vw+1.38rem,10.35rem)] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(3.6rem,9.6vw+1.92rem,14.4rem)] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,9vw+1.8rem,13.5rem)] [@media(min-width:851px)_and_(max-width:1004px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,8.5vw+1.6rem,13.5rem)] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.625rem,5.25vw,4.125rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(2.625rem,6.144vw,9.6rem)] min-[1440px]:text-[clamp(2.25rem,3.84vw,6rem)] [@media(min-width:1440px)_and_(max-width:1535px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(3.825rem,6.528vw,10.2rem)] [@media(min-width:1440px)_and_(max-width:1535px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.6rem,6.144vw,9.6rem)] lg:tracking-[-0.025em]"
        style={{ lineHeight: 0.82 }}
      >
        <span className="block whitespace-nowrap">Your tenants</span>
        <span className="block whitespace-nowrap">
          text.{' '}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(174deg, rgb(24, 121, 96) 0%, rgb(174, 225, 239) 100%)',
            }}
          >
            Ulo
          </span>{' '}
          does
        </span>
        <span className="block">the rest</span>
      </h1>

      <p
        className="mt-4 box-border max-w-full border-l-[3px] border-[#187960] pl-4 text-base text-[#4b5563] sm:mt-6 sm:pl-5 sm:text-lg [@media(max-width:1004px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-full"
        style={{
          lineHeight: 1.15,
          width: fullWidthCopy ? undefined : copyWidth,
        }}
      >
        From routine maintenance to emergency repairs, Ulo creates work orders, dispatches the right
        vendor, and tracks every repair from request to resolution.
      </p>
    </>
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
          <div className="flex min-w-0 flex-1 items-center justify-end">
            <div className="hidden items-center gap-1 lg:flex">
              <nav className="flex items-center gap-1" aria-label="Primary">
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
              <Link
                to="/admin/login"
                className="ml-2 rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] transition hover:bg-gray-50 hover:text-[#111827]"
              >
                Login
              </Link>
              <PrimaryButton onClick={openEarlyAccess} className="ml-2 inline-flex">
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
        <section className="relative overflow-hidden min-[2560px]:flex min-[2560px]:min-h-[calc(100dvh-4rem)] min-[2560px]:items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.14]"
            style={{ backgroundImage: `url(${heroBlueprint})` }}
          />
          <LandingContentShell
            className="relative z-10 w-full pb-12 pt-10 sm:pb-28 sm:pt-14 md:pb-32 lg:pt-14 min-[2560px]:pb-16 min-[2560px]:pt-16"
            contentClassName="w-full max-w-none [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:!ml-0 [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:flex [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:justify-center [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:!ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:justify-center min-[1440px]:!ml-0 min-[1440px]:flex min-[1440px]:justify-center"
          >
            <div
              className="grid w-full grid-cols-1 items-start gap-10 [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:mx-auto [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:flex [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:w-auto [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-full [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:flex-row [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:flex-nowrap [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:items-center [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:gap-4 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:mx-auto [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:w-auto [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-full [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex-row [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex-nowrap [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:items-center [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:gap-[clamp(1.5rem,3vw,3.125rem)] min-[1440px]:mx-auto min-[1440px]:flex min-[1440px]:w-auto min-[1440px]:max-w-full min-[1440px]:flex-row min-[1440px]:flex-nowrap min-[1440px]:items-center min-[1440px]:gap-8 min-[1440px]:gap-y-0 min-[2560px]:gap-12"
              style={
                {
                  '--hero-copy-max-w': HERO_COPY_MAX_WIDTH,
                  '--hero-video-col-w': HERO_VIDEO_COLUMN_WIDTH,
                } as React.CSSProperties
              }
            >
              <div className="relative z-10 min-w-0 w-full max-w-full [@media(max-width:1004px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-[22rem] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:shrink [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-[clamp(20rem,38vw,40rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:shrink [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:pr-0 min-[1440px]:ml-0 min-[1440px]:max-w-[var(--hero-copy-max-w)] min-[1440px]:pr-0 min-[1440px]:shrink">
                <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase leading-snug tracking-wide text-black sm:px-4 sm:py-2 sm:text-xs [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex-nowrap [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:whitespace-nowrap [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:gap-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[9px] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:tracking-tight">
                  <span className="inline-flex items-center gap-2 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:hidden">
                    <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
                    What If Rental Maintenance Ran Itself?
                  </span>
                  <span className="hidden [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:inline-flex [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:items-center [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden />
                      What
                    </span>
                    <span> If Rental Maintenance Ran Itself?</span>
                  </span>
                </span>

                <HeroHeadlineAndCopy />

                <div className="mt-5 flex w-full max-w-full flex-col gap-4 sm:mt-6 md:flex-row md:flex-wrap md:items-center">
                  <PrimaryButton
                    onClick={openEarlyAccess}
                    className="w-full justify-center px-7 py-3.5 sm:py-4 md:w-auto"
                  >
                    Request Early Access
                    <IconArrowRight />
                  </PrimaryButton>
                  <div className="flex flex-nowrap items-center justify-center gap-2 md:justify-start [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:1400px)_and_(max-height:1500px)]:flex-col [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:1400px)_and_(max-height:1500px)]:items-center [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:1400px)_and_(max-height:1500px)]:gap-1">
                    <button
                      type="button"
                      className="shrink-0 whitespace-nowrap text-sm font-medium text-[#6b7280] underline decoration-solid underline-offset-2"
                    >
                      Bring Your Existing Data
                    </button>
                    <div className="flex shrink-0 items-center gap-1" aria-hidden>
                      {LANDING_DOCUMENT_IMPORT_ICONS.map((Icon) => (
                        <span
                          key={Icon.name}
                          className="inline-flex drop-shadow-[0_1px_1px_rgba(15,23,42,0.24)] drop-shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                        >
                          <Icon className="size-[25px] shrink-0" />
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div
                aria-hidden
                className="relative z-[5] mx-auto flex shrink-0 items-center justify-center self-center py-1 [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:py-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:py-0 min-[1440px]:py-0"
              >
                <img
                  src={heroArrow}
                  alt=""
                  className="block size-[4.2rem] origin-center [transform:rotate(120deg)] sm:size-[4.8rem] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:size-[3.6rem] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:[transform:rotate(-40deg)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:size-[clamp(3rem,4.5vw,6rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:[transform:rotate(-40deg)] min-[1440px]:size-24 min-[1440px]:[transform:rotate(-40deg)] min-[2560px]:size-[7.2rem]"
                />
              </div>

              <div className="relative z-0 mx-auto flex shrink-0 justify-center [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:w-[291px] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:ml-3 [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:mr-0 [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:w-[280px] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:mr-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:w-[clamp(280px,26vw,364px)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1400px)_and_(max-height:1500px)]:shrink-0 min-[1440px]:ml-8 min-[1440px]:mr-0 min-[1440px]:w-[var(--hero-video-col-w)] min-[2560px]:ml-12">
                <HeroInteractionVideo />
              </div>
            </div>
          </LandingContentShell>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className={`scroll-mt-20 ${LANDING_SECTION_GAP}`}>
          <LandingContentShell>
          <div className="rounded-3xl border border-gray-200/80 bg-[#E6E9F2] p-6 shadow-[0_20px_30px_rgba(0,0,0,0.03),0_1px_1.5px_rgba(0,0,0,0.02)] sm:p-10 lg:shadow-none">
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
