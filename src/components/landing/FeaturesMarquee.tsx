import {
  useCallback,
  useEffect,
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
const TRANSITION_MS = 500
const CARD_CLASS =
  'h-auto w-[calc((100vw-3rem)*0.7)] shrink-0 select-none rounded-2xl border border-[#e5e7eb] max-[410px]:!w-[calc((100vw-3rem)*0.7)] landing-compact:!w-[calc((100vw-3rem)*0.7)] landing-compact:!h-auto landing-phone-tall:!w-[calc(100vw-3rem)] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!w-[calc((100vw-3rem)*0.56)] [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!h-auto sm:h-[min(476px,70vw)] sm:w-auto landing-884:!h-[min(333px,49vw)] landing-884:!w-auto landing-1024-600:!h-auto landing-1024-600:!w-[calc((100cqw-2rem)/2.5)] landing-1024-600:!max-w-none landing-7680-4320:!h-[min(1190px,70vw)] landing-7680-4320:!w-auto landing-7680-4320:rounded-[2.5rem] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!h-auto [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!h-auto'

const COUNT = FEATURE_MARQUEE_ITEMS.length
/**
 * Three full copies so the viewport stays filled at both ends.
 * Live window is the middle copy (indices COUNT .. 2*COUNT-1).
 */
const LOOP_SLIDES = [
  ...FEATURE_MARQUEE_ITEMS,
  ...FEATURE_MARQUEE_ITEMS,
  ...FEATURE_MARQUEE_ITEMS,
] as const

const START_INDEX = COUNT

function logicalIndexFromTrack(trackIndex: number): number {
  return ((trackIndex % COUNT) + COUNT) % COUNT
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Horizontal feature carousel with dots + prev/next. Infinite loop; clips left of the section column rule. */
export function FeaturesMarquee() {
  const trackRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const animatingRef = useRef(false)
  const trackIndexRef = useRef(START_INDEX)
  const wrapTimeoutRef = useRef<number | null>(null)
  const pendingDeltaRef = useRef(0)
  const moveIdRef = useRef(0)
  const settledMoveIdRef = useRef(0)
  /** Track position: middle-copy start = first real slide. */
  const [trackIndex, setTrackIndex] = useState(START_INDEX)
  /** Layout offset of the active slide (offsetLeft — ignores parent `zoom`). */
  const [offsetPx, setOffsetPx] = useState(0)
  const [enableTransition, setEnableTransition] = useState(true)
  /** After leaving the default slide, allow cards to overlap the vertical. */
  const [hasLeftDefault, setHasLeftDefault] = useState(false)
  const dotsRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState({ left: 0, width: 8 })

  const logicalIndex = logicalIndexFromTrack(trackIndex)

  useEffect(() => {
    trackIndexRef.current = trackIndex
  }, [trackIndex])

  useEffect(() => {
    return () => {
      if (wrapTimeoutRef.current != null) window.clearTimeout(wrapTimeoutRef.current)
    }
  }, [])

  const measureOffset = useCallback((index = trackIndexRef.current) => {
    const track = trackRef.current
    const slide = track?.children[index] as HTMLElement | undefined
    if (!track || !slide) return 0
    const next = slide.offsetLeft
    setOffsetPx(next)
    return next
  }, [])

  useLayoutEffect(() => {
    measureOffset(trackIndex)
  }, [measureOffset, trackIndex])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(() => measureOffset())
    ro.observe(track)
    for (const child of Array.from(track.children)) {
      if (child instanceof HTMLElement) ro.observe(child)
    }
    const onResize = () => measureOffset()
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [measureOffset])

  const measurePill = useCallback(() => {
    const root = dotsRef.current
    if (!root) return
    const active = root.querySelector<HTMLElement>('[data-sa-dot][aria-selected="true"]')
    if (!active) return
    const dotW = active.offsetWidth
    // Morph into the elongated active pill (3× dot), centered on the active dot.
    const pillW = Math.round(dotW * 3)
    setPill({
      left: active.offsetLeft - (pillW - dotW) / 2,
      width: pillW,
    })
  }, [])

  useLayoutEffect(() => {
    measurePill()
  }, [logicalIndex, measurePill])

  useLayoutEffect(() => {
    const root = dotsRef.current
    if (!root) return
    const ro = new ResizeObserver(() => measurePill())
    ro.observe(root)
    window.addEventListener('resize', measurePill)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measurePill)
    }
  }, [measurePill])

  const clearWrapTimeout = useCallback(() => {
    if (wrapTimeoutRef.current != null) {
      window.clearTimeout(wrapTimeoutRef.current)
      wrapTimeoutRef.current = null
    }
  }, [])

  const jumpWithoutTransition = useCallback(
    (nextTrackIndex: number) => {
      clearWrapTimeout()
      setEnableTransition(false)
      trackIndexRef.current = nextTrackIndex
      setTrackIndex(nextTrackIndex)
      measureOffset(nextTrackIndex)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEnableTransition(true)
          animatingRef.current = false
          const pending = pendingDeltaRef.current
          pendingDeltaRef.current = 0
          if (pending !== 0) {
            const resume = pending > 0 ? 1 : -1
            pendingDeltaRef.current = pending - resume
            requestAnimationFrame(() => {
              goTrackRef.current(trackIndexRef.current + resume)
            })
          }
        })
      })
    },
    [clearWrapTimeout, measureOffset],
  )

  const settleAfterMove = useCallback(
    (index: number, moveId: number) => {
      if (settledMoveIdRef.current === moveId) return
      settledMoveIdRef.current = moveId
      clearWrapTimeout()
      // Drifted into the trailing copy → snap back one set.
      if (index >= COUNT * 2) {
        jumpWithoutTransition(index - COUNT)
        return
      }
      // Drifted into the leading copy → snap forward one set.
      if (index < COUNT) {
        jumpWithoutTransition(index + COUNT)
        return
      }
      animatingRef.current = false
      const pending = pendingDeltaRef.current
      pendingDeltaRef.current = 0
      if (pending !== 0) {
        const resume = pending > 0 ? 1 : -1
        pendingDeltaRef.current = pending - resume
        goTrackRef.current(trackIndexRef.current + resume)
      }
    },
    [clearWrapTimeout, jumpWithoutTransition],
  )

  const goTrackRef = useRef<(next: number) => void>(() => {})

  const goTrack = useCallback(
    (next: number) => {
      if (animatingRef.current) {
        pendingDeltaRef.current = next > trackIndexRef.current ? 1 : -1
        return
      }
      if (next !== START_INDEX) setHasLeftDefault(true)
      const moveId = moveIdRef.current + 1
      moveIdRef.current = moveId
      animatingRef.current = true
      setEnableTransition(true)
      trackIndexRef.current = next
      const slide = trackRef.current?.children[next] as HTMLElement | undefined
      if (slide) setOffsetPx(slide.offsetLeft)
      setTrackIndex(next)

      const finish = () => settleAfterMove(next, moveId)

      if (prefersReducedMotion()) {
        requestAnimationFrame(finish)
        return
      }

      clearWrapTimeout()
      wrapTimeoutRef.current = window.setTimeout(finish, TRANSITION_MS + 80)
    },
    [clearWrapTimeout, settleAfterMove],
  )

  goTrackRef.current = goTrack

  const onTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== trackRef.current) return
      if (event.propertyName !== 'transform') return
      settleAfterMove(trackIndexRef.current, moveIdRef.current)
    },
    [settleAfterMove],
  )

  const goPrev = useCallback(() => goTrack(trackIndexRef.current - 1), [goTrack])
  const goNext = useCallback(() => goTrack(trackIndexRef.current + 1), [goTrack])

  const goToLogical = useCallback(
    (logical: number) => {
      const clamped = ((logical % COUNT) + COUNT) % COUNT
      // Prefer the middle copy so neighbors always exist on both sides.
      const target = COUNT + clamped
      if (target === trackIndexRef.current && !animatingRef.current) return
      if (animatingRef.current) {
        pendingDeltaRef.current = 0
        animatingRef.current = false
        clearWrapTimeout()
      }
      goTrack(target)
    },
    [clearWrapTimeout, goTrack],
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

  const clipLeftAtVertical = !hasLeftDefault && trackIndex === START_INDEX

  return (
    <div
      className={[
        'landing-features-marquee sa-enter relative z-10 mt-10 w-full @container overflow-visible transition-[clip-path] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none',
        clipLeftAtVertical ? '[clip-path:inset(0_-100vw_0_0)]' : '[clip-path:inset(0_-100vw_0_-100vw)]',
      ].join(' ')}
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
              ? 'transition-transform duration-500 ease-[var(--sa-ease)] motion-reduce:transition-none'
              : 'transition-none',
          ].join(' ')}
          style={{
            transform: `translateX(-${offsetPx}px)`,
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
              className={`sa-card ${CARD_CLASS}`}
              draggable={false}
              loading="eager"
              onLoad={() => measureOffset()}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 landing-4096-2304:mt-[1.95rem] landing-5120-2880:mt-[1.95rem] landing-7680-4320:mt-14">
        <div
          ref={dotsRef}
          className="relative flex items-center gap-2 landing-7680-4320:gap-4"
          role="tablist"
          aria-label="Feature slides"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#611879] landing-7680-4320:h-4 motion-reduce:transition-none"
            style={{
              left: pill.left,
              width: Math.max(pill.width, 8),
              transition: 'left var(--sa-duration) var(--sa-ease), width var(--sa-duration) var(--sa-ease)',
            }}
          />
          {FEATURE_MARQUEE_ITEMS.map((item, i) => {
            const active = i === logicalIndex
            return (
              <button
                key={item.alt}
                type="button"
                role="tab"
                data-sa-dot=""
                aria-selected={active}
                aria-label={`Show feature ${i + 1} of ${COUNT}`}
                onClick={() => goToLogical(i)}
                className={[
                  'sa-press relative z-10 size-2 rounded-full outline-none transition-[background-color,transform] duration-[var(--sa-fast)] ease-[var(--sa-ease)] focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2 landing-7680-4320:size-4 motion-reduce:transition-none',
                  active ? 'bg-transparent' : 'bg-[#d1d5db] hover:bg-[#9ca3af]',
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
            className="sa-press sa-surface flex size-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-slate-700 outline-none hover:border-[#d1d5db] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2 landing-7680-4320:size-20"
          >
            <IconArrowRight className="size-4 rotate-180 transition-transform duration-[var(--sa-fast)] ease-[var(--sa-ease)] landing-7680-4320:size-8" />
          </button>
          <button
            type="button"
            aria-label="Next feature"
            onClick={goNext}
            className="sa-press sa-surface flex size-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-slate-700 outline-none hover:border-[#d1d5db] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#611879] focus-visible:ring-offset-2 landing-7680-4320:size-20"
          >
            <IconArrowRight className="size-4 transition-transform duration-[var(--sa-fast)] ease-[var(--sa-ease)] landing-7680-4320:size-8" />
          </button>
        </div>
      </div>
    </div>
  )
}
