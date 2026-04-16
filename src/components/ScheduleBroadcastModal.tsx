import { useId, useMemo, useState } from 'react'

export type ScheduleAudience = 'all' | 'building' | 'units'

export type ScheduleBroadcastSummary = {
  subject: string
  message: string
  audience: ScheduleAudience
  units: string
  channelEmail: boolean
  channelSms: boolean
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function audienceBadgeText(s: ScheduleBroadcastSummary): string {
  switch (s.audience) {
    case 'all':
      return 'All Residents (142)'
    case 'building':
      return 'Specific Building'
    case 'units':
      return s.units.trim()
        ? `Units: ${s.units.trim()}`
        : 'Specific Units'
    default:
      return 'Residents'
  }
}

function channelsBadgeText(s: ScheduleBroadcastSummary): string {
  if (s.channelEmail && s.channelSms) return 'Email · SMS'
  if (s.channelSms) return 'SMS'
  return 'Email'
}

export function ScheduleBroadcastModal({
  open,
  summary,
  onClose,
  onConfirm,
}: {
  open: boolean
  summary: ScheduleBroadcastSummary
  onClose: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  const audienceBadge = useMemo(() => audienceBadgeText(summary), [summary])
  const channelBadge = useMemo(() => channelsBadgeText(summary), [summary])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setDate('')
      setTime('')
    }
  }

  if (!open) return null

  const scheduleValid = Boolean(date.trim() && time.trim())

  function applyDateTime(d: Date, hour: number, minute: number) {
    const next = new Date(d)
    next.setHours(hour, minute, 0, 0)
    setDate(toDateInputValue(next))
    setTime(`${pad2(hour)}:${pad2(minute)}`)
  }

  function tomorrowAt(hour: number, minute: number) {
    const t = new Date()
    t.setDate(t.getDate() + 1)
    applyDateTime(t, hour, minute)
  }

  function nextMondayAt9() {
    const t = new Date()
    const dow = t.getDay()
    let add = (8 - dow) % 7
    if (add === 0) add = 7
    t.setDate(t.getDate() + add)
    applyDateTime(t, 9, 0)
  }

  function nextWeekAt9() {
    const t = new Date()
    t.setDate(t.getDate() + 7)
    applyDateTime(t, 9, 0)
  }

  function handleConfirm() {
    if (!scheduleValid) return
    onConfirm()
  }

  const previewBody =
    summary.message.trim().slice(0, 120) + (summary.message.length > 120 ? '…' : '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90dvh,720px)] w-full max-w-[680px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <svg className="size-5 text-[#155dfc]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]"
              >
                Schedule Broadcast
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Choose when to send this message
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
            <div className="flex gap-3">
              <svg className="mt-0.5 size-5 shrink-0 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8.5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                  {summary.subject.trim() || '—'}
                </p>
                <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                  {previewBody.trim() || '—'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] leading-4">
                  <span className="text-[#6a7282]">Sending to:</span>
                  <span className="rounded bg-[#dbeafe] px-2 py-0.5 font-medium text-[#1447e6]">
                    {audienceBadge}
                  </span>
                  <span className="text-[#99a1af]">via</span>
                  <span className="rounded bg-[#e5e7eb] px-2 py-0.5 text-[#364153]">
                    {channelBadge}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="schedule-date"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Date
              </label>
              <input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
              />
            </div>
            <div>
              <label
                htmlFor="schedule-time"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Time
              </label>
              <input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#eff6ff] py-2.5 pl-3 pr-3">
            <svg className="size-4 shrink-0 text-[#155dfc]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
              Timezone: Pacific Time (PT) — UTC−8
            </p>
          </div>

          <div className="mt-6">
            <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
              Quick Schedule
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => tomorrowAt(9, 0)}
                className="inline-flex h-[38px] min-w-[140px] flex-1 items-center justify-center rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[150px]"
              >
                Tomorrow 9 AM
              </button>
              <button
                type="button"
                onClick={() => tomorrowAt(17, 0)}
                className="inline-flex h-[38px] min-w-[140px] flex-1 items-center justify-center rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[150px]"
              >
                Tomorrow 5 PM
              </button>
              <button
                type="button"
                onClick={nextMondayAt9}
                className="inline-flex h-[38px] min-w-[140px] flex-1 items-center justify-center rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[150px]"
              >
                Monday 9 AM
              </button>
              <button
                type="button"
                onClick={nextWeekAt9}
                className="inline-flex h-[38px] min-w-[140px] flex-1 items-center justify-center rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[150px]"
              >
                Next Week
              </button>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!scheduleValid}
            onClick={handleConfirm}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#155dfc] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none transition-colors enabled:hover:bg-[#1249d6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="size-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" strokeLinecap="round" />
            </svg>
            Confirm Schedule
          </button>
        </footer>
      </div>
    </div>
  )
}
