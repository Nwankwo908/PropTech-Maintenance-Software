import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConversationMonitoringModal } from '@/components/ConversationMonitoringModal'
import {
  fetchAdminUloNotifications,
  type AdminUloNotification,
  type MonitoringRiskLevel,
} from '@/lib/conversationMonitoring'

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg className="size-3.5 text-[#7c3aed]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2zm7 9 1 3.5L23.5 16l-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1 1-3.5zm-14 0 1 3.5L9.5 16l-3.5 1-1 3.5-1-3.5L.5 16l3.5-1 1-3.5z" />
    </svg>
  )
}

const RISK_STYLES: Record<MonitoringRiskLevel, string> = {
  high: 'border-[#fecaca] bg-[#fff5f5] text-[#c10007]',
  medium: 'border-[#fde68a] bg-[#fffbeb] text-[#a65f00]',
  low: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]',
}

function NotificationItem({
  item,
  onSelect,
}: {
  item: AdminUloNotification
  onSelect: (conversationId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.conversationId)}
      className="w-full border-b border-[#e5e7eb] px-4 py-3.5 text-left outline-none transition-colors hover:bg-[#fafafa] focus-visible:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5] last:border-b-0"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-5 text-[#0a0a0a]">{item.title}</p>
        <span className="shrink-0 text-[11px] leading-4 text-[#6a7282]">{item.timeLabel}</span>
      </div>
      {item.riskLabel && item.riskLevel ? (
        <span
          className={`mt-1.5 inline-flex rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${RISK_STYLES[item.riskLevel]}`}
        >
          {item.riskLabel}
        </span>
      ) : null}
      <p className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7c3aed]">
        <SparkleIcon />
        Ulo summary for admin
      </p>
      <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-[#364153]">{item.summary}</p>
    </button>
  )
}

type AdminUloNotificationsBellProps = {
  onNavigate?: () => void
}

/** Header bell — Ulo admin summaries with transcript drill-in. */
export function AdminUloNotificationsBell({ onNavigate }: AdminUloNotificationsBellProps) {
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState<AdminUloNotification[]>([])
  const [monitoringConversationId, setMonitoringConversationId] = useState<string | null>(null)

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
    if (!open) return

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
  }, [open])

  const unreadCount = notifications.filter(
    (item) => Date.now() - item.updatedAtMs < 24 * 60 * 60 * 1000,
  ).length

  function handleSelect(conversationId: string) {
    setOpen(false)
    onNavigate?.()
    setMonitoringConversationId(conversationId)
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-label="Notifications"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
          className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-[#101828] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
        >
          <BellIcon />
          {unreadCount > 0 ? (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-[#c10007] text-[10px] font-semibold leading-none text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </button>

        {open ? (
          <div
            id={panelId}
            role="dialog"
            aria-label="Ulo notifications"
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(calc(100vw-2rem),420px)] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-between border-b border-[#e5e7eb] px-4 py-3">
              <p className="text-[14px] font-semibold text-[#0a0a0a]">Notifications</p>
              <Link
                to="/admin/communication"
                onClick={() => {
                  setOpen(false)
                  onNavigate?.()
                }}
                className="text-[12px] font-medium text-[#1447e6] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
              >
                All conversations
              </Link>
            </div>

            <div className="max-h-[min(70dvh,480px)] overflow-y-auto overscroll-contain">
              {loading ? (
                <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
              ) : notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">
                  No admin-directed updates yet.
                </p>
              ) : (
                notifications.map((item) => (
                  <NotificationItem key={item.conversationId} item={item} onSelect={handleSelect} />
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <ConversationMonitoringModal
        open={monitoringConversationId != null}
        conversationId={monitoringConversationId}
        onClose={() => setMonitoringConversationId(null)}
      />
    </>
  )
}
