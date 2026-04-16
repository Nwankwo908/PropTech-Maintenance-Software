import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import inspectionIcon from '@/assets/Inspection_3.svg'
import { SparkleIcon } from '@/components/SparkleIcon'

const INSPECTION_TYPES = [
  { id: 'annual' as const, emoji: '📋', title: 'Annual Inspection', subtitle: 'Yearly property review' },
  { id: 'unit' as const, emoji: '🏠', title: 'Unit Inspection', subtitle: 'Individual unit check' },
  { id: 'safety' as const, emoji: '🚨', title: 'Safety Inspection', subtitle: 'Fire/safety compliance' },
  { id: 'maintenance' as const, emoji: '🔧', title: 'Maintenance Check', subtitle: 'Routine maintenance' },
]

const ADVANCE_OPTIONS = [
  { id: '24h' as const, title: '24 Hours', subtitle: 'Emergency only' },
  { id: '48h' as const, title: '48 Hours', subtitle: 'Standard minimum' },
  { id: '1w' as const, title: '1 Week', subtitle: 'Recommended' },
  { id: '2w' as const, title: '2 Weeks', subtitle: 'Preferred' },
]

const TIME_WINDOW_OPTIONS = [
  { value: '', label: 'Select time...' },
  { value: 'morning', label: '9:00 AM – 12:00 PM' },
  { value: 'afternoon', label: '12:00 PM – 5:00 PM' },
  { value: 'fullday', label: 'Full day (9 AM – 5 PM)' },
]

type InspectionTypeId = (typeof INSPECTION_TYPES)[number]['id']
type UnitScope = 'all' | 'building' | 'units'
type AdvanceId = (typeof ADVANCE_OPTIONS)[number]['id']

const INSPECTION_RETRY_ATTEMPT_OPTIONS = [
  { value: '2', label: '2 attempts' },
  { value: '3', label: '3 attempts' },
  { value: '5', label: '5 attempts' },
] as const

const INSPECTION_RETRY_DELAY_OPTIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '2h', label: '2 hours' },
] as const

const INSPECTION_RECURRING_FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
] as const

const INSPECTION_EVENT_TRIGGER_OPTIONS = [
  { key: 'annual' as const, emoji: '📅', label: 'Annual Inspection Due' },
  { key: 'leaseEnd' as const, emoji: '📦', label: 'Lease Ending (Move-Out)' },
  { key: 'moveIn' as const, emoji: '🔑', label: 'New Move-In (Initial Check)' },
  { key: 'preventive' as const, emoji: '🔧', label: 'Preventive Maintenance Schedule' },
]

const INSPECTION_FOLLOW_UP_OPTIONS = [
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
  { value: '72h', label: '72 hours' },
] as const

function inspectionRetryDelayShort(value: string): string {
  const map: Record<string, string> = { '15m': '15 min', '30m': '30 min', '1h': '1 hr', '2h': '2 hr' }
  return map[value] ?? value
}

export function SendInspectionNoticeModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const titleId = useId()
  const inspectionAutomationSwitchId = useId()
  const [inspectionType, setInspectionType] = useState<InspectionTypeId>('annual')
  const [inspectionDate, setInspectionDate] = useState('')
  const [timeWindow, setTimeWindow] = useState('')
  const [advanceNotice, setAdvanceNotice] = useState<AdvanceId>('48h')
  const [unitScope, setUnitScope] = useState<UnitScope>('all')
  const [specificUnits, setSpecificUnits] = useState('')
  const [additionalMessage, setAdditionalMessage] = useState('')
  const [deliveryEmail, setDeliveryEmail] = useState(true)
  const [deliverySms, setDeliverySms] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState(true)
  const [autoRetryFailed, setAutoRetryFailed] = useState(false)
  const [recurringSchedule, setRecurringSchedule] = useState(false)
  const [eventTriggers, setEventTriggers] = useState(false)
  const [autoFollowUp, setAutoFollowUp] = useState(false)
  const [retryMaxAttempts, setRetryMaxAttempts] = useState('3')
  const [retryDelay, setRetryDelay] = useState('30m')
  const [recurringFrequency, setRecurringFrequency] = useState('weekly')
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [eventTriggerSelection, setEventTriggerSelection] = useState<
    Record<(typeof INSPECTION_EVENT_TRIGGER_OPTIONS)[number]['key'], boolean>
  >({
    annual: false,
    leaseEnd: false,
    moveIn: false,
    preventive: false,
  })
  const [followUpAfter, setFollowUpAfter] = useState('24h')

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setInspectionType('annual')
      setInspectionDate('')
      setTimeWindow('')
      setAdvanceNotice('48h')
      setUnitScope('all')
      setSpecificUnits('')
      setAdditionalMessage('')
      setDeliveryEmail(true)
      setDeliverySms(false)
      setAutomationEnabled(true)
      setAutoRetryFailed(false)
      setRecurringSchedule(false)
      setEventTriggers(false)
      setAutoFollowUp(false)
      setRetryMaxAttempts('3')
      setRetryDelay('30m')
      setRecurringFrequency('weekly')
      setRecurringTime('09:00')
      setEventTriggerSelection({
        annual: false,
        leaseEnd: false,
        moveIn: false,
        preventive: false,
      })
      setFollowUpAfter('24h')
    }
  }

  const activeInspectionAutomationLines = useMemo(() => {
    const lines: string[] = []
    if (autoRetryFailed) {
      lines.push(
        `• Auto-retry up to ${retryMaxAttempts}x with ${inspectionRetryDelayShort(retryDelay)} delay`,
      )
    }
    if (recurringSchedule) {
      const freq =
        INSPECTION_RECURRING_FREQUENCY_OPTIONS.find((o) => o.value === recurringFrequency)?.label ??
        recurringFrequency
      lines.push(`• Recurring ${freq.toLowerCase()} at ${recurringTime}`)
    }
    if (eventTriggers) {
      const names = INSPECTION_EVENT_TRIGGER_OPTIONS.filter((e) => eventTriggerSelection[e.key]).map(
        (e) => e.label,
      )
      if (names.length > 0) {
        lines.push(`• Event triggers: ${names.join('; ')}`)
      } else {
        lines.push('• Event-based inspection triggers (select events above)')
      }
    }
    if (autoFollowUp) {
      const after =
        INSPECTION_FOLLOW_UP_OPTIONS.find((o) => o.value === followUpAfter)?.label.toLowerCase() ??
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
    recurringTime,
    eventTriggers,
    eventTriggerSelection,
    autoFollowUp,
    followUpAfter,
  ])

  if (!open) return null

  const unitsOk = unitScope !== 'units' || specificUnits.trim().length > 0
  const formValid =
    Boolean(inspectionDate) &&
    Boolean(timeWindow) &&
    unitsOk &&
    (deliveryEmail || deliverySms)

  function handleSendNotice() {
    if (!formValid) return
    onClose()
  }

  function handleSaveDraft() {
    if (!formValid) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
        className="relative flex max-h-[min(90dvh,1240px)] w-full max-w-[881px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3e8ff]">
              <img src={inspectionIcon} alt="" className="size-5 object-contain" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Send Inspection Notice
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Schedule and notify residents of property inspections
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
          <div className="flex flex-col gap-6">
            <section>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Inspection Type <span className="text-[#c10007]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {INSPECTION_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setInspectionType(t.id)}
                    className={[
                      'flex w-full rounded-[10px] border-2 p-4 text-left transition-colors',
                      inspectionType === t.id
                        ? 'border-[#ad46ff] bg-[#faf5ff]'
                        : 'border-[#e5e7eb] bg-white',
                    ].join(' ')}
                  >
                    <div className="flex gap-3">
                      <PurpleRadio on={inspectionType === t.id} large />
                      <div>
                        <p className="flex items-center gap-2 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                          <span className="text-[18px] leading-7" aria-hidden>
                            {t.emoji}
                          </span>
                          {t.title}
                        </p>
                        <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{t.subtitle}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="inspection-date"
                  className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                >
                  Inspection Date <span className="text-[#c10007]">*</span>
                </label>
                <input
                  id="inspection-date"
                  type="date"
                  value={inspectionDate}
                  onChange={(e) => setInspectionDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                />
              </div>
              <div>
                <label
                  htmlFor="inspection-time-window"
                  className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                >
                  Time Window <span className="text-[#c10007]">*</span>
                </label>
                <div className="relative">
                  <select
                    id="inspection-time-window"
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                  >
                    {TIME_WINDOW_OPTIONS.map((o) => (
                      <option key={o.value || 'placeholder'} value={o.value}>
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
              </div>
            </section>

            <section>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Advance Notice Period <span className="text-[#c10007]">*</span>{' '}
                <span className="text-[12px] font-normal leading-4 text-[#9810fa]">
                  (Legal Requirement)
                </span>
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ADVANCE_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setAdvanceNotice(o.id)}
                    className={[
                      'rounded-[10px] border-2 p-3.5 text-left transition-colors',
                      advanceNotice === o.id
                        ? 'border-[#ad46ff] bg-[#faf5ff]'
                        : 'border-[#e5e7eb] bg-white',
                    ].join(' ')}
                  >
                    <div className="flex gap-3">
                      <PurpleRadio on={advanceNotice === o.id} large={false} />
                      <div>
                        <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">{o.title}</p>
                        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{o.subtitle}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Select Units <span className="text-[#c10007]">*</span>
              </p>
              <div className="flex flex-col gap-3">
                <InspectionUnitCard
                  selected={unitScope === 'all'}
                  onSelect={() => setUnitScope('all')}
                  title="All Units"
                  subtitle="Property-wide inspection (142 units)"
                  rightIcon={<HomeGlyph />}
                />
                <InspectionUnitCard
                  selected={unitScope === 'building'}
                  onSelect={() => setUnitScope('building')}
                  title="Specific Building"
                  subtitle="Select one building"
                  rightIcon={<HomeGlyph />}
                />
                <div
                  className={[
                    'rounded-[10px] border-2 p-4 transition-colors',
                    unitScope === 'units'
                      ? 'border-[#ad46ff] bg-[#faf5ff]'
                      : 'border-[#e5e7eb] bg-white',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => setUnitScope('units')}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <PurpleRadio on={unitScope === 'units'} large />
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
                  {unitScope === 'units' ? (
                    <input
                      type="text"
                      value={specificUnits}
                      onChange={(e) => setSpecificUnits(e.target.value)}
                      placeholder="e.g., 2A, 3B, 5C (comma-separated)"
                      className="ml-11 mt-3 h-9 w-[calc(100%-2.75rem)] rounded-lg border border-transparent bg-white px-3 text-[14px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <label
                htmlFor="inspection-additional"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Additional Message (Optional)
              </label>
              <textarea
                id="inspection-additional"
                value={additionalMessage}
                onChange={(e) => setAdditionalMessage(e.target.value)}
                placeholder="Add any additional instructions or information for residents..."
                rows={4}
                className="w-full resize-y rounded-[10px] border border-[#d1d5dc] px-3 py-2 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
              />
              <p className="mt-2 text-[12px] leading-4 text-[#6a7282]">
                Legal notice language will be automatically included
              </p>
            </section>

            <section>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Delivery Method <span className="text-[#c10007]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DeliveryToggleCard
                  selected={deliveryEmail}
                  onToggle={() => setDeliveryEmail((v) => !v)}
                  title="📧 Email"
                  subtitle="Official written notice"
                />
                <DeliveryToggleCard
                  selected={deliverySms}
                  onToggle={() => setDeliverySms((v) => !v)}
                  title="💬 SMS"
                  subtitle="Quick reminder"
                />
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-[#e5e7eb] pt-6">
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
                    htmlFor={inspectionAutomationSwitchId}
                    className="cursor-pointer text-[12px] leading-4 text-[#4a5565]"
                  >
                    Enable Automation
                  </label>
                  <button
                    id={inspectionAutomationSwitchId}
                    type="button"
                    role="switch"
                    aria-checked={automationEnabled}
                    onClick={() => setAutomationEnabled((v) => !v)}
                    className={[
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                      automationEnabled ? 'bg-[#9810fa]' : 'bg-[#d1d5dc]',
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
                  <InspectionAutomationRow
                    checked={autoRetryFailed}
                    onCheckedChange={setAutoRetryFailed}
                    title="Auto-Retry Failed Deliveries"
                    description="Automatically retry sending notices that fail to deliver"
                    showBorderBottom
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <span className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Max Attempts
                        </span>
                        <InspectionAutomationSelect
                          value={retryMaxAttempts}
                          onChange={setRetryMaxAttempts}
                          options={[...INSPECTION_RETRY_ATTEMPT_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Retry Delay
                        </span>
                        <InspectionAutomationSelect
                          value={retryDelay}
                          onChange={setRetryDelay}
                          options={[...INSPECTION_RETRY_DELAY_OPTIONS]}
                        />
                      </div>
                    </div>
                  </InspectionAutomationRow>

                  <InspectionAutomationRow
                    checked={recurringSchedule}
                    onCheckedChange={setRecurringSchedule}
                    title="Recurring Schedule"
                    description="Set up automatic recurring inspections"
                    showBorderBottom
                  >
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1">
                        <span className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                          Frequency
                        </span>
                        <InspectionAutomationSelect
                          value={recurringFrequency}
                          onChange={setRecurringFrequency}
                          options={[...INSPECTION_RECURRING_FREQUENCY_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="inspection-recurring-time"
                          className="block text-[12px] font-medium leading-4 text-[#4a5565]"
                        >
                          Time
                        </label>
                        <input
                          id="inspection-recurring-time"
                          type="time"
                          value={recurringTime}
                          onChange={(e) => setRecurringTime(e.target.value)}
                          className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                        />
                      </div>
                    </div>
                  </InspectionAutomationRow>

                  <InspectionAutomationRow
                    checked={eventTriggers}
                    onCheckedChange={setEventTriggers}
                    title="Event-Based Triggers"
                    description="Automatically schedule inspections based on property events"
                    showBorderBottom
                  >
                    <div className="flex flex-col gap-2">
                      {INSPECTION_EVENT_TRIGGER_OPTIONS.map((ev) => (
                        <InspectionEventTriggerRow
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
                  </InspectionAutomationRow>

                  <InspectionAutomationRow
                    checked={autoFollowUp}
                    onCheckedChange={setAutoFollowUp}
                    title="Auto Follow-Up Reminders"
                    description={"Send reminder if resident doesn't acknowledge notice"}
                  >
                    <div className="space-y-1">
                      <span className="block text-[12px] font-medium leading-4 text-[#4a5565]">
                        Send reminder after
                      </span>
                      <InspectionAutomationSelect
                        value={followUpAfter}
                        onChange={setFollowUpAfter}
                        options={[...INSPECTION_FOLLOW_UP_OPTIONS]}
                      />
                    </div>
                  </InspectionAutomationRow>

                  {activeInspectionAutomationLines.length > 0 ? (
                    <div className="flex gap-2 rounded-[10px] border border-[#e9d4ff] bg-[#faf5ff] px-[13px] py-3">
                      <SparkleIcon className="mt-0.5 size-4 shrink-0 text-[#8200db]" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium leading-4 text-[#59168b]">
                          Active Automations
                        </p>
                        <ul className="mt-1 space-y-1">
                          {activeInspectionAutomationLines.map((line, i) => (
                            <li key={i} className="text-[12px] leading-4 text-[#8200db]">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
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
              onClick={handleSaveDraft}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors enabled:hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="size-4 shrink-0 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
              Save as Draft
            </button>
            <button
              type="button"
              disabled={!formValid}
              onClick={handleSendNotice}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#9810fa] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none transition-colors enabled:hover:bg-[#8200db] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send Notice
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function PurpleRadio({ on, large }: { on: boolean; large: boolean }) {
  const outer = large ? 'size-5' : 'size-4'
  const inner = large ? 'size-3' : 'size-2'
  return (
    <span
      className={[
        'flex shrink-0 items-center justify-center rounded-full border-2',
        outer,
        on ? 'border-[#ad46ff]' : 'border-[#d1d5dc]',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className={`rounded-full bg-[#ad46ff] ${inner}`} /> : null}
    </span>
  )
}

function InspectionUnitCard({
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
      onClick={onSelect}
      className={[
        'flex w-full items-center justify-between gap-3 rounded-[10px] border-2 p-4 text-left transition-colors',
        selected ? 'border-[#ad46ff] bg-[#faf5ff]' : 'border-[#e5e7eb] bg-white',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <PurpleRadio on={selected} large />
        <div>
          <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">{title}</p>
          <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
        </div>
      </div>
      <span className="shrink-0">{rightIcon}</span>
    </button>
  )
}

function DeliveryToggleCard({
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
        'rounded-[10px] border-2 p-4 text-left transition-colors',
        selected ? 'border-[#ad46ff] bg-[#faf5ff]' : 'border-[#e5e7eb] bg-white',
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

function HomeGlyph() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M3 9l9-7 9 7v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9zM9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function InspectionAutomationRow({
  checked,
  onCheckedChange,
  title,
  description,
  showBorderBottom = false,
  children,
}: {
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
        onClick={() => onCheckedChange(!checked)}
        className={[
          'mt-1 flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
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

function InspectionAutomationSelect({
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

function InspectionEventTriggerRow({
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
      <span className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#101828]">
        {label}
      </span>
    </button>
  )
}

function FunnelGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
