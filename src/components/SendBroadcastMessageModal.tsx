import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import broadcastIcon from '@/assets/Broadcast.svg'
import {
  ScheduleBroadcastModal,
  type ScheduleBroadcastSelection,
  type ScheduleBroadcastSummary,
} from '@/components/ScheduleBroadcastModal'
import { SparkleIcon } from '@/components/SparkleIcon'
import { recordBroadcastSendAttempt } from '@/lib/broadcastMetrics'
import { ALL_UNIT_OPTIONS } from '@/lib/propertyUnitOptions'
import { unitOptionValueToCell } from '@/lib/residentUnitKeys'
import { supabase } from '@/lib/supabase'

type Audience = 'all' | 'building' | 'units'

const REGISTERED_PROPERTY_UNITS_SESSION_KEY =
  'proptech.admin.registeredPropertyUnitOptions.v1'

function readRegisteredPropertyUnitCountFromSession(): number {
  if (typeof sessionStorage === 'undefined') return 0
  try {
    const raw = sessionStorage.getItem(REGISTERED_PROPERTY_UNITS_SESSION_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return 0
    return parsed.filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (x as { value?: unknown }).value === 'string' &&
        typeof (x as { label?: unknown }).label === 'string',
    ).length
  } catch {
    return 0
  }
}

function readRegisteredBuildingsFromSession(): string[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(REGISTERED_PROPERTY_UNITS_SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue
      const label = (x as { label?: unknown }).label
      if (typeof label !== 'string') continue
      const parts = label.split('—')
      if (parts.length < 2) continue
      const building = parts[1]?.trim()
      if (building) out.add(building)
    }
    return [...out]
  } catch {
    return []
  }
}

function defaultBuildingOptions(): string[] {
  const out = new Set<string>()
  for (const opt of ALL_UNIT_OPTIONS) {
    const cell = unitOptionValueToCell(opt.value)
    if (cell.kind === 'assigned' && cell.building.trim()) {
      out.add(cell.building.trim())
    }
  }
  for (const b of readRegisteredBuildingsFromSession()) {
    if (b.trim()) out.add(b.trim())
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}

function readRegisteredUnitsFromSession(): string[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(REGISTERED_PROPERTY_UNITS_SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue
      const label = (x as { label?: unknown }).label
      if (typeof label !== 'string') continue
      const parts = label.split('—')
      const unit = parts[0]?.trim()
      if (unit) out.add(unit)
    }
    return [...out]
  } catch {
    return []
  }
}

function defaultUnitOptions(): string[] {
  const out = new Set<string>()
  for (const opt of ALL_UNIT_OPTIONS) {
    const cell = unitOptionValueToCell(opt.value)
    if (cell.kind === 'assigned' && cell.unit.trim()) {
      out.add(cell.unit.trim())
    }
  }
  for (const unit of readRegisteredUnitsFromSession()) {
    if (unit.trim()) out.add(unit.trim())
  }
  return [...out].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

function edgeFnUrlFromSupabaseBase(
  explicitUrl: string | undefined,
  fnName: 'send-broadcast' | 'schedule-broadcast',
): string | undefined {
  const direct = explicitUrl?.trim()
  if (direct) return direct
  const base = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}/functions/v1/${fnName}` : undefined
}

type BroadcastPayload = {
  subject: string
  message: string
  audience: Audience
  building: string
  units: string[]
  channels: Array<'email' | 'sms'>
  automation: {
    category?: string
    enabled: boolean
    autoRetryFailed: boolean
    retryMaxAttempts: number
    retryDelay: string
    recurringSchedule: boolean
    recurringFrequency: string
    recurringDays: string[]
    recurringTime: string
    autoFollowUp: boolean
    followUpAfter: string
    /** Optional rent reminder context (stored on broadcast row payload). */
    rentReminder?: { dueDate: string | null; amount: string | null }
  }
  payload?: Record<string, unknown>
}

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

function detectIntent(message: string): string {
  const text = message.toLowerCase()

  if (text.includes('rent')) return 'rent_reminder'
  if (text.includes('inspection')) return 'inspection_notice'
  if (text.includes('water') || text.includes('shut')) return 'utility_alert'
  if (text.includes('maintenance')) return 'maintenance_notice'

  return 'general'
}

function getFallback(intent: string): string {
  switch (intent) {
    case 'rent_reminder':
      return 'Reminder: Rent is due on the 1st. Please submit your payment on time to avoid late fees.'
    case 'inspection_notice':
      return 'Notice: A property inspection is scheduled. Please ensure your unit is accessible.'
    case 'utility_alert':
      return 'Alert: Temporary service interruption expected. We will restore service shortly.'
    case 'maintenance_notice':
      return 'Notice: Maintenance work will be performed. Please plan accordingly.'
    default:
      return 'Notice: Please review this update and take any necessary action.'
  }
}

function parseAmountNumber(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

export type SendBroadcastPresentation = 'modal' | 'rail'

export function SendBroadcastMessageModal({
  open,
  onClose,
  presentation = 'modal',
  onBroadcastStatsInvalidate,
}: {
  open: boolean
  onClose: () => void
  /** `rail` = full-height panel from the right; `modal` = centered dialog. */
  presentation?: SendBroadcastPresentation
  /** Called after a successful send or schedule so dashboards can refetch metrics. */
  onBroadcastStatsInvalidate?: () => void
}) {
  const titleId = useId()
  const automationSwitchId = useId()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('units')
  const [building, setBuilding] = useState('')
  const [units, setUnits] = useState('')
  const [channelEmail, setChannelEmail] = useState(true)
  const [channelSms, setChannelSms] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState(true)
  const [autoRetryFailed, setAutoRetryFailed] = useState(false)
  const [recurringSchedule, setRecurringSchedule] = useState(false)
  const [autoFollowUp, setAutoFollowUp] = useState(false)
  const [retryMaxAttempts, setRetryMaxAttempts] = useState('3')
  const [retryDelay, setRetryDelay] = useState('30m')
  const [recurringFrequency, setRecurringFrequency] = useState('weekly')
  const [recurringDays, setRecurringDays] = useState<Set<(typeof WEEKDAY_KEYS)[number]>>(
    () => new Set(),
  )
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [followUpAfter, setFollowUpAfter] = useState('24h')
  const [paymentDueDate, setPaymentDueDate] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [sendingNow, setSendingNow] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [buildingOptions, setBuildingOptions] = useState<string[]>(() =>
    defaultBuildingOptions(),
  )
  const [unitOptions, setUnitOptions] = useState<string[]>(() =>
    defaultUnitOptions(),
  )
  const [totalUnitsCount, setTotalUnitsCount] = useState(() => {
    return ALL_UNIT_OPTIONS.length + readRegisteredPropertyUnitCountFromSession()
  })
  const closeAfterSuccessTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setTotalUnitsCount(
      ALL_UNIT_OPTIONS.length + readRegisteredPropertyUnitCountFromSession(),
    )
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const local = defaultBuildingOptions()
    const localUnits = defaultUnitOptions()
    setBuildingOptions(local)
    setUnitOptions(localUnits)
    if (!supabase) return

    void (async () => {
      const { data, error } = await supabase.from('users').select('building, unit')
      if (cancelled || error) return
      const merged = new Set<string>(local)
      const mergedUnits = new Set<string>(localUnits)
      for (const row of data ?? []) {
        const buildingName =
          row && typeof row === 'object' && 'building' in row
            ? String((row as { building?: unknown }).building ?? '').trim()
            : ''
        const unitName =
          row && typeof row === 'object' && 'unit' in row
            ? String((row as { unit?: unknown }).unit ?? '').trim()
            : ''
        if (buildingName) merged.add(buildingName)
        if (unitName) mergedUnits.add(unitName)
      }
      if (!cancelled) {
        setBuildingOptions(
          [...merged].sort((a, b) => a.localeCompare(b)),
        )
        setUnitOptions(
          [...mergedUnits].sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: 'base',
            }),
          ),
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

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

  useEffect(() => {
    if (open) return
    if (closeAfterSuccessTimeoutRef.current != null) {
      window.clearTimeout(closeAfterSuccessTimeoutRef.current)
      closeAfterSuccessTimeoutRef.current = null
    }
    setSubject('')
    setMessage('')
    setAudience('units')
    setBuilding('')
    setUnits('')
    setChannelEmail(true)
    setChannelSms(false)
    setAutomationEnabled(true)
    setAutoRetryFailed(false)
    setRecurringSchedule(false)
    setAutoFollowUp(false)
    setRetryMaxAttempts('3')
    setRetryDelay('30m')
    setRecurringFrequency('weekly')
    setRecurringDays(new Set())
    setRecurringTime('09:00')
    setFollowUpAfter('24h')
    setPaymentDueDate('')
    setPaymentAmount('')
    setScheduleModalOpen(false)
    setEnhancing(false)
    setSendingNow(false)
    setScheduling(false)
    setSubmitError(null)
    setSuccessMessage(null)
  }, [open])

  useEffect(() => {
    return () => {
      if (closeAfterSuccessTimeoutRef.current != null) {
        window.clearTimeout(closeAfterSuccessTimeoutRef.current)
      }
    }
  }, [])

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
    if (autoFollowUp) {
      const after =
        FOLLOW_UP_AFTER_OPTIONS.find((o) => o.value === followUpAfter)?.label.toLowerCase() ??
        followUpAfter
      lines.push(`• Follow-up reminder after ${after}`)
    }
    const rentDue = paymentDueDate.trim()
    const rentAmt = paymentAmount.trim()
    if (rentDue || rentAmt) {
      const parts: string[] = []
      if (rentAmt) parts.push(`amount ${rentAmt}`)
      if (rentDue) parts.push(`due ${rentDue}`)
      lines.push(`• Rent reminder: ${parts.join(' · ')}`)
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
    autoFollowUp,
    followUpAfter,
    paymentDueDate,
    paymentAmount,
  ])

  const validationErrors = useMemo(() => {
    const out: string[] = []
    if (!subject.trim()) out.push('Subject is required.')
    if (!message.trim()) out.push('Message content is required.')
    if (!audience) out.push('Please select an audience.')
    if (audience === 'building' && !building.trim()) {
      out.push('Please select a building.')
    }
    if (audience === 'units' && !units.trim()) {
      out.push('Please select a unit.')
    }
    if (!channelEmail && !channelSms) {
      out.push('Select at least one delivery channel (Email or SMS).')
    }
    return out
  }, [subject, message, audience, building, units, channelEmail, channelSms])

  const formValid = validationErrors.length === 0
  const isRail = presentation === 'rail'

  if (!open) return null

  function buildPayload(): BroadcastPayload {
    const rentDue = paymentDueDate.trim()
    const rentAmt = paymentAmount.trim()
    const rentAmountNumber = parseAmountNumber(rentAmt)
    const inferredCategory = rentDue || rentAmt ? 'billing' : detectIntent(message.trim())
    const rentReminder =
      rentDue || rentAmt ? { dueDate: rentDue || null, amount: rentAmt || null } : undefined
    return {
      subject: subject.trim(),
      message: message.trim(),
      audience,
      building: building.trim(),
      units:
        audience === 'units'
          ? units
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : [],
      channels: [
        ...(channelEmail ? (['email'] as const) : []),
        ...(channelSms ? (['sms'] as const) : []),
      ],
      automation: {
        category: inferredCategory,
        enabled: automationEnabled,
        autoRetryFailed,
        retryMaxAttempts: Number(retryMaxAttempts),
        retryDelay,
        recurringSchedule,
        recurringFrequency,
        recurringDays: [...recurringDays],
        recurringTime,
        autoFollowUp,
        followUpAfter,
        ...(rentReminder ? { rentReminder } : {}),
      },
      payload:
        rentDue || rentAmt
          ? {
              automation: {
                category: 'billing',
                source: 'send_broadcast_modal',
              },
              amount_due: rentAmountNumber,
              due_date: rentDue || null,
            }
          : undefined,
    }
  }

  async function postBroadcast(
    urlValue: string | undefined,
    body: Record<string, unknown>,
  ): Promise<void> {
    const url = urlValue?.trim()
    if (!url) {
      throw new Error(
        'Broadcast service is not configured. Please try again later.',
      )
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let detail = ''
      try {
        const data = (await res.json()) as { error?: unknown; message?: unknown }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : typeof data.message === 'string'
              ? data.message
              : ''
        detail = msg.trim()
      } catch {
        // ignore parse errors; fallback to status text only
      }
      throw new Error(detail ? `${detail} (${res.status})` : `Request failed (${res.status})`)
    }
  }

  async function submitSendNow() {
    if (!formValid || sendingNow || scheduling) return
    const confirmed = window.confirm(
      'Send this broadcast now? This will immediately start delivery to the selected audience.',
    )
    if (!confirmed) return
    setSubmitError(null)
    setSuccessMessage(null)
    setSendingNow(true)
    const payload = buildPayload()
    try {
      const sendUrl = edgeFnUrlFromSupabaseBase(
        import.meta.env.VITE_BROADCAST_SEND_URL,
        'send-broadcast',
      )
      await postBroadcast(sendUrl, {
        action: 'send_now',
        ...payload,
      })
      recordBroadcastSendAttempt(payload.channels, true)
      onBroadcastStatsInvalidate?.()
      setSuccessMessage('Broadcast sent successfully. Delivery has started.')
      closeAfterSuccessTimeoutRef.current = window.setTimeout(() => {
        onClose()
      }, 1500)
    } catch (error) {
      recordBroadcastSendAttempt(payload.channels, false)
      const msg =
        error instanceof Error ? error.message : 'Failed to send broadcast. Please try again.'
      setSubmitError(
        msg.toLowerCase().includes('failed to fetch')
          ? 'Failed to reach broadcast service. Confirm send-broadcast is deployed and CORS is enabled.'
          : msg,
      )
    } finally {
      setSendingNow(false)
    }
  }

  async function submitSchedule(selection: ScheduleBroadcastSelection) {
    if (!formValid || sendingNow || scheduling) return
    setSubmitError(null)
    setScheduling(true)
    try {
      const payload = buildPayload()
      const scheduleUrl = edgeFnUrlFromSupabaseBase(
        import.meta.env.VITE_BROADCAST_SCHEDULE_URL,
        'schedule-broadcast',
      )
      await postBroadcast(scheduleUrl, {
        action: 'schedule',
        scheduled_for: selection.scheduledAtIso,
        // Backward compatibility: deployed edge function may still read nested schedule.scheduledAtIso.
        schedule: {
          scheduledAtIso: selection.scheduledAtIso,
          date: selection.date,
          time: selection.time,
        },
        ...payload,
      })
      onBroadcastStatsInvalidate?.()
      setScheduleModalOpen(false)
      onClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not schedule broadcast.')
    } finally {
      setScheduling(false)
    }
  }

  const handleAiEnhanceMessage = async () => {
    const aiUrl =
      import.meta.env.VITE_BROADCAST_AI_ENHANCE_URL?.trim() ||
      edgeFnUrlFromSupabaseBase(undefined, 'send-broadcast')?.replace(
        /\/send-broadcast$/,
        '/ai-enhance',
      ) ||
      ''
    if (enhancing || !message.trim()) return
    setSubmitError(null)
    setEnhancing(true)
    try {
      const intent = detectIntent(message)
      if (aiUrl) {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
        const authSession = supabase ? await supabase.auth.getSession() : null
        const accessToken = authSession?.data.session?.access_token?.trim() ?? ''
        const authToken = accessToken || anonKey
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (anonKey) headers.apikey = anonKey
        if (authToken) headers.Authorization = `Bearer ${authToken}`
        const res = await fetch(aiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: message.trim(),
          }),
        })
        const data = (await res.json()) as { message?: string; error?: string }
        if (!res.ok) {
          const detail = (data?.error ?? '').trim()
          if (
            res.status === 401 &&
            detail.toLowerCase().includes('incorrect api key')
          ) {
            throw new Error(
              'AI Enhance is unavailable: OPENAI_API_KEY is invalid on the ai-enhance Edge function.',
            )
          }
          throw new Error(detail || `AI enhance failed (${res.status})`)
        }
        const nextMessage = data?.message?.trim()
        if (nextMessage) {
          setMessage(nextMessage)
        } else {
          setMessage(getFallback(intent))
          setSubmitError('AI returned an empty response, using fallback template.')
        }
      } else {
        setMessage(getFallback(intent))
        setSubmitError('AI URL is not configured, using fallback template.')
      }
    } catch (error) {
      setMessage(getFallback(detectIntent(message)))
      const msg =
        error instanceof Error ? error.message : "Couldn’t enhance message — using default template."
      setSubmitError(`${msg} (using default template)`)
    } finally {
      setEnhancing(false)
    }
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
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]'
            : 'relative flex max-h-[min(90dvh,1040px)] w-full max-w-[753px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg'
        }
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-secondary px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
              <img
                src={broadcastIcon}
                alt=""
                className="size-5 object-contain"
              />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                Send Broadcast Message
              </h2>
              <p className="text-[12px] leading-4 text-neutral">
                Compose and send notifications to residents
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-neutral outline-none transition-colors hover:bg-black/5 hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
          <div className="flex flex-col gap-6">
            <section className="space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                  Message Details
                </h3>
              </div>
              <div>
                <label
                  htmlFor="broadcast-subject"
                  className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant"
                >
                  Subject Line <span className="text-error">*</span>
                </label>
                <input
                  id="broadcast-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Building Maintenance Notice"
                  className="h-9 w-full rounded-lg border border-transparent bg-secondary px-3 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none placeholder:text-neutral transition-[border-color,box-shadow] focus:border-primary/45 focus:bg-white focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label
                  htmlFor="broadcast-message"
                  className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant"
                >
                  Message Content <span className="text-error">*</span>
                </label>
                <textarea
                  id="broadcast-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message here..."
                  rows={5}
                  className="min-h-[150px] w-full resize-y rounded-[10px] border border-secondary px-3 py-2 text-[16px] leading-6 tracking-[-0.3125px] text-extended-3 outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-primary/45 focus:ring-2 focus:ring-primary/30"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] leading-4 text-neutral">
                    {message.length} characters
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleAiEnhanceMessage()}
                    disabled={enhancing || !message.trim()}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-primary outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <SparkleIcon className="size-4 text-primary" />
                    {enhancing ? 'Enhancing…' : 'AI Enhance Message'}
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-[10px] border border-secondary bg-white p-4">
              <div className="space-y-1">
                <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                  (Optional) Rent or Billing Details
                </h3>
                <p className="text-[12px] leading-4 text-neutral">
                  Only set these fields when this broadcast is a rent or billing-related message.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor="broadcast-payment-amount"
                    className="block text-[12px] font-medium leading-4 text-neutral-variant"
                  >
                    Rent or bill Amount (if applicable)
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] tracking-[-0.3125px] text-neutral">
                      $
                    </span>
                    <input
                      id="broadcast-payment-amount"
                      type="text"
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      className="h-[42px] w-full min-w-0 rounded-[10px] border border-secondary bg-white pl-7 pr-3 text-[16px] tracking-[-0.3125px] text-extended-3 outline-none placeholder:text-neutral transition-[border-color,box-shadow] focus:border-primary/45 focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor="broadcast-payment-due-date"
                    className="block text-[12px] font-medium leading-4 text-neutral-variant"
                  >
                    Due Date
                  </label>
                  <input
                    id="broadcast-payment-due-date"
                    type="date"
                    value={paymentDueDate}
                    onChange={(e) => setPaymentDueDate(e.target.value)}
                    className="h-[42px] w-full min-w-0 rounded-[10px] border border-secondary bg-white px-3 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none transition-[border-color,box-shadow] focus:border-primary/45 focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            </section>

            <div>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
              Who should receive this? <span className="text-error">*</span>
              </p>
              <div className="flex flex-col gap-3" role="radiogroup" aria-label="Audience">
                <AudienceCard
                  selected={audience === 'all'}
                  onSelect={() => setAudience('all')}
                  title="All Residents"
                  subtitle={`Send to all ${totalUnitsCount} units`}
                  rightIcon={<UsersGlyph />}
                />
                <div
                  className={[
                    'rounded-[10px] border-2 p-4 transition-colors',
                    audience === 'building'
                      ? 'border-extended-1 bg-white'
                      : 'border-secondary bg-white',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={audience === 'building'}
                    onClick={() => setAudience('building')}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <RadioDot on={audience === 'building'} />
                      <div>
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                          Specific Building
                        </p>
                        <p className="text-[12px] leading-4 text-neutral">Enter one building name</p>
                      </div>
                    </div>
                    <BuildingGlyph />
                  </button>
                  {audience === 'building' ? (
                    <div className="relative ml-11 mt-3 w-[calc(100%-2.75rem)]">
                      <select
                        value={building}
                        onChange={(e) => setBuilding(e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-secondary px-3 pr-9 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none placeholder:text-neutral transition-[border-color,box-shadow] focus:border-primary/45 focus:bg-white focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">Select building</option>
                        {buildingOptions.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral">
                        <svg
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  ) : null}
                </div>
                <div
                  className={[
                    'rounded-[10px] border-2 p-4 transition-colors',
                    audience === 'units'
                      ? 'border-extended-1 bg-white'
                      : 'border-secondary bg-white',
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
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                          Specific Units
                        </p>
                        <p className="text-[12px] leading-4 text-neutral">
                          Select units from User Management
                        </p>
                      </div>
                    </div>
                    <FunnelGlyph className="size-5 shrink-0 text-neutral" />
                  </button>
                  {audience === 'units' ? (
                    <div className="relative ml-11 mt-3 w-[calc(100%-2.75rem)]">
                      <select
                        value={units}
                        onChange={(e) => setUnits(e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-secondary px-3 pr-9 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none focus:border-primary/45 focus:bg-white focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">Select unit</option>
                        {unitOptions.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral">
                        <svg
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
              Choose how to send <span className="text-error">*</span>
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

            <div className="flex flex-col gap-4 border-t border-secondary pt-6">
              <div className="flex flex-col gap-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                <div>
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                    🤖 Automation Settings
                  </p>
                  <p className="mt-1 text-[12px] leading-4 text-neutral">
                    Configure automatic retries, scheduling, and triggers
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start min-[480px]:self-auto">
                  <label
                    htmlFor={automationSwitchId}
                    className="cursor-pointer text-[12px] leading-4 text-neutral-variant"
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
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                      automationEnabled ? 'bg-extended-1' : 'bg-secondary',
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
                <div className="flex flex-col gap-4 rounded-[10px] bg-secondary px-4 py-4">
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
                        <label className="block text-[12px] font-medium leading-4 text-neutral-variant">
                          Max Attempts
                        </label>
                        <AutomationSelect
                          value={retryMaxAttempts}
                          onChange={setRetryMaxAttempts}
                          options={[...RETRY_ATTEMPT_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[12px] font-medium leading-4 text-neutral-variant">
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
                        <label className="block text-[12px] font-medium leading-4 text-neutral-variant">
                          Frequency
                        </label>
                        <AutomationSelect
                          value={recurringFrequency}
                          onChange={setRecurringFrequency}
                          options={[...RECURRING_FREQUENCY_OPTIONS]}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-[12px] font-medium leading-4 text-neutral-variant">Select Days</p>
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
                                'rounded-lg border px-3 py-1.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                                recurringDays.has(key)
                                  ? 'border-extended-1 bg-extended-1 text-white'
                                  : 'border-secondary bg-white text-neutral-variant hover:bg-secondary',
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
                          className="block text-[12px] font-medium leading-4 text-neutral-variant"
                        >
                          Time
                        </label>
                        <input
                          id="broadcast-recurring-time"
                          type="time"
                          value={recurringTime}
                          onChange={(e) => setRecurringTime(e.target.value)}
                          className="h-9 w-full rounded-lg border border-transparent bg-secondary px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none focus:border-primary/45 focus:bg-white focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
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
                      <label className="block text-[12px] font-medium leading-4 text-neutral-variant">
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
                    <div className="flex gap-2 rounded-[10px] border border-extended-1 bg-extended-2 px-[13px] py-3">
                      <SparkleIcon className="mt-0.5 size-4 shrink-0 text-extended-1" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium leading-4 text-extended-3">Active Automations</p>
                        <ul className="mt-1 space-y-1">
                          {activeAutomationLines.map((line, i) => (
                            <li key={i} className="text-[12px] leading-4 text-extended-1">
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
            {validationErrors.length > 0 ? (
              <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2">
                <p className="text-[13px] font-medium leading-5 text-[#92400e]">
                  Complete these fields before sending:
                </p>
                <ul className="mt-1 list-disc pl-5 text-[13px] leading-5 text-[#92400e]">
                  {validationErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {submitError ? (
              <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] leading-5 text-[#b91c1c]">
                {submitError}
              </p>
            ) : null}
            {successMessage ? (
              <p className="rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[13px] leading-5 text-[#166534]">
                {successMessage} ✅
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-secondary bg-secondary px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!formValid || sendingNow || scheduling}
              onClick={() => formValid && setScheduleModalOpen(true)}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none transition-colors enabled:hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scheduling ? 'Scheduling…' : 'Schedule send'}
            </button>
            <button
              type="button"
              disabled={!formValid || sendingNow || scheduling}
              onClick={() => void submitSendNow()}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-extended-1 px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none transition-colors enabled:hover:bg-extended-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendingNow ? 'Sending...' : 'Send Now'}
            </button>
          </div>
        </footer>
      </div>

      <ScheduleBroadcastModal
        open={scheduleModalOpen}
        summary={scheduleSummary}
        onClose={() => setScheduleModalOpen(false)}
        onConfirm={(selection) => void submitSchedule(selection)}
        confirmBusy={scheduling}
        confirmError={submitError}
      />
    </div>
  )
}

function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      className={[
        'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
        on ? 'border-extended-1' : 'border-secondary',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className="size-3 rounded-full bg-extended-1" /> : null}
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
        selected ? 'border-extended-1 bg-white' : 'border-secondary bg-white',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <RadioDot on={selected} />
        <div>
          <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">{title}</p>
          <p className="text-[12px] leading-4 text-neutral">{subtitle}</p>
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
        showBorderBottom ? 'border-b border-secondary pb-4' : '',
      ].join(' ')}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={!enabled}
        onClick={() => enabled && onCheckedChange(!checked)}
        className={[
          'mt-1 flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-extended-3 bg-extended-3' : 'border-black/10 bg-secondary',
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
        <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">{title}</p>
        <p className="mt-1 text-[12px] leading-4 text-neutral">{description}</p>
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
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-secondary py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none focus:border-primary/45 focus:bg-white focus:ring-2 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>
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
        selected ? 'border-extended-1 bg-white' : 'border-secondary bg-white',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span
          className={[
            'flex size-4 shrink-0 items-center justify-center rounded border shadow-sm',
            selected ? 'border-extended-3 bg-extended-3' : 'border-black/10 bg-secondary',
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
          <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">{title}</p>
          <p className="text-[12px] leading-4 text-neutral">{subtitle}</p>
        </div>
      </div>
    </button>
  )
}

function UsersGlyph() {
  return (
    <svg className="size-5 text-neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
    </svg>
  )
}

function BuildingGlyph() {
  return (
    <svg className="size-5 text-neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
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
