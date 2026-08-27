import { useCallback, useRef, useState, type TouchEvent } from 'react'
import homeHealth from '@/assets/Home Heralth.png'
import leaseRenewals from '@/assets/Lease Renewals.png'
import maintenanceRequest from '@/assets/Maintenance Request.png'
import moveInCoordination from '@/assets/Move in Coordination.png'
import proactiveMaintenance from '@/assets/Proactive Maintenance.png'
import propertyInsights from '@/assets/Property Insights.png'
import rentCollection from '@/assets/Rent Collection_2.png'

const FEATURE_MARQUEE_ITEMS = [
  { src: proactiveMaintenance, width: 4195, height: 4131, alt: 'Proactive Maintenance — Ulo builds a maintenance calendar from property data' },
  { src: propertyInsights, width: 4195, height: 4140, alt: 'Property Insights — workflow data surfaced as actionable portfolio insights' },
  { src: rentCollection, width: 4195, height: 4098, alt: 'Rent Collection — automated SMS reminders and payment tracking' },
  { src: homeHealth, width: 4195, height: 4098, alt: 'Home Health Check — periodic walkthrough assessments dispatched to technicians' },
  { src: maintenanceRequest, width: 4195, height: 4098, alt: 'Maintenance Request — tenant texts an issue, Ulo classifies and coordinates vendors' },
  { src: moveInCoordination, width: 4195, height: 4098, alt: 'Move in Coordination — Ulo guides new tenants through move-in' },
  { src: leaseRenewals, width: 4168, height: 4098, alt: 'Lease Renewals — Ulo monitors expiry dates and launches renewal workflows' },
] as const

const TAP_MOVE_PX = 12

/** Horizontal looping feature cards. Pauses on hover (desktop); tap toggles pause on mobile. */
export function FeaturesMarquee() {
  const loop = [...FEATURE_MARQUEE_ITEMS, ...FEATURE_MARQUEE_ITEMS]
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const [tapPaused, setTapPaused] = useState(false)

  const onTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const onTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const dx = Math.abs(touch.clientX - start.x)
    const dy = Math.abs(touch.clientY - start.y)
    if (dx > TAP_MOVE_PX || dy > TAP_MOVE_PX) return
    setTapPaused((paused) => !paused)
  }, [])

  const onTouchCancel = useCallback(() => {
    touchStartRef.current = null
  }, [])

  return (
    <div
      className="landing-features-marquee relative mt-10 w-full @container touch-pan-y overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] landing-phone-tall:[mask-image:none] landing-phone-tall:[-webkit-mask-image:none]"
      aria-label="Product feature highlights"
      aria-pressed={tapPaused}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div
        className={`flex w-max animate-[features-marquee_50s_linear_infinite] gap-4 landing-7680-4320:gap-10 motion-reduce:animate-none [@media(hover:hover)]:hover:[animation-play-state:paused] ${
          tapPaused ? '[animation-play-state:paused]' : ''
        }`}
      >
        {loop.map((item, index) => (
          <img
            key={`${item.alt}-${index}`}
            src={item.src}
            alt={item.alt}
            width={item.width}
            height={item.height}
            className="h-auto w-[calc((100vw-3rem)*0.7)] shrink-0 select-none rounded-2xl border border-[#e5e7eb] max-[410px]:!w-[calc((100vw-3rem)*0.7)] landing-compact:!w-[calc((100vw-3rem)*0.7)] landing-compact:!h-auto landing-phone-tall:!w-[calc(100vw-3rem)] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!w-[calc((100vw-3rem)*0.56)] [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!w-[calc((100vw-3rem)*0.56)] landing-720-576:!h-auto sm:h-[min(476px,70vw)] sm:w-auto landing-884:!h-[min(333px,49vw)] landing-884:!w-auto landing-1024-600:!h-auto landing-1024-600:!w-[calc((100cqw-2rem)/2.5)] landing-1024-600:!max-w-none landing-7680-4320:!h-[min(1190px,70vw)] landing-7680-4320:!w-auto landing-7680-4320:rounded-[2.5rem] [@media(min-width:580px)_and_(max-width:640px)_and_(min-height:920px)_and_(max-height:1080px)]:!h-auto [@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]:!h-auto"
            draggable={false}
            loading={index < FEATURE_MARQUEE_ITEMS.length ? 'eager' : 'lazy'}
          />
        ))}
      </div>
    </div>
  )
}
