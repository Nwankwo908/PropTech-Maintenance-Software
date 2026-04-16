import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import broadcastIcon from '@/assets/Broadcast.svg'
import {
  ScheduleBroadcastModal,
  type ScheduleBroadcastSummary,
} from '@/components/ScheduleBroadcastModal'
import { SparkleIcon } from '@/components/SparkleIcon'

type Audience = 'all' | 'building' | 'units'

const RETRY_ATTEMPT_OPTIONS = [
  { value: '2', label: '2 attempts' },
  { value: '3', label: '3 attempts' },
  { value: '5', label: '5 attempts' },
] as const

const RETRY_DELAY_OPTIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '2h', label: '2 hours' },
] as const

const RECURRING_FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const WEEKDAY_LABELS: Record<(typeof WEEKDAY_KEYS)[number], string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

const EVENT_TRIGGER_OPTIONS = [
  { key: 'moveIn' as const, emoji: '🏠', label: 'New Resident Move-In' },
  { key: 'lease' as const, emoji: '📄', label: 'Lease Renewal (30 days)' },
  { key: 'maintenance' as const, emoji: '✅', label: 'Maintenance Completed' },
  { key: 'payment' as const, emoji: '💰', label: 'Payment Due Reminder' },
]

const FOLLOW_UP_AFTER_OPTIONS = [
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
  { value: '72h', label: '72 hours' },
] as const

function retryDelaySummaryShort(value: string): string {
  const map: Record<string, string> = { '15m': '15 min', '30m': '30 min', '1h': '1 hr', '2h': '2 hr' }
  return map[value] ?? value
}

export type SendBroadcastPresentation = 'modal' | 'rail'

export function SendBroadcastMessageModal({
  open,
  onClose,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  /** `rail` = full-height panel from the right; `modal` = centered dialog. */
  presentation?: SendBroadcastPresentation
}) {
  const titleId = useId()
  const automationSwitchId = useId()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('units')
  const [units, setUnits] = useState('')
  const [channelEmail, setChannelEmail] = useState(true)
  const [channelSms, setChannelSms] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState(true)
  const [autoRetryFailed, setAutoRetryFailed] = useState(false)
  const [recurringSchedule, setRecurringSchedule] = useState(false)
  const [eventTriggers, setEventTriggers] = useState(false)
  const [autoFollowUp, setAutoFollowUp] = useState(false)
  const [retryMaxAttempts, setRetryMaxAttempts] = useState('3')
  const [retryDelay, setRetryDelay] = useState('30m')
  const [recurringFrequency, setRecurringFrequency] = useState('weekly')
  const [recurringDays, setRecurringDays] = useState<Set<(typeof WEEKDAY_KEYS)[number]>>(
    () => new Set(),
  )
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [eventTriggerSelection, setEventTriggerSelection] = useState<
    Record<(typeof EVENT_TRIGGER_OPTIONS)[number]['key'], boolean>
  >({
    moveIn: false,
    lease: false,
    maintenance: false,
    payment: false,
  })
  const [followUpAfter, setFollowUpAfter] = useState('24h')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)

  const scheduleSummary = useMemo(
    (): ScheduleBroadcastSummary => ({
      subject,
      message,
      audience,
      units,
      channelEmail,
      channelSms,
    }),
    [subject, message, audience, units, channelEmail, channelSms],
  )

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (scheduleModalOpen) setScheduleModalOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, scheduleModalOpen])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setSubject('')
      setMessage('')
      setAudience('units')
      setUnits('')
      setChannelEmail(true)
      setChannelSms(false)
      setAutomationEnabled(true)
      setAutoRetryFailed(false)
      setRecurringSchedule(false)
      setEventTriggers(false)
      setAutoFollowUp(false)
      setRetryMaxAttempts('3')
      setRetryDelay('30m')
      setRecurringFrequency('weekly')
      setRecurringDays(new Set())
      setRecurringTime('09:00')
      setEventTriggerSelection({
        moveIn: false,
        lease: false,
        maintenance: false,
        payment: false,
      })
      setFollowUpAfter('24h')
      setScheduleModalOpen(false)
    }
  }

  const activeAutomationLines = useMemo(() => {
    const lines: string[] = []
    if (autoRetryFailed) {
      lines.push(
        `• Auto-retry up to ${retryMaxAttempts}x with ${retryDelaySummaryShort(retryDelay)} delay`,
      )
    }
    if (recurringSchedule) {
      const freq =
        RECURRING_FREQUENCY_OPTIONS.find((o) => o.value === recurringFrequency)?.label ??
        recurringFrequency
      const daysPart =
        recurringDays.size > 0
          ? ` (${[...recurringDays].map((k) => WEEKDAY_LABELS[k]).join(', ')})`
          : ''
      lines.push(`• Recurring ${freq.toLowerCase()}${daysPart} at ${recurringTime}`)
    }
    if (eventTriggers) {
      const names = EVENT_TRIGGER_OPTIONS.filter((e) => eventTriggerSelection[e.key]).map(
        (e) => e.label,
      )
      if (names.length > 0) {
        lines.push(`• Event triggers: ${names.join('; ')}`)
      } else {
        lines.push('• Event-based triggers (select event types above)')
      }
    }
    if (autoFollowUp) {
      const after =
        FOLLOW_UP_AFTER_OPTIONS.find((o) => o.value === followUpAfter)?.label.toLowerCase() ??
        followUpAfter
      lines.push(`• Follow-up reminder after ${after}`)
    }
    return lines
  }, [
    autoRetryFailed,
    retryMaxAttempts,
    retryDelay,
    recurringSchedule,
    recurringFrequency,
    recurringDays,
    recurringTime,
    eventTriggers,
    eventTriggerSelection,
    autoFollowUp,
    followUpAfter,
  ])

  if (!open) return null

  const isRail = presentation === 'rail'

  const unitsOk = audience !== 'units' || units.trim().length > 0
  const formValid =
    subject.trim().length > 0 &&
    message.trim().length > 0 &&
    unitsOk &&
    (channelEmail || channelSms)

  function submitSendNow() {
    if (!formValid) return
    onClose()
  }

  return (
    <div
      className={
        isRail
          ? 'fixed inset-0 z-50 flex justify-end'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      }
    >
      <div
        role="presentation"
        className={['absolute inset-0', isRail ? 'bg-black/40' : ''].filter(Boolean).join(' ')}
        aria-hidden
        onClick={() => {
          if (scheduleModalOpen) setScheduleModalOpen(false)
          else onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          isRail
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(90dvh,1040px)] w-full max-w-[753px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg'
        }
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <img
                src={broadcastIcon}
                alt=""
                className="size-5 object-contain"
              />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Send Broadcast Message
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Compose and send notifications to residents
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
          <div className="flex flex-col gap-6">
            <div>
              <label
                htmlFor="broadcast-subject"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Subject Line <span className="text-[#c10007]">*</span>
              </label>
              <input
                id="broadcast-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., Building Maintenance Notice"
                className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] transition-[border-color,box-shadow] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
              />
            </div>

            <div>
              <label
                htmlFor="broadcast-message"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Message Content <span className="text-[#c10007]">*</span>
              </label>
              <textarea
                id="broadcast-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={5}
                className="min-h-[150px] w-full resize-y rounded-[10px] border border-[#d1d5dc] px-3 py-2 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  {message.length} characters
                </p>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#9810fa] outline-none transition-colors hover:bg-[#faf5ff] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                >
                  <SparkleIcon className="size-4 text-[#9810fa]" />
                  AI Enhance Message
                </button>
              </div>
            </div>

            <div>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Select Audience <span className="text-[#c10007]">*</span>
              </p>
              <div className="flex flex-col gap-3" role="radiogroup" aria-label="Audience">
                <AudienceCard
                  selected={audience === 'all'}
                  onSelect={() => setAudience('all')}
                  title="All Residents"
                  subtitle="Send to all 142 units"
                  rightIcon={<UsersGlyph />}
                />
                <AudienceCard
                  selected={audience === 'building'}
                  onSelect={() => setAudience('building')}
                  title="Specific Building"
                  subtitle="Select one or more buildings"
                  rightIcon={<BuildingGlyph />}
                />
                <div
                  className={[
                    'rounded-[10px] border-2 p-4 transition-colors',
                    audience === 'units'
                      ? 'border-[#2b7fff] bg-[#eff6ff]'
                      : 'border-[#e5e7eb] bg-white',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={audience === 'units'}
                    onClick={() => setAudience('units')}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <RadioDot on={audience === 'units'} />
                      <div>
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                          Specific Units
                        </p>
                        <p className="text-[12px] leading-4 text-[#6a7282]">
                          Enter unit numbers manually
                        </p>
                      </div>
                    </div>
                    <FunnelGlyph className="size-5 shrink-0 text-[#6a7282]" />
                  </button>
                  {audience === 'units' ? (
                    <input
                      type="text"
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                      placeholder="e.g., 2A, 3B, 5C (comma-separated)"
                      className="ml-11 mt-3 h-9 w-[calc(100%-2.75rem)] rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Delivery Channel <span className="text-[#c10007]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChannelCard
                  selected={channelEmail}
                  onToggle={() => setChannelEmail((v) => !v)}
                  title="📧 Email"
                  subtitle="Standard delivery"
                />
                <ChannelCard
                  selected={channelSms}
                  onToggle={() => setChannelSms((v) => !v)}
                  title="💬 SMS"
                  subtitle="Immediate delivery"
                />
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-[#e5e7eb] pt-6">
              <div className="flex flex-col gap-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                <div>
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    🤖 Automation Settings
                  </p>
                  <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                    Configure automatic retries, scheduling, and triggers
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start min-[480px]:self-auto">
                  <label
                    htmlFor={automationSwitchId}
                    className="cursor-pointer text-[12px] leading-4 text-[#4a5565]"
                  >
                    Enable Automation
                  </label>
                  <button
                    id={automationSwitchId}
                    type="button"
                    role="switch"
                    aria-checked={automationEnabled}
                    onClick={() => setAutomationEnabled((v) => !v)}
                    className={[
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                      automationEnabled ? 'bg-[#155dfc]' : 'bg-[#d1d5dc]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
                        automationEnabled ? 'translate-x-5' : 'translate-x-0',
                      ].join(' ')}
                    />
                  </button>
                </div>
              </div>

              {automationEnabled ? (
                <div className="flex flex-col gap-4 rounded-[10px] bg-[#f9fafb] px-4 py-4">
                  <AutomationSettingRow
                    enabled
                    checked={autoRetryFailed}
                    onCheckedChange={setAutoRetryFailed}
                    title="Auto-Retry Failed Deliveries"
                    description="Automatically retry sending messages that fail to deliver"
                    showBorderBottom
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Max Attempts
                        </label>
                        <AutomationSelect
                          value={retryMaxAttempts}
                          onChange={setRetryMaxAttempts}
                          options={[...RETRY_ATTEMPT_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Retry Delay
                        </label>
                        <AutomationSelect
                          value={retryDelay}
                          onChange={setRetryDelay}
                          options={[...RETRY_DELAY_OPTIONS]}
                        />
                      </div>
                    </div>
                  </AutomationSettingRow>

                  <AutomationSettingRow
                    enabled
                    checked={recurringSchedule}
                    onCheckedChange={setRecurringSchedule}
                    title="Recurring Schedule"
                    description="Set up automatic recurring broadcasts"
                    showBorderBottom
                  >
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1">
                        <label className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Frequency
                        </label>
                        <AutomationSelect
                          value={recurringFrequency}
                          onChange={setRecurringFrequency}
                          options={[...RECURRING_FREQUENCY_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-[12px] font-medium leading-4 text-[#4a5565]">Select Days</p>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAY_KEYS.map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() =>
                                setRecurringDays((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(key)) next.delete(key)
                                  else next.add(key)
                                  return next
                                })
                              }
                              className={[
                                'rounded-lg border px-3 py-1.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                                recurringDays.has(key)
                                  ? 'border-[#2b7fff] bg-[#eff6ff] text-[#1447e6]'
                                  : 'border-[#d1d5dc] bg-white text-[#364153] hover:bg-[#f9fafb]',
                              ].join(' ')}
                            >
                              {WEEKDAY_LABELS[key]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="broadcast-recurring-time"
                          className="block text-[12px] font-medium leading-4 text-[#4a5565]"
                        >
                          Time
                        </label>
                        <input
                          id="broadcast-recurring-time"
                          type="time"
                          value={recurringTime}
                          onChange={(e) => setRecurringTime(e.target.value)}
                          className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                        />
                      </div>
                    </div>
                  </AutomationSettingRow>

                  <AutomationSettingRow
                    enabled
                    checked={eventTriggers}
                    onCheckedChange={setEventTriggers}
                    title="Event-Based Triggers"
                    description="Automatically send messages when specific events occur"
                    showBorderBottom
                  >
                    <div className="flex flex-col gap-2">
                      {EVENT_TRIGGER_OPTIONS.map((ev) => (
                        <EventTriggerOptionRow
                          key={ev.key}
                          emoji={ev.emoji}
                          label={ev.label}
                          checked={eventTriggerSelection[ev.key]}
                          onToggle={() =>
                            setEventTriggerSelection((p) => ({ ...p, [ev.key]: !p[ev.key] }))
                          }
                        />
                      ))}
                    </div>
                  </AutomationSettingRow>

                  <AutomationSettingRow
                    enabled
                    checked={autoFollowUp}
                    onCheckedChange={setAutoFollowUp}
                    title="Auto Follow-Up Reminders"
                    description={"Send reminder if resident doesn't respond"}
                  >
                    <div className="space-y-1">
                      <label className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                        Send reminder after
                      </label>
                      <AutomationSelect
                        value={followUpAfter}
                        onChange={setFollowUpAfter}
                        options={[...FOLLOW_UP_AFTER_OPTIONS]}
                      />
                    </div>
                  </AutomationSettingRow>

                  {activeAutomationLines.length > 0 ? (
                    <div className="flex gap-2 rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-[13px] py-3">
                      <SparkleIcon className="mt-0.5 size-4 shrink-0 text-[#1447e6]" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium leading-4 text-[#1c398e]">Active Automations</p>
                        <ul className="mt-1 space-y-1">
                          {activeAutomationLines.map((line, i) => (
                            <li key={i} className="text-[12px] leading-4 text-[#1447e6]">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!formValid}
              onClick={() => formValid && setScheduleModalOpen(true)}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors enabled:hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Schedule for Later
            </button>
            <button
              type="button"
              disabled={!formValid}
              onClick={submitSendNow}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#155dfc] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none transition-colors enabled:hover:bg-[#1249d6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send Now
            </button>
          </div>
        </footer>
      </div>

      <ScheduleBroadcastModal
        open={scheduleModalOpen}
        summary={scheduleSummary}
        onClose={() => setScheduleModalOpen(false)}
        onConfirm={() => {
          setScheduleModalOpen(false)
          onClose()
        }}
      />
    </div>
  )
}

function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      className={[
        'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
        on ? 'border-[#2b7fff]' : 'border-[#d1d5dc]',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className="size-3 rounded-full bg-[#2b7fff]" /> : null}
    </span>
  )
}

function AudienceCard({
  selected,
  onSelect,
  title,
  subtitle,
  rightIcon,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
  rightIcon: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        'flex w-full items-center justify-between gap-3 rounded-[10px] border-2 p-4 text-left transition-colors',
        selected ? 'border-[#2b7fff] bg-[#eff6ff]' : 'border-[#e5e7eb] bg-white',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <RadioDot on={selected} />
        <div>
          <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">{title}</p>
          <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
        </div>
      </div>
      <span className="shrink-0">{rightIcon}</span>
    </button>
  )
}

function AutomationSettingRow({
  enabled,
  checked,
  onCheckedChange,
  title,
  description,
  showBorderBottom = false,
  children,
}: {
  enabled: boolean
  checked: boolean
  onCheckedChange: (value: boolean) => void
  title: string
  description: string
  showBorderBottom?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={[
        'flex gap-3',
        showBorderBottom ? 'border-b border-[#e5e7eb] pb-4' : '',
      ].join(' ')}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={!enabled}
        onClick={() => enabled && onCheckedChange(!checked)}
        className={[
          'mt-1 flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-[#030213] bg-[#030213]' : 'border-black/10 bg-[#f3f3f5]',
        ].join(' ')}
      >
        {checked ? (
          <svg
            className="size-3.5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            aria-hidden
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">{title}</p>
        <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{description}</p>
        {checked && children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  )
}

function AutomationSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (next: string) => void
  options: readonly { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>
  )
}

function EventTriggerOptionRow({
  emoji,
  label,
  checked,
  onToggle,
}: {
  emoji: string
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-[10px] border border-[#e5e7eb] bg-white px-[13px] py-3 text-left outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
    >
      <span
        className={[
          'flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]',
          checked ? 'border-[#030213] bg-[#030213]' : 'border-black/10 bg-[#f3f3f5]',
        ].join(' ')}
        aria-hidden
      >
        {checked ? (
          <svg
            className="size-3.5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            aria-hidden
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className="text-[18px] leading-7" aria-hidden>
        {emoji}
      </span>
      <span className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#101828]">{label}</span>
    </button>
  )
}

function ChannelCard({
  selected,
  onToggle,
  title,
  subtitle,
}: {
  selected: boolean
  onToggle: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={[
        'flex rounded-[10px] border-2 p-4 text-left transition-colors',
        selected ? 'border-[#2b7fff] bg-[#eff6ff]' : 'border-[#e5e7eb] bg-white',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span
          className={[
            'flex size-4 shrink-0 items-center justify-center rounded border shadow-sm',
            selected ? 'border-[#030213] bg-[#030213]' : 'border-black/10 bg-[#f3f3f5]',
          ].join(' ')}
          aria-hidden
        >
          {selected ? (
            <svg className="size-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <div>
          <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">{title}</p>
          <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
        </div>
      </div>
    </button>
  )
}

function UsersGlyph() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
    </svg>
  )
}

function BuildingGlyph() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M6 22V10l6-4 6 4v12M6 22h15M9 22v-5h4v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FunnelGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
