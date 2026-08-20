import { useCallback, useRef, useState, type TouchEvent } from 'react'
import homeHealth from '@/assets/Home Heralth.png'
import leaseRenewals from '@/assets/Lease Renewals.png'
import maintenanceRequest from '@/assets/Maintenance Request.png'
import moveInCoordination from '@/assets/Move in Coordination.png'
import proactiveMaintenance from '@/assets/Proactive Maintenance.png'
import propertyInsights from '@/assets/Property Insights.png'
import rentCollection from '@/assets/Rent Collection_2.png'

const FEATURE_MARQUEE_ITEMS = [
  { src: proactiveMaintenance, alt: 'Proactive Maintenance — Ulo builds a maintenance calendar from property data' },
  { src: propertyInsights, alt: 'Property Insights — workflow data surfaced as actionable portfolio insights' },
  { src: rentCollection, alt: 'Rent Collection — automated SMS reminders and payment tracking' },
  { src: homeHealth, alt: 'Home Health Check — periodic walkthrough assessments dispatched to technicians' },
  { src: maintenanceRequest, alt: 'Maintenance Request — tenant texts an issue, Ulo classifies and coordinates vendors' },
  { src: moveInCoordination, alt: 'Move in Coordination — Ulo guides new tenants through move-in' },
  { src: leaseRenewals, alt: 'Lease Renewals — Ulo monitors expiry dates and launches renewal workflows' },
] as const

function touchIsInside(el: HTMLElement, touch: Touch) {
  const rect = el.getBoundingClientRect()
  return (
    touch.clientX >= rect.left &&
    touch.clientX <= rect.right &&
    touch.clientY >= rect.top &&
    touch.clientY <= rect.bottom
  )
}

/** Horizontal looping feature cards under the Features title. Pauses on hover (desktop) and while a finger is on the carousel (mobile). */
export function FeaturesMarquee() {
  const loop = [...FEATURE_MARQUEE_ITEMS, ...FEATURE_MARQUEE_ITEMS]
  const rootRef = useRef<HTMLDivElement>(null)
  const [touchPaused, setTouchPaused] = useState(false)

  const pause = useCallback(() => setTouchPaused(true), [])
  const resume = useCallback(() => setTouchPaused(false), [])

  const onTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const el = rootRef.current
    const touch = event.touches[0]
    if (!el || !touch) return
    setTouchPaused(touchIsInside(el, touch))
  }, [])

  return (
    <div
      ref={rootRef}
      className="relative mt-10 w-full touch-pan-y overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
      aria-label="Product feature highlights"
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
      onTouchMove={onTouchMove}
    >
      <div
        className={`flex w-max animate-[features-marquee_50s_linear_infinite] gap-4 motion-reduce:animate-none [@media(hover:hover)]:hover:[animation-play-state:paused] ${
          touchPaused ? '[animation-play-state:paused]' : ''
        }`}
      >
        {loop.map((item, index) => (
          <img
            key={`${item.alt}-${index}`}
            src={item.src}
            alt={item.alt}
            className="h-[min(476px,70vw)] w-auto shrink-0 select-none rounded-2xl border border-[#e5e7eb]"
            draggable={false}
            loading={index < FEATURE_MARQUEE_ITEMS.length ? 'eager' : 'lazy'}
          />
        ))}
      </div>
    </div>
  )
}
