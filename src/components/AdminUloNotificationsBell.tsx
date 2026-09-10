import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminBottomSheet } from '@/components/AdminBottomSheet'
import { ConversationMonitoringModal } from '@/components/ConversationMonitoringModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  fetchAdminUloNotifications,
  parseActivationFailureNotificationId,
  parseRecommendationNotificationId,
  type AdminUloNotification,
} from '@/lib/conversationMonitoring'
import { propertyResidentDetailPath } from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'

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

function NotificationItem({
  item,
  onSelect,
  stagger = 0,
}: {
  item: AdminUloNotification
  onSelect: (conversationId: string) => void
  stagger?: number
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.conversationId)}
      style={{ '--sa-stagger': stagger } as CSSProperties}
      className="sa-stagger sa-row w-full border-b border-[#e5e7eb] px-4 py-3.5 text-left outline-none hover:bg-[#fafafa] focus-visible:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5] last:border-b-0"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-5 text-[#0a0a0a]">{item.title}</p>
        <span className="shrink-0 text-[11px] leading-4 text-[#6a7282]">{item.timeLabel}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#364153]">{item.summary}</p>
    </button>
  )
}

function NotificationsPanel({
  titleId,
  loading,
  notifications,
  onSelect,
  onClose,
  onNavigate,
  showClose,
}: {
  titleId: string
  loading: boolean
  notifications: AdminUloNotification[]
  onSelect: (conversationId: string) => void
  onClose: () => void
  onNavigate?: () => void
  showClose?: boolean
}) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-4 py-3">
        <p id={titleId} className="sa-enter text-[14px] font-semibold text-[#0a0a0a]">
          Notifications
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/admin/communication"
            onClick={() => {
              onClose()
              onNavigate?.()
            }}
            className="sa-link text-[12px] font-medium text-[#1447e6] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            All conversations
          </Link>
          {showClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="sa-press flex size-8 items-center justify-center rounded-[8px] text-[#364153] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">
            No admin-directed updates yet.
          </p>
        ) : (
          notifications.map((item, index) => (
            <NotificationItem
              key={item.conversationId}
              item={item}
              stagger={Math.min(index, 8)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </>
  )
}

type AdminUloNotificationsBellProps = {
  onNavigate?: () => void
  compact?: boolean
}

/** Header bell — Ulo admin summaries with transcript drill-in. */
export function AdminUloNotificationsBell({
  onNavigate,
  compact = false,
}: AdminUloNotificationsBellProps) {
  const navigate = useNavigate()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [useSideSheet, setUseSideSheet] = useState(
    () =>
      compact ||
      (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches),
  )
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState<AdminUloNotification[]>([])
  const [monitoringConversationId, setMonitoringConversationId] = useState<string | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const sync = () => setUseSideSheet(compact || mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [compact])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)

    void fetchAdminUloNotifications().then((items) => {
      if (cancelled) return
      setNotifications(items)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open])

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

  const unreadCount = notifications.filter(
    (item) => Date.now() - item.updatedAtMs < 24 * 60 * 60 * 1000,
  ).length

  function handleSelect(conversationId: string) {
    setOpen(false)
    onNavigate?.()

    const recommendationKey = parseRecommendationNotificationId(conversationId)
    if (recommendationKey) {
      navigate('/admin')
      return
    }

    const activationResidentId = parseActivationFailureNotificationId(conversationId)
    if (activationResidentId) {
      void (async () => {
        if (!supabase) {
          navigate('/admin/residents')
          return
        }
        const { data } = await supabase
          .from('users')
          .select('building')
          .eq('id', activationResidentId)
          .eq('landlord_id', getActiveLandlordId())
          .maybeSingle()
        const building =
          typeof data?.building === 'string' && data.building.trim()
            ? data.building.trim()
            : null
        if (building) {
          navigate(propertyResidentDetailPath(building, activationResidentId))
          return
        }
        navigate('/admin/residents')
      })()
      return
    }

    setMonitoringConversationId(conversationId)
  }

  function closePanel() {
    setOpen(false)
  }

  const panel = (
    <NotificationsPanel
      titleId={panelId}
      loading={loading}
      notifications={notifications}
      onSelect={handleSelect}
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
          aria-label="Notifications"
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
          {unreadCount > 0 ? (
            <span
              className={[
                'sa-enter-scale absolute flex items-center justify-center rounded-full bg-[#c10007] font-semibold leading-none text-white',
                compact
                  ? 'right-0.5 top-0.5 size-3.5 text-[9px]'
                  : 'right-1 top-1 size-4 text-[10px]',
              ].join(' ')}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
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

      <ConversationMonitoringModal
        open={monitoringConversationId != null}
        conversationId={monitoringConversationId}
        onClose={() => setMonitoringConversationId(null)}
      />
    </>
  )
}
