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
import {
  isTryDemoUloActivityGuideStep,
  readTryDemoAttentionGuideActiveStep,
  TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT,
  TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID,
} from '@/lib/tryDemoAttentionGuide'

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
  /**
   * Desktop header only. Owns the Try Demo step-11 spotlight host id so the tip
   * never measures the hidden mobile duplicate.
   */
  tryDemoSpotlightHost?: boolean
}

/** Header bell — Ulo Activity Feed with a live activity count. */
export function AdminUloNotificationsBell({
  onNavigate,
  compact = false,
  tryDemoSpotlightHost = false,
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
  const [tipForcesActivityOpen, setTipForcesActivityOpen] = useState(() =>
    tryDemoSpotlightHost &&
    isTryDemoUloActivityGuideStep(readTryDemoAttentionGuideActiveStep() ?? -1),
  )

  useEffect(() => {
    if (!tryDemoSpotlightHost) return
    function syncTipStep() {
      const tipStep = readTryDemoAttentionGuideActiveStep()
      const forceOpen = isTryDemoUloActivityGuideStep(tipStep ?? -1)
      setTipForcesActivityOpen((wasForced) => {
        if (wasForced && !forceOpen) setOpen(false)
        return forceOpen
      })
      if (forceOpen) setOpen(true)
    }
    syncTipStep()
    window.addEventListener(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, syncTipStep)
    return () => window.removeEventListener(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, syncTipStep)
  }, [tryDemoSpotlightHost])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const sync = () => setUseSideSheet(compact || mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [compact])

  // Tip step 11 needs the desktop dropdown under the spotlight host (not the side sheet portal).
  const effectiveUseSideSheet = tipForcesActivityOpen ? false : useSideSheet

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

  const feedOpen = open || tipForcesActivityOpen

  useEffect(() => {
    if (!feedOpen) return
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
  }, [feedOpen, landlordId])

  useEffect(() => {
    if (!feedOpen) return
    let cancelled = false
    void listPropertiesForLandlord(landlordId).then((result) => {
      if (cancelled || !result.ok) return
      setPropertyIdByBuilding(buildPropertyIdByBuilding(result.properties))
    })
    return () => {
      cancelled = true
    }
  }, [feedOpen, landlordId])

  useEffect(() => {
    if (!feedOpen || effectiveUseSideSheet) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !tipForcesActivityOpen) setOpen(false)
    }

    function onPointerDown(event: MouseEvent) {
      // Keep the open feed visible while the Try Demo tip owns this step.
      if (tipForcesActivityOpen) return
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
  }, [feedOpen, effectiveUseSideSheet, tipForcesActivityOpen])

  const activityCount = events.length

  function handleOpenTarget(target: FeedTooltipDestination) {
    if (tipForcesActivityOpen) return
    setOpen(false)
    onNavigate?.()
    navigate(activityFeedNavigatePath(target))
  }

  function closePanel() {
    if (tipForcesActivityOpen) return
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
      showClose={effectiveUseSideSheet}
    />
  )

  const panelMounted = feedOpen && !effectiveUseSideSheet

  return (
    <>
      <div
        ref={rootRef}
        id={tryDemoSpotlightHost ? TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID : undefined}
        data-try-demo-spotlight-cluster={tryDemoSpotlightHost ? '1' : undefined}
        data-try-demo-ulo-activity-ready={
          tryDemoSpotlightHost ? (panelMounted ? '1' : '0') : undefined
        }
        className="relative"
      >
        <button
          type="button"
          aria-label="Ulo Activity Feed"
          aria-expanded={feedOpen}
          aria-controls={panelId}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (tipForcesActivityOpen) return
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

        {panelMounted ? (
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
        open={feedOpen && effectiveUseSideSheet}
        onClose={tipForcesActivityOpen ? () => undefined : closePanel}
        labelledBy={panelId}
        placement="end"
      >
        {panel}
      </AdminBottomSheet>
    </>
  )
}
