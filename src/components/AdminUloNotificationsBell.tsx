import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminBottomSheet } from '@/components/AdminBottomSheet'
import {
  activityFeedNavigatePath,
  ULO_ACTIVITY_FEED_LIMIT,
  UloActivityFeedList,
  type FeedTooltipDestination,
} from '@/components/UloActivityFeed'
import { fetchRecentPropertyOperationsEvents, type PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'
import { listPropertiesForLandlord } from '@/lib/properties'
import { buildPropertyIdByBuilding } from '@/lib/propertyRoutes'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function BellIcon({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={compact ? 'size-4' : 'size-5'}
    >
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ActivityFeedPanel({
  titleId,
  loading,
  events,
  propertyIdByBuilding,
  onOpenTarget,
  onClose,
  onNavigate,
  showClose,
}: {
  titleId: string
  loading: boolean
  events: PropertyOperationsTimelineEvent[]
  propertyIdByBuilding: Map<string, string>
  onOpenTarget: (target: FeedTooltipDestination) => void
  onClose: () => void
  onNavigate?: () => void
  showClose?: boolean
}) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-4 py-3">
        <p id={titleId} className="sa-enter text-[14px] font-semibold text-[#0a0a0a]">
          Ulo Activity Feed
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/admin"
            onClick={() => {
              onClose()
              onNavigate?.()
            }}
            className="sa-link text-[12px] font-medium text-[#1447e6] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Overview
          </Link>
          {showClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close activity feed"
              className="sa-press flex size-8 items-center justify-center rounded-[8px] text-[#364153] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <UloActivityFeedList
          events={events}
          loading={loading}
          propertyIdByBuilding={propertyIdByBuilding}
          onOpenTarget={onOpenTarget}
          showInfo={false}
          dense
        />
      </div>
    </>
  )
}

type AdminUloNotificationsBellProps = {
  onNavigate?: () => void
  compact?: boolean
}

/** Header bell — Ulo Activity Feed with a live activity count. */
export function AdminUloNotificationsBell({
  onNavigate,
  compact = false,
}: AdminUloNotificationsBellProps) {
  const navigate = useNavigate()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const landlordId = getActiveLandlordId()
  const [open, setOpen] = useState(false)
  const [useSideSheet, setUseSideSheet] = useState(
    () =>
      compact ||
      (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches),
  )
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [propertyIdByBuilding, setPropertyIdByBuilding] = useState<Map<string, string>>(
    () => new Map(),
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const sync = () => setUseSideSheet(compact || mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [compact])

  useEffect(() => {
    let cancelled = false
    void fetchRecentPropertyOperationsEvents(ULO_ACTIVITY_FEED_LIMIT).then((items) => {
      if (cancelled) return
      setEvents(items)
    })
    return () => {
      cancelled = true
    }
  }, [landlordId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void fetchRecentPropertyOperationsEvents(ULO_ACTIVITY_FEED_LIMIT).then((items) => {
      if (cancelled) return
      setEvents(items)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, landlordId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listPropertiesForLandlord(landlordId).then((result) => {
      if (cancelled || !result.ok) return
      setPropertyIdByBuilding(buildPropertyIdByBuilding(result.properties))
    })
    return () => {
      cancelled = true
    }
  }, [open, landlordId])

  useEffect(() => {
    if (!open || useSideSheet) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, useSideSheet])

  const activityCount = events.length

  function handleOpenTarget(target: FeedTooltipDestination) {
    setOpen(false)
    onNavigate?.()
    navigate(activityFeedNavigatePath(target))
  }

  function closePanel() {
    setOpen(false)
  }

  const panel = (
    <ActivityFeedPanel
      titleId={panelId}
      loading={loading}
      events={events}
      propertyIdByBuilding={propertyIdByBuilding}
      onOpenTarget={handleOpenTarget}
      onClose={closePanel}
      onNavigate={onNavigate}
      showClose={useSideSheet}
    />
  )

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-label="Ulo Activity Feed"
          aria-expanded={open}
          aria-controls={panelId}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen((value) => {
              const next = !value
              if (next) onNavigate?.()
              return next
            })
          }}
          className={[
            'sa-press relative flex shrink-0 items-center justify-center rounded-full text-[#101828] outline-none hover:bg-[#f3f4f6] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2',
            compact ? 'size-[1.8rem]' : 'size-9',
          ].join(' ')}
        >
          <BellIcon compact={compact} />
          {activityCount > 0 ? (
            <span
              className={[
                'sa-enter-scale absolute flex items-center justify-center rounded-full bg-[#c10007] font-semibold leading-none text-white',
                compact
                  ? 'right-0.5 top-0.5 size-3.5 text-[9px]'
                  : 'right-1 top-1 size-4 text-[10px]',
              ].join(' ')}
            >
              {activityCount > 9 ? '9+' : activityCount}
            </span>
          ) : null}
        </button>

        {open && !useSideSheet ? (
          <div
            role="dialog"
            aria-labelledby={panelId}
            className="sa-enter absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[min(70dvh,520px)] w-[min(calc(100vw-2rem),420px)] flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
          >
            {panel}
          </div>
        ) : null}
      </div>

      <AdminBottomSheet
        open={open && useSideSheet}
        onClose={closePanel}
        labelledBy={panelId}
        placement="end"
      >
        {panel}
      </AdminBottomSheet>
    </>
  )
}
