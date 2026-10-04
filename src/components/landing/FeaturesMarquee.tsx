import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type TouchEvent,
  type TransitionEvent,
} from 'react'
import { IconArrowRight } from '@/components/landing/LandingIcons'
import homeHealth from '@/assets/home-health.png'
import leaseRenewals from '@/assets/lease-renewals.png'
import maintenanceRequest from '@/assets/maintenance-request.png'
import moveInCoordination from '@/assets/move-in-coordination.png'
import proactiveMaintenance from '@/assets/proactive-maintenance.png'
import propertyInsights from '@/assets/property-insights.png'
import rentCollection from '@/assets/rent-collection.png'

const FEATURE_MARQUEE_ITEMS = [
  {
    src: proactiveMaintenance,
    width: 4195,
    height: 4131,
    alt: 'Proactive Maintenance — Ulo builds a maintenance calendar from property data',
  },
  {
    src: propertyInsights,
    width: 4195,
    height: 4140,
    alt: 'Property Insights — workflow data surfaced as actionable portfolio insights',
  },
  {
    src: rentCollection,
    width: 4195,
    height: 4098,
    alt: 'Rent Collection — automated SMS reminders and payment tracking',
  },
  {
    src: homeHealth,
    width: 4195,
    height: 4098,
    alt: 'Home Health Check — periodic walkthrough assessments dispatched to technicians',
  },
  {
    src: maintenanceRequest,
    width: 4195,
    height: 4098,
    alt: 'Maintenance Request — tenant texts an issue, Ulo classifies and coordinates vendors',
  },
  {
    src: moveInCoordination,
    width: 4195,
    height: 4098,
    alt: "Move in Coordination — From key handoff to utility setup, Ulo guides new tenants through move-in so you don't have to",
  },
  {
    src: leaseRenewals,
    width: 4168,
    height: 4098,
    alt: 'Lease Renewals — Ulo monitors expiry dates and launches renewal workflows',
  },
] as const

const TAP_MOVE_PX = 12
const CARD_CLASS =
  'h-auto w-[calc((100vw-3rem)*0.7)] shrink-0 select-none rounded-2xl border border-[#e5e7eb] max-[410px]:!w-[calc((100vw-3rem)*0.7)] landing-compact:!w-[calc((100vw-3rem)*0.7)] landing-compact:!h-auto landing-phone-tall:!w-[calc(100vw-3rem)] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!w-[calc((100vw-3rem)*0.56)] [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!h-auto sm:h-[min(476px,70vw)] sm:w-auto landing-884:!h-[min(333px,49vw)] landing-884:!w-auto landing-1024-600:!h-auto landing-1024-600:!w-[calc((100cqw-2rem)/2.5)] landing-1024-600:!max-w-none landing-7680-4320:!h-[min(1190px,70vw)] landing-7680-4320:!w-auto landing-7680-4320:rounded-[2.5rem] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!h-auto [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!h-auto'

const COUNT = FEATURE_MARQUEE_ITEMS.length
/** [last clone] + real slides + [first clone] for seamless wrap. */
const LOOP_SLIDES = [
  FEATURE_MARQUEE_ITEMS[COUNT - 1]!,
  ...FEATURE_MARQUEE_ITEMS,
  FEATURE_MARQUEE_ITEMS[0]!,
] as const

function logicalIndexFromTrack(trackIndex: number): number {
  if (trackIndex <= 0) return COUNT - 1
  if (trackIndex >= COUNT + 1) return 0
  return trackIndex - 1
}

/** Horizontal feature carousel with dots + prev/next. Slides may cross the section column rule. */
export function FeaturesMarquee() {
  const trackRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const animatingRef = useRef(false)
  /** Track position: 1 = first real slide. */
  const [trackIndex, setTrackIndex] = useState(1)
  const [stepPx, setStepPx] = useState(0)
  const [enableTransition, setEnableTransition] = useState(true)

  const logicalIndex = logicalIndexFromTrack(trackIndex)

  const measureStep = useCallback(() => {
    const track = trackRef.current
    const first = track?.children[0] as HTMLElement | undefined
    if (!track || !first) return
    const styles = getComputedStyle(track)
    const gap = Number.parseFloat(styles.columnGap || styles.gap || '16') || 16
    setStepPx(first.getBoundingClientRect().width + gap)
  }, [])

  useLayoutEffect(() => {
    measureStep()
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(() => measureStep())
    ro.observe(track)
    const first = track.children[0]
    if (first instanceof HTMLElement) ro.observe(first)
    window.addEventListener('resize', measureStep)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measureStep)
    }
  }, [measureStep])

  const jumpWithoutTransition = useCallback((nextTrackIndex: number) => {
    setEnableTransition(false)
    setTrackIndex(nextTrackIndex)
    // Re-enable after the browser paints the instant jump.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEnableTransition(true)
        animatingRef.current = false
      })
    })
  }, [])

  const onTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== trackRef.current) return
      if (event.propertyName !== 'transform') return
      if (trackIndex === COUNT + 1) {
        jumpWithoutTransition(1)
        return
      }
      if (trackIndex === 0) {
        jumpWithoutTransition(COUNT)
        return
      }
      animatingRef.current = false
    },
    [jumpWithoutTransition, trackIndex],
  )

  const goTrack = useCallback(
    (next: number) => {
      if (animatingRef.current) return
      animatingRef.current = true
      setEnableTransition(true)
      setTrackIndex(next)
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        requestAnimationFrame(() => {
          if (next === COUNT + 1) jumpWithoutTransition(1)
          else if (next === 0) jumpWithoutTransition(COUNT)
          else animatingRef.current = false
        })
      }
    },
    [jumpWithoutTransition],
  )

  const goPrev = useCallback(() => goTrack(trackIndex - 1), [goTrack, trackIndex])
  const goNext = useCallback(() => goTrack(trackIndex + 1), [goTrack, trackIndex])

  const goToLogical = useCallback(
    (logical: number) => {
      if (animatingRef.current) return
      const clamped = ((logical % COUNT) + COUNT) % COUNT
      if (clamped === logicalIndex) return
      goTrack(clamped + 1)
    },
    [goTrack, logicalIndex],
  )

  const onTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const onTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current
      touchStartRef.current = null
      if (!start) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - start.x
      const dy = Math.abs(touch.clientY - start.y)
      if (Math.abs(dx) < TAP_MOVE_PX || dy > Math.abs(dx)) return
      if (dx < 0) goNext()
      else goPrev()
    },
    [goNext, goPrev],
  )

  const onTouchCancel = useCallback(() => {
    touchStartRef.current = null
  }, [])

  return (
    <div
      className="landing-features-marquee relative z-10 mt-10 w-full @container overflow-visible"
      aria-label="Product feature highlights"
      aria-roledescription="carousel"
    >
      <div
        className="overflow-visible touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <div
          ref={trackRef}
          className={[
            'flex w-max gap-4 landing-7680-4320:gap-10',
            enableTransition
              ? 'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
              : 'transition-none',
          ].join(' ')}
          style={{
            transform:
              stepPx > 0 ? `translateX(-${trackIndex * stepPx}px)` : undefined,
          }}
          onTransitionEnd={onTransitionEnd}
        >
          {LOOP_SLIDES.map((item, i) => (
            <img
              key={`${item.alt}-${i}`}
              src={item.src}
              alt={item.alt}
              width={item.width}
              height={item.height}
              className={CARD_CLASS}
              draggable={false}
              loading="eager"
            />
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 landing-4096-2304:mt-[1.95rem] landing-5120-2880:mt-[1.95rem] landing-7680-4320:mt-14">
        <div
          className="flex items-center gap-2 landing-7680-4320:gap-4"
          role="tablist"
          aria-label="Feature slides"
        >
          {FEATURE_MARQUEE_ITEMS.map((item, i) => {
            const active = i === logicalIndex
            return (
              <button
                key={item.alt}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Show feature ${i + 1} of ${COUNT}`}
                onClick={() => goToLogical(i)}
                className={[
                  'sa-press rounded-full outline-none transition-[width,background-color] duration-300 focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2',
                  active
                    ? 'h-2 w-6 bg-[#611879] landing-7680-4320:h-4 landing-7680-4320:w-12'
                    : 'size-2 bg-[#d1d5db] hover:bg-[#9ca3af] landing-7680-4320:size-4',
                ].join(' ')}
              />
            )
          })}
        </div>

        <div className="flex items-center gap-2 landing-7680-4320:gap-4">
          <button
            type="button"
            aria-label="Previous feature"
            onClick={goPrev}
            className="sa-press flex size-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-slate-700 outline-none hover:border-[#d1d5db] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2 landing-7680-4320:size-20"
          >
            <IconArrowRight className="size-4 rotate-180 landing-7680-4320:size-8" />
          </button>
          <button
            type="button"
            aria-label="Next feature"
            onClick={goNext}
            className="sa-press flex size-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-slate-700 outline-none hover:border-[#d1d5db] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2 landing-7680-4320:size-20"
          >
            <IconArrowRight className="size-4 landing-7680-4320:size-8" />
          </button>
        </div>
      </div>
    </div>
  )
}
