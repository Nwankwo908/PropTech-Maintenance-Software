import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
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
  IconFocusFeature,
  IconGraph,
  LANDING_DOCUMENT_IMPORT_ICONS,
  IconMenu,
} from '@/components/landing/LandingIcons'
import { FeaturesMarquee } from '@/components/landing/FeaturesMarquee'
import { FeaturesShowcase } from '@/components/landing/FeaturesShowcase'
import howItWorksIpad from '@/assets/iPad Pro (portrait).png'

const TEAL_GRADIENT =
  'linear-gradient(169deg, rgb(34, 154, 127) 0%, rgb(14, 92, 68) 100%)'

/** Viewport edge gutters — 24px mobile/tablet, 56px desktop. */
const LANDING_VIEWPORT_GUTTER = 'px-6 lg:px-14'

/** Full-width nav row — spans viewport with edge gutters only. */
const LANDING_NAV = `mx-auto flex w-full ${LANDING_VIEWPORT_GUTTER}`

/** Desktop offset from gutter (logo zone + 56px divider gap). */
const LANDING_CONTENT_ALIGN = '2xl:ml-[calc(8.25rem+3.5rem)]'

/** Right edge of header logo column — viewport gutter + logo width + pr-6. */
const LANDING_LOGO_COLUMN_RULE_LEFT =
  'left-[calc(1.5rem+121px+1.5rem)] lg:left-[calc(3.5rem+108px+1.5rem)] landing-3840-2160:!left-[calc(3.5rem+162px+1.5rem)] landing-4096-2304:!left-[calc(3.5rem+172.8px+1.5rem)] landing-5120-2880:!left-[calc(3.5rem+172.8px+1.5rem)] landing-7680-4320:!left-[calc(3.5rem+270px+3.75rem)]'

/** Vertical rule aligned with the header logo column’s right border. */
const LANDING_LOGO_COLUMN_DIVIDER = `pointer-events-none absolute w-px bg-gray-200/60 ${LANDING_LOGO_COLUMN_RULE_LEFT}`

/** Section-height logo-column rule — hide on compact/phone/tablet portrait. */
const LANDING_SECTION_COLUMN_RULE = `${LANDING_LOGO_COLUMN_DIVIDER} top-0 bottom-0 max-[399px]:hidden landing-compact:hidden landing-phone-tall:hidden landing-tablet-portrait:hidden`

/** Section content inset — right of logo-column divider + 56px gap; keeps right viewport gutter. */
const LANDING_BEYOND_LOGO_COLUMN_INSET =
  'w-full pl-[calc(1.5rem+121px+1.5rem+3.5rem)] pr-6 lg:pl-[calc(3.5rem+108px+1.5rem+3.5rem)] lg:pr-14 landing-3840-2160:!pl-[calc(3.5rem+162px+1.5rem+3.5rem)] landing-4096-2304:!pl-14 landing-5120-2880:!pl-14 landing-4096-2304:!pr-14 landing-5120-2880:!pr-14 max-[399px]:!pl-6 max-[399px]:!pr-6 landing-compact:!pl-6 landing-compact:!pr-6 landing-phone-tall:!pl-6 landing-phone-tall:!pr-6 landing-tablet-portrait:!pl-6 landing-tablet-portrait:!pr-6'

/** Full-page vertical divider — wide desktop only. */
const LANDING_NAV_DIVIDER = `${LANDING_LOGO_COLUMN_DIVIDER} inset-y-0 z-[51] hidden 2xl:block landing-desktop:!hidden landing-1680-1050:!hidden landing-1512-982:!hidden landing-1728-1117:!hidden`

/** Full-bleed horizontal rule — spans viewport edge to edge. */
const LANDING_FULL_WIDTH_RULE = 'border-gray-200/80'

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
    <div className="relative mx-auto bg-transparent [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-[291px] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:max-w-none [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:inline-block [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:max-w-none [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:inline-block min-[1440px]:inline-block">
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
      '(max-width: 1019px)',
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
        className="mt-4 w-fit max-w-full font-[family-name:var(--font-landing-heading)] leading-[56px] landing-compact:leading-[48px] landing-432:!text-[13.8vw] landing-432:!leading-[1.08] text-[clamp(2.25rem,6vw+1.2rem,9rem)] font-bold tracking-[-0.03em] text-[#0f1623] sm:mt-6 max-[1019px]:!w-full landing-tablet-portrait:!leading-[58px] [@media(min-width:451px)_and_(max-width:1019px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,9vw+1.8rem,13.5rem)] [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.475rem,6.6vw+1.32rem,9.9rem)] [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.7rem,7.2vw+1.44rem,10.8rem)] landing-phone-tall:!leading-[56px] landing-phone-tall-hero-leading landing-884-hero-leading landing-1440-900-hero-leading landing-1920-1080-hero-leading landing-1920-1200-hero-leading landing-2560-1440-hero-leading landing-desktop-hero-leading landing-3440-1440-hero-leading landing-3840-2160-hero-leading landing-4096-2304-hero-leading landing-5120-2880-hero-leading [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(2.5875rem,6.9vw+1.38rem,10.35rem)] [@media(min-width:400px)_and_(max-width:500px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(2.8125rem,7.5vw+1.5rem,11.25rem)] [@media(min-width:400px)_and_(max-width:450px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(2.5875rem,6.9vw+1.38rem,10.35rem)] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(3.6rem,9.6vw+1.92rem,14.4rem)] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,9vw+1.8rem,13.5rem)] [@media(min-width:851px)_and_(max-width:1019px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.375rem,8.5vw+1.6rem,13.5rem)] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:text-[clamp(2.625rem,5.25vw,4.125rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:text-[clamp(2.625rem,6.144vw,9.6rem)] min-[1440px]:text-[clamp(2.25rem,3.84vw,6rem)] [@media(min-width:1440px)_and_(max-width:1535px)_and_(min-height:850px)_and_(max-height:920px)]:text-[clamp(3.825rem,6.528vw,10.2rem)] [@media(min-width:1440px)_and_(max-width:1535px)_and_(min-height:1400px)_and_(max-height:1500px)]:text-[clamp(3.6rem,6.144vw,9.6rem)] lg:tracking-[-0.025em]"
      >
        <span className="contents landing-tablet-portrait:hidden">
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
          <span className="block">the rest.</span>
        </span>
        <span className="hidden landing-tablet-portrait:contents">
          <span className="block whitespace-nowrap">
            Your tenants text.{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(174deg, rgb(24, 121, 96) 0%, rgb(174, 225, 239) 100%)',
              }}
            >
              Ulo
            </span>
          </span>
          <span className="block whitespace-nowrap">Does the rest.</span>
        </span>
      </h1>

      <p
        className="mt-4 box-border max-w-full border-l-[3px] border-[#187960] pl-4 text-base font-normal text-[#4b5563] sm:mt-6 sm:pl-5 sm:text-lg max-[1019px]:!w-full"
        style={{
          lineHeight: '28px',
          width: fullWidthCopy ? undefined : copyWidth,
        }}
      >
        Ulo helps landlords automate day-to-day maintenance, rent collection, and tenant communication through SMS workflows. No apps required for tenants or vendors.
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
        'sa-press flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-7 py-2.5 leading-none',
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
  const [earlyAccessInitialEmail, setEarlyAccessInitialEmail] = useState('')
  const [heroWaitlistEmail, setHeroWaitlistEmail] = useState('')
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

  function openEarlyAccess(prefillEmail?: string) {
    playUiClickSound()
    setMobileMenuOpen(false)
    setEarlyAccessSuccess(false)
    setEarlyAccessReferralLink('')
    setEarlyAccessInitialEmail(prefillEmail?.trim() ?? '')
    setEarlyAccessOpen(true)
  }

  function closeEarlyAccess() {
    setEarlyAccessOpen(false)
    setEarlyAccessSuccess(false)
    setEarlyAccessReferralLink('')
    setEarlyAccessInitialEmail('')
  }

  function submitHeroWaitlistEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const raw = formData.get('email') ?? formData.get('footer-email')
    const fromField = typeof raw === 'string' ? raw.trim() : ''
    const email = fromField || heroWaitlistEmail.trim()
    if (email && email !== heroWaitlistEmail.trim()) {
      setHeroWaitlistEmail(email)
    }
    openEarlyAccess(email)
  }

  const navLinks = [
    { label: 'How It Works', target: 'how-it-works' },
    { label: 'Features', target: 'features' },
    { label: 'Property Dashboard', target: 'property-dashboard' },
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
        <div className={`${LANDING_NAV} h-16 items-center gap-0 landing-3840-2160:h-24 landing-4096-2304:h-[6.4rem] landing-5120-2880:h-[6.4rem] landing-7680-4320:h-40`}>
          <div className="flex h-full shrink-0 items-center border-r border-gray-200/60 pr-6 landing-desktop:!border-r-0 landing-1680-1050:!border-r-0 landing-1512-982:!border-r landing-1728-1117:!border-r landing-7680-4320:pr-[3.75rem]">
            <Link
              to="/"
              className="sa-press block h-11 w-[121px] rounded-lg lg:h-11 lg:w-[108px] landing-3840-2160:!h-[4.125rem] landing-3840-2160:!w-[162px] landing-4096-2304:!h-[4.4rem] landing-5120-2880:!h-[4.4rem] landing-4096-2304:!w-[172.8px] landing-5120-2880:!w-[172.8px] landing-7680-4320:!h-[6.875rem] landing-7680-4320:!w-[270px] landing-7680-4320:rounded-[1.25rem]"
            >
              <img src={uloLogo} alt="ülo home" className="h-full w-full object-contain object-left" />
            </Link>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end">
            <div className="hidden items-center gap-1 lg:flex landing-3840-2160:gap-1.5 landing-4096-2304:gap-[0.4rem] landing-5120-2880:gap-[0.4rem] landing-7680-4320:gap-[0.625rem]">
              <nav className="flex items-center gap-1 landing-3840-2160:gap-1.5 landing-4096-2304:gap-[0.4rem] landing-5120-2880:gap-[0.4rem] landing-7680-4320:gap-[0.625rem]" aria-label="Primary">
                {navLinks.map(({ label, target }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => scrollTo(target)}
                    className="sa-press rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] hover:bg-gray-50 hover:text-[#111827] landing-3840-2160:px-[1.125rem] landing-3840-2160:py-3 landing-3840-2160:text-[1.3125rem] landing-4096-2304:rounded-[1.2rem] landing-5120-2880:rounded-[1.2rem] landing-4096-2304:px-[1.2rem] landing-5120-2880:px-[1.2rem] landing-4096-2304:py-[0.8rem] landing-5120-2880:py-[0.8rem] landing-4096-2304:text-[1.4rem] landing-5120-2880:text-[1.4rem] landing-7680-4320:rounded-[1.875rem] landing-7680-4320:px-[1.875rem] landing-7680-4320:py-5 landing-7680-4320:text-[2.1875rem]"
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <Link
                to="/admin/login"
                className="sa-press ml-2 rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] hover:bg-gray-50 hover:text-[#111827] landing-3840-2160:ml-3 landing-3840-2160:px-[1.125rem] landing-3840-2160:py-3 landing-3840-2160:text-[1.3125rem] landing-4096-2304:ml-[0.8rem] landing-5120-2880:ml-[0.8rem] landing-4096-2304:rounded-[1.2rem] landing-5120-2880:rounded-[1.2rem] landing-4096-2304:px-[1.2rem] landing-5120-2880:px-[1.2rem] landing-4096-2304:py-[0.8rem] landing-5120-2880:py-[0.8rem] landing-4096-2304:text-[1.4rem] landing-5120-2880:text-[1.4rem] landing-7680-4320:ml-5 landing-7680-4320:rounded-[1.875rem] landing-7680-4320:px-[1.875rem] landing-7680-4320:py-5 landing-7680-4320:text-[2.1875rem]"
              >
                Login
              </Link>
              <PrimaryButton
                onClick={() => openEarlyAccess()}
                className="ml-2 inline-flex landing-3840-2160:ml-3 landing-3840-2160:gap-3 landing-3840-2160:rounded-[0.75rem] landing-3840-2160:px-[2.625rem] landing-3840-2160:py-[0.9375rem] landing-3840-2160:text-[1.3125rem] landing-4096-2304:ml-[0.8rem] landing-5120-2880:ml-[0.8rem] landing-4096-2304:gap-[0.8rem] landing-5120-2880:gap-[0.8rem] landing-4096-2304:rounded-[0.8rem] landing-5120-2880:rounded-[0.8rem] landing-4096-2304:px-[2.8rem] landing-5120-2880:px-[2.8rem] landing-4096-2304:py-4 landing-5120-2880:py-4 landing-4096-2304:text-[1.4rem] landing-5120-2880:text-[1.4rem] landing-7680-4320:ml-5 landing-7680-4320:gap-5 landing-7680-4320:rounded-[1.25rem] landing-7680-4320:px-[4.375rem] landing-7680-4320:py-[1.5625rem] landing-7680-4320:text-[2.1875rem]"
              >
                Request Early Access
                <IconArrowRight className="size-4 landing-3840-2160:size-6 landing-4096-2304:size-[1.6rem] landing-5120-2880:size-[1.6rem] landing-7680-4320:size-10" />
              </PrimaryButton>
            </div>
            <button
              type="button"
              className="sa-press rounded-xl p-2 text-[#6b7280] hover:bg-gray-50 lg:hidden"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>
        {mobileMenuOpen ? (
          <div className="sa-enter border-t border-gray-200/80 bg-white px-6 py-4 lg:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {navLinks.map(({ label, target }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => scrollTo(target)}
                  className="sa-press rounded-xl px-3 py-3 text-left text-sm font-medium text-[#6b7280] hover:bg-gray-50 hover:text-[#111827]"
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
              <Link
                to="/admin/login"
                className="sa-press rounded-xl px-3 py-2 text-sm font-medium text-[#6b7280] hover:bg-gray-50 hover:text-[#111827]"
                onClick={() => setMobileMenuOpen(false)}
              >
                Login
              </Link>
              <PrimaryButton
                onClick={() => openEarlyAccess()}
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
        <section className="relative overflow-hidden min-[2560px]:flex min-[2560px]:min-h-[calc(100dvh-4rem)] min-[2560px]:items-center landing-3840-2160:min-h-[calc(100dvh-6rem)] landing-4096-2304:min-h-[calc(100dvh-6.4rem)] landing-5120-2880:min-h-[calc(100dvh-6.4rem)] landing-7680-4320:min-h-[calc(100dvh-10rem)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.14]"
            style={{ backgroundImage: `url(${heroBlueprint})` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[48%] bg-gradient-to-b from-transparent via-white/75 to-white"
          />
          <LandingContentShell
            className="relative z-10 w-full pb-12 pt-10 sm:pb-28 sm:pt-14 md:pb-32 lg:pt-14 min-[2560px]:pb-16 min-[2560px]:pt-16"
            contentClassName="w-full max-w-none [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!ml-0 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:flex [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:justify-center [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:!ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:flex [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:justify-center min-[1440px]:!ml-0 min-[1440px]:flex min-[1440px]:justify-center "
     >
      <div
       className="grid w-full grid-cols-1 items-start gap-10 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:mx-auto [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:flex [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:w-auto [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:max-w-full [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:flex-row [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:flex-nowrap [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:items-center [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:gap-4 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:mx-auto [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:flex [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:w-auto [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:max-w-full [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:flex-row [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:flex-nowrap [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:items-center [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:gap-[clamp(1.5rem,3vw,3.125rem)] min-[1440px]:mx-auto min-[1440px]:flex min-[1440px]:w-auto min-[1440px]:max-w-full min-[1440px]:flex-row min-[1440px]:flex-nowrap min-[1440px]:items-center min-[1440px]:gap-8 min-[1440px]:gap-y-0 min-[2560px]:gap-12 landing-3840-2160:origin-center landing-3840-2160:scale-[1.6] landing-4096-2304:origin-center landing-5120-2880:origin-center landing-4096-2304:scale-[1.4] landing-5120-2880:scale-[1.4] landing-7680-4320:origin-center landing-7680-4320:scale-[1.9]"
              style={
                {
                  '--hero-copy-max-w': HERO_COPY_MAX_WIDTH,
                  '--hero-video-col-w': HERO_VIDEO_COLUMN_WIDTH,
                } as React.CSSProperties
              }
            >
              <div className="relative z-10 min-w-0 w-full max-w-full max-[1019px]:max-w-none [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:max-w-[clamp(18rem,36vw,36rem)] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:shrink [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:max-w-[clamp(20rem,38vw,40rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:shrink [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:pr-0 min-[1440px]:ml-0 min-[1440px]:max-w-[var(--hero-copy-max-w)] min-[1440px]:pr-0 min-[1440px]:shrink">
                <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-black/[0.04] bg-black/[0.06] px-[17px] py-[9px] shadow-[0px_2px_8px_0px_rgba(16,185,129,0.1)]">
                  <span className="landing-alpha-status-dot" aria-hidden />
                  <span className="font-mono text-[12px] font-normal leading-4 text-[#059669]">
                    Now in Alpha
                  </span>
                  <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#55b6a1] px-2 py-1 text-[12px] font-medium leading-normal text-white">
                    Pilot Program
                  </span>
                </span>

                <HeroHeadlineAndCopy />

                <div className="mt-5 flex w-full max-w-full flex-col items-stretch sm:mt-6 sm:items-start landing-tablet-portrait:items-stretch">
                  <form
                    onSubmit={submitHeroWaitlistEmail}
                    className="landing-hero-waitlist flex w-full min-w-0 flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center landing-tablet-portrait:!w-full landing-tablet-portrait:flex-row [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!w-full [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!w-full [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!flex-col [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!items-stretch landing-1024-1366:!w-full landing-1024-1366:!flex-row landing-1024-1366:!items-center landing-1024-600:!w-full landing-1024-600:!flex-col landing-1024-600:!items-stretch landing-1280-800:!w-auto landing-1512-982:!w-auto landing-1728-1117:!w-auto landing-1280-800:!flex-row landing-1512-982:!flex-row landing-1728-1117:!flex-row landing-1280-800:!items-center landing-1512-982:!items-center landing-1728-1117:!items-center landing-1366-768:!w-auto landing-1366-768:!flex-row landing-1366-768:!items-center landing-1440-900:!w-auto landing-1440-900:!flex-row landing-1440-900:!items-center landing-1680-1050:!w-auto landing-1680-1050:!flex-row landing-1680-1050:!items-center"
                  >
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="Enter your email"
                      value={heroWaitlistEmail}
                      onChange={(event) => setHeroWaitlistEmail(event.target.value)}
                      className="sa-surface landing-waitlist-field landing-3840-2160-footer-waitlist-field box-border w-full min-w-[10.5rem] flex-1 rounded-lg border border-[#55B6A1] bg-white px-7 text-sm font-medium text-[#0f1623] outline-none placeholder:text-[#4b5563] placeholder:opacity-100 transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-[#3d9a86] hover:bg-[#f4fbf9] hover:shadow-[0_4px_14px_rgba(85,182,161,0.22)] focus:border-[#55B6A1] focus:bg-white focus:ring-2 focus:ring-[#55B6A1]/25 focus:shadow-none sm:w-[min(100%,20rem)] sm:text-base landing-tablet-portrait:!min-w-0 landing-tablet-portrait:!flex-1 landing-tablet-portrait:!w-auto landing-3840-2160:rounded-[0.8rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!min-w-[10.5rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!flex-1 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!w-auto [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!w-full landing-1024-1366:!w-auto landing-1024-600:!w-full landing-1280-800:!w-auto landing-1512-982:!w-auto landing-1728-1117:!w-auto landing-1280-800:!flex-1 landing-1512-982:!flex-1 landing-1728-1117:!flex-1 landing-1280-800:!max-w-[min(100%,20rem)] landing-1512-982:!max-w-[min(100%,20rem)] landing-1728-1117:!max-w-[min(100%,20rem)] landing-1366-768:!w-auto landing-1366-768:!flex-1 landing-1366-768:!max-w-[min(100%,20rem)] landing-1440-900:!w-auto landing-1440-900:!flex-1 landing-1440-900:!max-w-[min(100%,20rem)] landing-1680-1050:!w-auto landing-1680-1050:!flex-1 landing-1680-1050:!max-w-[min(100%,20rem)] [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!min-w-0 [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!max-w-none [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!px-4"
                      aria-label="Email for early access"
                    />
                    <PrimaryButton type="submit" className="landing-waitlist-field landing-3840-2160-footer-waitlist-field box-border w-full shrink-0 justify-center !py-0 sm:w-auto landing-tablet-portrait:!w-auto landing-3840-2160:gap-3 landing-3840-2160:rounded-[0.8rem] landing-3840-2160:px-10 [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!w-full landing-1024-1366:!w-auto landing-1024-600:!w-full landing-1280-800:!w-auto landing-1512-982:!w-auto landing-1728-1117:!w-auto landing-1366-768:!w-auto landing-1440-900:!w-auto landing-1680-1050:!w-auto">
                      Request Early Access
                      <IconArrowRight />
                    </PrimaryButton>
                  </form>
                  <div className="mt-6 flex flex-nowrap items-center justify-center gap-2 landing-compact:flex-col landing-compact:items-center landing-504:flex-row landing-504:items-center sm:justify-start landing-phone-tall:flex-col landing-phone-tall:items-center">
                    <button
                      type="button"
                      className="sa-link shrink-0 whitespace-nowrap text-sm font-medium text-[#6b7280] underline decoration-solid underline-offset-2"
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
                className="relative z-[5] mx-auto flex shrink-0 items-center justify-center self-center py-1 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:py-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:py-0 min-[1440px]:py-0"
              >
                <img
                  src={heroArrow}
                  alt=""
                  className="block size-[4.2rem] origin-center [transform:rotate(120deg)] sm:size-[4.8rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:size-[3.6rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:[transform:rotate(-40deg)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:size-[clamp(3rem,4.5vw,6rem)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:[transform:rotate(-40deg)] min-[1440px]:size-24 min-[1440px]:[transform:rotate(-40deg)] min-[2560px]:size-[7.2rem]"
                />
              </div>

              <div className="relative z-0 mx-auto flex shrink-0 justify-center [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:w-[291px] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:ml-3 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:mr-0 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:w-[280px] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:ml-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:mr-0 [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:w-[clamp(280px,26vw,364px)] [@media(min-width:1021px)_and_(max-width:1440px)_and_(min-height:1397px)_and_(max-height:1500px)]:shrink-0 min-[1440px]:ml-8 min-[1440px]:mr-0 min-[1440px]:w-[var(--hero-video-col-w)] min-[2560px]:ml-12">
                <HeroInteractionVideo />
              </div>
            </div>
          </LandingContentShell>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="relative scroll-mt-20 overflow-visible">
          <div className={LANDING_SECTION_COLUMN_RULE} aria-hidden />
          <div className="flex w-full flex-col items-center overflow-visible px-6 pb-[calc(6rem*1.3)] pt-[calc(4rem*1.3)] lg:px-14 landing-4096-2304:px-14 landing-5120-2880:px-14">
            <div className="landing-3840-2160-features-scale flex w-full flex-col items-center">
              <FeaturesShowcase />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className={`relative scroll-mt-20 overflow-visible ${LANDING_SECTION_GAP}`}>
          <div className={`border-t ${LANDING_FULL_WIDTH_RULE}`} aria-hidden />
          <div className={LANDING_SECTION_COLUMN_RULE} aria-hidden />
          <div className={`${LANDING_BEYOND_LOGO_COLUMN_INSET} landing-4096-2304-section-inset landing-5120-2880-section-inset overflow-visible pt-[calc(4rem*1.3)]`}>
            <div className="landing-3840-2160-features-scale flex flex-col">
              <div className="flex flex-col items-start text-left">
                <h2 className="sa-pill inline-flex items-center gap-2 rounded-full bg-transparent px-4 py-2 font-mono text-xs font-normal uppercase tracking-wide text-[#611879] landing-4096-2304:text-[0.975rem] landing-5120-2880:text-[0.975rem] landing-4096-2304:gap-[0.65rem] landing-5120-2880:gap-[0.65rem] landing-4096-2304:px-5 landing-5120-2880:px-5 landing-4096-2304:py-2.5 landing-5120-2880:py-2.5 landing-7680-4320:text-[1.875rem] landing-7680-4320:gap-5 landing-7680-4320:px-10 landing-7680-4320:py-5">
                  <IconFocusFeature className="size-4 shrink-0 text-[#81228A] landing-4096-2304:size-[1.3rem] landing-5120-2880:size-[1.3rem] landing-7680-4320:size-10" />
                  Features
                </h2>
                <div className="mt-4 flex flex-col items-start gap-4 text-left landing-4096-2304:mt-[1.3rem] landing-5120-2880:mt-[1.3rem] landing-7680-4320:mt-10">
                  <p className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900 max-[349px]:text-[1.75rem] landing-compact:text-[1.75rem] landing-phone-tall:text-[1.75rem] landing-4096-2304:text-[62.4px] landing-5120-2880:text-[62.4px] landing-7680-4320:text-[120px]">
                  Run your property on autopilot
                  </p>
                </div>
              </div>

              <FeaturesMarquee />
            </div>
          </div>
        </section>

        {/* Property Dashboard */}
        <section id="property-dashboard" className="relative scroll-mt-20">
          <div className={`border-t ${LANDING_FULL_WIDTH_RULE}`} aria-hidden />
          <div className={LANDING_SECTION_COLUMN_RULE} aria-hidden />
          <div className={`${LANDING_BEYOND_LOGO_COLUMN_INSET} landing-4096-2304-section-inset landing-5120-2880-section-inset flex justify-center pb-[83px] pt-[calc(4rem*1.3)] landing-desktop:!pl-6 landing-desktop:!pr-6 landing-1024-600:!pl-6 landing-1024-600:!pr-6 landing-1920-1080-dashboard-full landing-1920-1200-dashboard-full landing-1920-1080:!pl-6 landing-1920-1080:!pr-6 landing-1920-1200:!pl-6 landing-1920-1200:!pr-6 landing-4096-2304:!pl-14 landing-5120-2880:!pl-14 landing-4096-2304:!pr-14 landing-5120-2880:!pr-14`}>
            <div className="landing-3840-2160-dashboard-scale flex flex-col items-center">
              <div className="flex justify-center">
                <h2 className="sa-pill inline-flex items-center gap-2 rounded-full bg-transparent px-4 py-2 font-mono text-xs font-normal uppercase tracking-wide text-[#611879] landing-4096-2304:text-[0.975rem] landing-5120-2880:text-[0.975rem] landing-4096-2304:gap-[0.65rem] landing-5120-2880:gap-[0.65rem] landing-4096-2304:px-5 landing-5120-2880:px-5 landing-4096-2304:py-2.5 landing-5120-2880:py-2.5 landing-7680-4320:text-[1.875rem] landing-7680-4320:gap-5 landing-7680-4320:px-10 landing-7680-4320:py-5">
                  <IconGraph className="size-4 shrink-0 text-[#81228A] landing-4096-2304:size-[1.3rem] landing-5120-2880:size-[1.3rem] landing-7680-4320:size-10" />
                  Property Dashboard
                </h2>
              </div>

              <div className="mt-4 flex flex-col items-center gap-4 text-center landing-4096-2304:mt-[1.3rem] landing-5120-2880:mt-[1.3rem] landing-4096-2304:gap-5 landing-5120-2880:gap-5 landing-7680-4320:mt-10 landing-7680-4320:gap-10">
                <p className="max-w-[min(64rem,calc(100vw-6rem))] font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900 max-[349px]:text-[1.75rem] landing-compact:text-[1.75rem] landing-phone-tall:text-[1.75rem] landing-4096-2304:text-[62.4px] landing-5120-2880:text-[62.4px] landing-7680-4320:text-[120px]">
                Maintenance OS for independent landlords
                </p>
                <p className="max-w-2xl text-lg font-normal leading-relaxed text-slate-700 landing-4096-2304:max-w-[calc(42rem*1.3)] landing-5120-2880:max-w-[calc(42rem*1.3)] landing-4096-2304:text-[1.4625rem] landing-5120-2880:text-[1.4625rem] landing-7680-4320:max-w-[calc(42rem*2.5)] landing-7680-4320:text-[2.8125rem]">
                  One view across all your properties; built from every job, text, and vendor interaction.
                </p>
              </div>

              <div
                className="landing-property-dashboard-shot mt-10 overflow-hidden"
                style={{ aspectRatio: '6163 / 4115' }}
              >
                <img
                  src={howItWorksIpad}
                  alt="Ulo property operations dashboard on iPad"
                  className="block h-full w-full object-cover object-top"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <div className={`relative w-full border-t ${LANDING_FULL_WIDTH_RULE}`}>
        <div className={LANDING_SECTION_COLUMN_RULE} aria-hidden />
      </div>
      <footer className="relative py-12 sm:py-16">
        <div className={LANDING_SECTION_COLUMN_RULE} aria-hidden />
        <div className={`landing-1280-800-footer-inset ${LANDING_BEYOND_LOGO_COLUMN_INSET} landing-4096-2304-section-inset landing-5120-2880-section-inset landing-1280-800:!pr-14 landing-1512-982:!pr-14 landing-1728-1117:!pr-14`}>
          <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between lg:gap-16 landing-tablet-portrait:grid landing-tablet-portrait:grid-cols-[1fr_auto] landing-tablet-portrait:items-center landing-tablet-portrait:gap-x-4 landing-tablet-portrait:gap-y-10 landing-1280-800:!gap-10 landing-1512-982:!gap-10 landing-1728-1117:!gap-10">
            <div className="flex w-fit max-w-full flex-col items-start text-left landing-compact:contents landing-tablet-portrait:contents">
              <img
                src={uloLogo}
                alt="ülo home"
                className="h-auto w-[min(calc(85vw*1.4),60.1rem)] max-w-full object-contain object-left sm:w-[65.5rem] md:w-[76.4rem] lg:w-[87.4rem] landing-compact:order-1 landing-tablet-portrait:col-span-2"
              />
              <nav
                className="mt-8 hidden w-full flex-wrap items-center justify-start gap-x-4 gap-y-2 pl-[7.09%] text-left text-sm lg:flex landing-tablet-portrait:!hidden"
                aria-label="Legal"
              >
                <Link
                  to="/terms"
                  className="sa-link font-medium text-[#9E439F] underline-offset-2 hover:text-[#7f3680] hover:underline"
                >
                  Terms of Service
                </Link>
                <span className="text-[#d1d5db]" aria-hidden>
                  ·
                </span>
                <Link
                  to={PRIVACY_POLICY_PATH}
                  className="sa-link font-medium text-[#9E439F] underline-offset-2 hover:text-[#7f3680] hover:underline"
                >
                  Privacy Policy
                </Link>
              </nav>
            </div>

            <div className="flex w-full min-w-0 max-w-md shrink-0 flex-col text-left lg:max-w-[22rem] landing-3840-2160:max-w-[35.2rem] landing-4096-2304:max-w-[30.8rem] landing-5120-2880:max-w-[30.8rem] landing-7680-4320:max-w-[55rem] landing-compact:contents landing-tablet-portrait:contents landing-1280-800:!max-w-[22rem] landing-1512-982:!max-w-[22rem] landing-1728-1117:!max-w-[22rem] landing-1280-800:!pr-0 landing-1512-982:!pr-0 landing-1728-1117:!pr-0">
              <div className="landing-compact:order-2 landing-compact:w-full landing-tablet-portrait:col-span-2 landing-tablet-portrait:w-full">
                <h2 className="font-[family-name:var(--font-landing-heading)] text-[clamp(1.75rem,3vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.02em] text-slate-900 landing-compact:text-center landing-3840-2160:text-[3.6rem] landing-3840-2160:leading-[1.15] landing-4096-2304:text-[3.15rem] landing-5120-2880:text-[3.15rem] landing-4096-2304:leading-[1.15] landing-5120-2880:leading-[1.15] landing-7680-4320:text-[5.625rem] landing-7680-4320:leading-[1.15]">
                  Be first on autopilot
                </h2>
                <p className="mt-2 text-base font-normal leading-relaxed text-slate-700 landing-compact:text-center landing-3840-2160:mt-[0.8rem] landing-3840-2160:text-[1.6rem] landing-3840-2160:leading-relaxed landing-4096-2304:mt-[0.7rem] landing-5120-2880:mt-[0.7rem] landing-4096-2304:text-[1.4rem] landing-5120-2880:text-[1.4rem] landing-4096-2304:leading-relaxed landing-5120-2880:leading-relaxed landing-7680-4320:mt-5 landing-7680-4320:text-[2.5rem] landing-7680-4320:leading-relaxed">
                  Join the alpha; limited spots available.
                </p>
                <form
                  onSubmit={submitHeroWaitlistEmail}
                  className="landing-footer-waitlist mt-5 flex flex-col gap-3 landing-tablet-portrait:flex-row landing-tablet-portrait:items-center landing-3840-2160:mt-8 landing-3840-2160:gap-[1.2rem] landing-4096-2304:mt-7 landing-5120-2880:mt-7 landing-4096-2304:gap-[1.05rem] landing-5120-2880:gap-[1.05rem] landing-7680-4320:mt-[3.125rem] landing-7680-4320:gap-[1.875rem] [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!flex-col [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!items-stretch landing-1024-1366:!flex-row landing-1024-1366:!items-center landing-1024-600:!flex-col landing-1024-600:!items-stretch landing-1280-800:!flex-col landing-1512-982:!flex-col landing-1728-1117:!flex-col landing-1280-800:!items-stretch landing-1512-982:!items-stretch landing-1728-1117:!items-stretch"
                >
                  <input
                    type="email"
                    name="footer-email"
                    autoComplete="email"
                    placeholder="Enter your email"
                    value={heroWaitlistEmail}
                    onChange={(event) => setHeroWaitlistEmail(event.target.value)}
                    className="sa-surface landing-waitlist-field landing-3840-2160-footer-waitlist-field landing-4096-2304-footer-waitlist-field landing-5120-2880-footer-waitlist-field landing-7680-4320-footer-waitlist-field box-border w-full min-w-[10.5rem] flex-1 rounded-lg border border-[#55B6A1] bg-white px-7 text-sm font-medium text-[#0f1623] outline-none placeholder:text-[#4b5563] placeholder:opacity-100 transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-[#3d9a86] hover:bg-[#f4fbf9] hover:shadow-[0_4px_14px_rgba(85,182,161,0.22)] focus:border-[#55B6A1] focus:bg-white focus:ring-2 focus:ring-[#55B6A1]/25 focus:shadow-none sm:text-base landing-tablet-portrait:!min-w-0 landing-tablet-portrait:!flex-1 landing-tablet-portrait:!w-auto landing-3840-2160:min-w-[16.8rem] landing-3840-2160:rounded-[0.8rem] landing-4096-2304:min-w-[14.7rem] landing-5120-2880:min-w-[14.7rem] landing-4096-2304:rounded-[0.7rem] landing-5120-2880:rounded-[0.7rem] landing-7680-4320:min-w-[26.25rem] landing-7680-4320:rounded-[1.25rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!min-w-[10.5rem] [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!flex-1 [@media(min-width:1024px)_and_(max-width:1439px)_and_(min-height:550px)_and_(max-height:920px)]:!w-auto [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!w-full landing-1024-1366:!w-auto landing-1024-600:!w-full landing-1280-800:!w-full landing-1512-982:!w-full landing-1728-1117:!w-full landing-1280-800:!max-w-none landing-1512-982:!max-w-none landing-1728-1117:!max-w-none [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!px-4"
                    aria-label="Email for early access"
                  />
                  <PrimaryButton
                    type="submit"
                    className="landing-waitlist-field landing-3840-2160-footer-waitlist-field landing-4096-2304-footer-waitlist-field landing-5120-2880-footer-waitlist-field landing-7680-4320-footer-waitlist-field box-border w-full shrink-0 justify-center !py-0 landing-tablet-portrait:!w-auto landing-3840-2160:gap-3 landing-3840-2160:rounded-[0.8rem] landing-3840-2160:px-10 landing-4096-2304:gap-[0.7rem] landing-5120-2880:gap-[0.7rem] landing-4096-2304:rounded-[0.7rem] landing-5120-2880:rounded-[0.7rem] landing-4096-2304:px-[2.45rem] landing-5120-2880:px-[2.45rem] landing-7680-4320:gap-5 landing-7680-4320:rounded-[1.25rem] landing-7680-4320:px-[4.375rem] landing-7680-4320:text-[2.5rem] [@media(min-width:1000px)_and_(max-width:1100px)_and_(min-height:1397px)_and_(max-height:1500px)]:!w-full landing-1024-1366:!w-auto landing-1024-600:!w-full landing-1280-800:!w-full landing-1512-982:!w-full landing-1728-1117:!w-full"
                  >
                    Request Early Access
                    <IconArrowRight className="size-4 landing-3840-2160:size-6 landing-4096-2304:size-[1.4rem] landing-5120-2880:size-[1.4rem] landing-7680-4320:size-10" />
                  </PrimaryButton>
                </form>
              </div>
              <p className="mt-8 text-left text-sm text-[#6b7280] lg:text-right landing-compact:order-4 landing-compact:mt-0 landing-tablet-portrait:col-start-2 landing-tablet-portrait:row-start-3 landing-tablet-portrait:mt-0 landing-tablet-portrait:self-end landing-tablet-portrait:text-left landing-4096-2304:mt-[2.8rem] landing-5120-2880:mt-[2.8rem] landing-4096-2304:text-[1.225rem] landing-5120-2880:text-[1.225rem] landing-7680-4320:mt-20 landing-7680-4320:text-[2.1875rem]">
                © {new Date().getFullYear()} ülo home. All rights reserved.
              </p>
              <nav
                className="mt-10 flex w-full flex-wrap items-center justify-start gap-x-4 gap-y-2 text-sm lg:hidden landing-compact:order-5 landing-compact:mt-0 landing-tablet-portrait:!flex landing-tablet-portrait:col-span-1 landing-tablet-portrait:col-start-1 landing-tablet-portrait:row-start-3 landing-tablet-portrait:mt-0 landing-tablet-portrait:w-auto landing-tablet-portrait:self-end"
                aria-label="Legal"
              >
                <Link
                  to="/terms"
                  className="sa-link font-medium text-[#9E439F] underline-offset-2 hover:text-[#7f3680] hover:underline"
                >
                  Terms of Service
                </Link>
                <span className="text-[#d1d5db]" aria-hidden>
                  ·
                </span>
                <Link
                  to={PRIVACY_POLICY_PATH}
                  className="sa-link font-medium text-[#9E439F] underline-offset-2 hover:text-[#7f3680] hover:underline"
                >
                  Privacy Policy
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </footer>

      <EarlyAccessModal
        open={earlyAccessOpen}
        onClose={closeEarlyAccess}
        initialSuccess={earlyAccessSuccess}
        initialReferralLink={earlyAccessReferralLink}
        initialEmail={earlyAccessInitialEmail}
      />
    </div>
  )
}
