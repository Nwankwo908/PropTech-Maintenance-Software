import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  approveMaintenanceInvoice,
  fetchPendingMaintenanceInvoices,
  fetchRecognizedMaintenanceSpend,
  type PendingMaintenanceInvoice,
  type RecognizedMaintenanceSpend,
} from '@/api/maintenanceInvoice'
import { getActiveLandlordId, isDemoAccountActive } from '@/lib/activeLandlord'
import {
  fetchPmCompliance,
  formatPmDueLabel,
  formatPmTaskSubtitle,
  pmTaskKindUsesApplianceIcon,
  pmTaskKindUsesInspectionIcon,
  pmTaskKindUsesServiceIcon,
  type PmComplianceSummary,
  type PmComplianceTask,
} from '@/lib/pmCompliance'
import { supabase } from '@/lib/supabase'
import applianceRepairIcon from '@/assets/appliance-repair.png'
import inspectionReviewIcon from '@/assets/inspection-review.png'
import pmServiceIcon from '@/assets/pm-service.png'

type AnalyticsTicket = {
  id: string
  createdAt: string
  urgency: string
  dueAt: string | null
  vendorWorkStatus: string
  unit: string
  building: string | null
  issueCategory: string | null
  description: string | null
  assignedVendorId: string | null
  estimatedMinutes: number | null
  completedAt: string | null
}

type MonthlySpend = {
  monthIndex: number
  label: string
  proactive: number
  reactive: number
  isFuture: boolean
  isProjection: boolean
}

type PmTaskStatusTone = 'danger' | 'warning' | 'neutral'

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeTicketRow(raw: Record<string, unknown>): AnalyticsTicket {
  return {
    id: asString(raw.id),
    createdAt: asString(raw.created_at),
    urgency: (
      asString(raw.urgency) ||
      asString(raw.severity) ||
      asString(raw.priority)
    ).toLowerCase(),
    dueAt: asString(raw.due_at) || null,
    vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
    unit: asString(raw.unit),
    building: asString(raw.building) || null,
    issueCategory: asString(raw.issue_category) || null,
    description: asString(raw.description) || null,
    assignedVendorId: asString(raw.assigned_vendor_id) || null,
    estimatedMinutes:
      typeof raw.estimated_minutes === 'number' && Number.isFinite(raw.estimated_minutes)
        ? raw.estimated_minutes
        : null,
    completedAt:
      asString(raw.completed_at) ||
      asString(raw.resolved_at) ||
      asString(raw.closed_at) ||
      null,
  }
}

function isTicketOpen(ticket: AnalyticsTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus)
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatChartYTick(amount: number): string {
  if (amount === 0) return '$0'
  return `$${amount / 1000}k`
}

/** Deterministic 0–1 float so demo projections stay stable across re-renders. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function demoMonthProjection(
  monthIndex: number,
  year: number,
): { proactive: number; reactive: number } {
  const totalSeed = year * 100 + monthIndex
  const splitSeed = totalSeed + 7919
  const total = Math.round(2200 + seededUnit(totalSeed) * 2600)
  const reactiveShare = 0.22 + seededUnit(splitSeed) * 0.38
  const reactive = Math.round(total * reactiveShare)
  return { proactive: total - reactive, reactive }
}

function averageMonthProjection(
  actualMonths: MonthlySpend[],
): { proactive: number; reactive: number } {
  const withSpend = actualMonths.filter((m) => m.proactive + m.reactive > 0)
  if (!withSpend.length) {
    return { proactive: 1800, reactive: 900 }
  }
  const proactive = Math.round(
    withSpend.reduce((sum, m) => sum + m.proactive, 0) / withSpend.length,
  )
  const reactive = Math.round(
    withSpend.reduce((sum, m) => sum + m.reactive, 0) / withSpend.length,
  )
  return { proactive, reactive }
}

/** Fixed Y-axis scale for the monthly maintenance cost chart. */
const CHART_Y_MAX = 5000
const CHART_Y_TICKS = [5000, 4000, 3000, 2000, 1000, 0] as const
const CHART_BAR_AREA_PX = 224

function formatSpendCompact(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(amount)
    .replace('K', 'k')
}

function formatCategoryName(slug: string | null): string {
  if (!slug) return 'Maintenance'
  return slug
    .split(/[_-]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function formatUpdatedAt(date: Date): string {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (date >= startOfToday) {
    return `Updated ${date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  if (date >= startOfYesterday) return 'Updated yesterday'
  return `Updated ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

function TrendingUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrendingDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 7l6 6 4-4 8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 17h6v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  deltaFormatter,
  goodWhenUp = false,
  caption,
}: {
  label: string
  value: string
  delta: number | null
  deltaSuffix?: string
  deltaFormatter?: (delta: number) => string
  goodWhenUp?: boolean
  caption: string
}) {
  const positive = (delta ?? 0) > 0
  const neutral = delta === 0
  const good = neutral ? false : positive === goodWhenUp
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <p className="truncate text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[44px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums xl:text-[52px]">
          {value}
        </p>
        {delta != null ? (
          <span
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] leading-5 tracking-[-0.1504px]',
              neutral
                ? 'bg-[#f3f4f6] text-[#6a7282]'
                : good
                  ? 'bg-[rgba(16,185,129,0.08)] text-[#008236] [&>svg]:text-[#10b981]'
                  : 'bg-[rgba(255,83,83,0.08)] text-[#c10007] [&>svg]:text-[#fb2c36]',
            ].join(' ')}
          >
            {neutral ? null : positive ? <TrendingUpIcon /> : <TrendingDownIcon />}
            {deltaFormatter
              ? deltaFormatter(delta ?? 0)
              : positive
                ? `+${delta}${deltaSuffix}`
                : `${delta}${deltaSuffix}`}
          </span>
        ) : null}
      </div>
      <p className="text-[12px] leading-4 text-[#6a7282]">{caption}</p>
    </div>
  )
}

function StatusText({ tone, children }: { tone: PmTaskStatusTone; children: ReactNode }) {
  const className = {
    danger: 'text-[#c10007] font-medium',
    warning: 'text-[#c2410c] font-medium',
    neutral: 'text-[#6a7282]',
  }[tone]
  return <span className={className}>{children}</span>
}

function PmComplianceRow({ task }: { task: PmComplianceTask }) {
  const due = formatPmDueLabel(task.dueAt, task.status)
  const taskIcon = pmTaskKindUsesApplianceIcon(task.kind)
    ? applianceRepairIcon
    : pmTaskKindUsesInspectionIcon(task.kind)
      ? inspectionReviewIcon
      : pmTaskKindUsesServiceIcon(task.kind)
        ? pmServiceIcon
        : null

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 gap-3">
        {taskIcon ? (
          <img
            src={taskIcon}
            alt=""
            className="mt-0.5 size-8 shrink-0 object-contain"
            aria-hidden
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-[#0a0a0a]">{task.title}</p>
          <p className="text-[12px] text-[#6a7282]">{task.location}</p>
          <p className="mt-1 text-[12px] leading-5 text-[#4b5563]">{formatPmTaskSubtitle(task)}</p>
          {task.kind === 'appliance' && task.estimatedReplacementCost != null ? (
            <p className="mt-1 text-[12px] font-medium text-[#0a0a0a]">
              Est. replacement {formatSpend(task.estimatedReplacementCost)}
            </p>
          ) : null}
        </div>
      </div>
      <StatusText tone={due.tone}>{due.label}</StatusText>
    </div>
  )
}

function MaintenanceSpendBar({
  month,
  totalPx,
  reactivePx,
  proactivePx,
}: {
  month: MonthlySpend
  totalPx: number
  reactivePx: number
  proactivePx: number
}) {
  const total = month.proactive + month.reactive
  const tooltipTitle = month.isProjection ? `${month.label} (projected)` : month.label

  return (
    <div
      className={[
        'group relative flex min-w-0 flex-1 flex-col items-center gap-2',
        month.isProjection ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex h-56 w-full items-end justify-center">
        {totalPx > 0 ? (
          <div className="relative flex w-full max-w-[42px] justify-center">
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[200px] -translate-x-1/2 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-left opacity-0 shadow-[0px_4px_12px_rgba(0,0,0,0.08)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <p className="text-[12px] font-semibold leading-4 text-[#0a0a0a]">
                {tooltipTitle}
              </p>
              <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 tabular-nums text-[#6a7282]">
                <p>
                  <span className="text-[#008236]">Proactive:</span>{' '}
                  {formatSpend(month.proactive)}
                </p>
                <p>
                  <span className="text-[#c10007]">Reactive:</span>{' '}
                  {formatSpend(month.reactive)}
                </p>
                <p className="border-t border-[#f3f4f6] pt-1 font-medium text-[#0a0a0a]">
                  Total: {formatSpend(total)}
                </p>
              </div>
            </div>
            <div
              tabIndex={0}
              aria-label={`${tooltipTitle}: ${formatSpend(month.proactive)} proactive, ${formatSpend(month.reactive)} reactive, ${formatSpend(total)} total`}
              className={[
                'flex w-full flex-col justify-end overflow-hidden rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2',
                month.isProjection ? 'ring-1 ring-dashed ring-[#d1d5dc]' : '',
              ].join(' ')}
              style={{ height: totalPx }}
            >
              {reactivePx > 0 ? (
                <div className="bg-[#fb2c36]" style={{ height: reactivePx }} />
              ) : null}
              {proactivePx > 0 ? (
                <div className="bg-[#00c950]" style={{ height: proactivePx }} />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="h-0 w-full max-w-[42px]" />
        )}
      </div>
      <span className="text-[11px] text-[#6a7282]">
        {month.label}
        {month.isProjection ? '*' : ''}
      </span>
    </div>
  )
}

export function AdminAnalyticsDashboard() {
  const [tickets, setTickets] = useState<AnalyticsTicket[]>([])
  const [recognizedSpend, setRecognizedSpend] = useState<RecognizedMaintenanceSpend[]>([])
  const [pendingInvoices, setPendingInvoices] = useState<PendingMaintenanceInvoice[]>([])
  const [pmComplianceData, setPmComplianceData] = useState<PmComplianceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const reloadSpend = useCallback(async () => {
    const [recognized, pending] = await Promise.all([
      fetchRecognizedMaintenanceSpend(),
      fetchPendingMaintenanceInvoices(),
    ])
    setRecognizedSpend(recognized)
    setPendingInvoices(pending)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!supabase) {
        setLoading(false)
        setError('Supabase is not configured — connect a project to see analytics.')
        return
      }

      setLoading(true)
      setError(null)

      const [ticketsResult, recognized, pending, pmCompliance] = await Promise.all([
        supabase
          .from('maintenance_requests')
          .select('*')
          .eq('landlord_id', getActiveLandlordId())
          .order('created_at', { ascending: false })
          .limit(500),
        fetchRecognizedMaintenanceSpend(),
        fetchPendingMaintenanceInvoices(),
        fetchPmCompliance(),
      ])

      if (cancelled) return

      if (!ticketsResult.error) {
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).map(normalizeTicketRow),
        )
      } else {
        setError(ticketsResult.error.message ?? 'Failed to load maintenance data.')
      }

      setRecognizedSpend(recognized)
      setPendingInvoices(pending)
      setPmComplianceData(pmCompliance)
      setLastUpdated(new Date())
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleApproveInvoice(invoiceId: string) {
    setApprovingId(invoiceId)
    try {
      await approveMaintenanceInvoice(invoiceId)
      await reloadSpend()
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve invoice.')
    } finally {
      setApprovingId(null)
    }
  }

  const analytics = useMemo(() => {
    const now = Date.now()
    const year = new Date().getFullYear()
    const startOfYear = new Date(year, 0, 1).getTime()
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    const currentMonthIndex = new Date().getMonth()

    const openTickets = tickets.filter(isTicketOpen)
    const overdueOpen = openTickets.filter((t) => {
      if (!t.dueAt) return false
      const due = new Date(t.dueAt).getTime()
      return !Number.isNaN(due) && due < now
    })
    const unassignedOpen = openTickets.filter((t) => !t.assignedVendorId)

    const spendBetween = (fromMs: number, toMs: number, reactive?: boolean): number =>
      recognizedSpend.reduce((sum, row) => {
        const at = new Date(row.spend_date).getTime()
        if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
        const isReactive = row.spend_class === 'reactive'
        if (reactive != null && isReactive !== reactive) return sum
        return sum + row.total_cost
      }, 0)

    const ytdTotal = Math.round(spendBetween(startOfYear, now))
    const ytdProactive = Math.round(spendBetween(startOfYear, now, false))
    const ytdReactive = Math.round(spendBetween(startOfYear, now, true))
    const mtdTotal = Math.round(spendBetween(startOfMonth, now))
    const mtdProactive = Math.round(spendBetween(startOfMonth, now, false))
    const mtdReactive = Math.round(spendBetween(startOfMonth, now, true))

    const lastYearStart = new Date(year - 1, 0, 1).getTime()
    const lastYearSamePeriodEnd = new Date(
      year - 1,
      new Date().getMonth(),
      new Date().getDate() + 1,
    ).getTime()
    const priorYtd = spendBetween(lastYearStart, lastYearSamePeriodEnd)
    const ytdDeltaPct =
      priorYtd > 0 ? Math.round(((ytdTotal - priorYtd) / priorYtd) * 100) : null

    const pm = pmComplianceData ?? {
      tasks: [],
      totalTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      compliancePct: null,
      complianceLabel: null,
      attentionCount: 0,
      replacementRecommendedCount: 0,
    }
    const pmCompliance = pm.compliancePct
    const pmComplianceLabel = pm.complianceLabel ?? '—'
    const pmCompleted = pm.completedTasks
    const pmOverdue = pm.overdueTasks
    const pmTotalTasks = pm.totalTasks

    const actualMonthlySpend: MonthlySpend[] = MONTH_LABELS.map((label, monthIndex) => {
      const monthStart = new Date(year, monthIndex, 1).getTime()
      const monthEnd = new Date(year, monthIndex + 1, 1).getTime()
      const isFuture = monthIndex > currentMonthIndex
      return {
        monthIndex,
        label,
        proactive: isFuture ? 0 : Math.round(spendBetween(monthStart, monthEnd, false)),
        reactive: isFuture ? 0 : Math.round(spendBetween(monthStart, monthEnd, true)),
        isFuture,
        isProjection: false,
      }
    })

    const useDemoProjections = isDemoAccountActive()
    const averageProjection = averageMonthProjection(actualMonthlySpend)

    const monthlySpend: MonthlySpend[] = actualMonthlySpend.map((month) => {
      if (!month.isFuture) return month
      const projected = useDemoProjections
        ? demoMonthProjection(month.monthIndex, year)
        : averageProjection
      return {
        ...month,
        proactive: projected.proactive,
        reactive: projected.reactive,
        isProjection: true,
      }
    })

    const applianceAttentionCount = pm.attentionCount

    const reactiveMultiple =
      ytdProactive > 0 ? Math.round((ytdReactive / ytdProactive) * 10) / 10 : null

    const lowComplianceBuildings = new Set<string>()
    for (const ticket of overdueOpen) {
      if (ticket.building) lowComplianceBuildings.add(ticket.building.replace(/\s+Apartments$/i, ''))
    }

    const insight =
      reactiveMultiple != null && reactiveMultiple >= 2
        ? `Reactive costs are ${reactiveMultiple}x proactive YTD.${
            lowComplianceBuildings.size > 0
              ? ` Properties with overdue preventive work (${[...lowComplianceBuildings].slice(0, 2).join(', ')}) account for much of reactive spend.`
              : ''
          } Closing ${overdueOpen.length} overdue task${overdueOpen.length === 1 ? '' : 's'} could prevent an estimated ${formatSpend(Math.min(ytdReactive * 0.15, 2400))}–${formatSpend(Math.min(ytdReactive * 0.2, 2400))} in reactive repairs this quarter.`
        : ytdTotal > 0
          ? `YTD maintenance spend is ${formatSpend(ytdTotal)} with ${formatSpend(ytdProactive)} proactive and ${formatSpend(ytdReactive)} reactive.`
          : pendingInvoices.length > 0
            ? `${pendingInvoices.length} vendor invoice${pendingInvoices.length === 1 ? '' : 's'} awaiting approval — approved costs will appear on this chart.`
            : 'Analytics populate when completed jobs are invoiced, approved, and spend is recognized.'

    return {
      openWorkOrders: openTickets.length,
      overdueOpen: overdueOpen.length,
      unassignedOpen: unassignedOpen.length,
      pmCompliance,
      pmComplianceLabel,
      pmCompleted,
      pmOverdue,
      pmTotalTasks,
      mtdTotal,
      mtdProactive,
      mtdReactive,
      ytdTotal,
      ytdDeltaPct,
      monthlySpend,
      pmTasks: pm.tasks,
      applianceReplacementCount: pm.replacementRecommendedCount,
      applianceAttentionCount,
      insight,
      overdueOpenCount: overdueOpen.length,
      pendingInvoices,
    }
  }, [tickets, recognizedSpend, pendingInvoices, pmComplianceData])

  const updatedCaption = lastUpdated ? formatUpdatedAt(lastUpdated) : 'Live portfolio metrics'

  return (
    <main className="w-full min-w-0 px-8 pb-12">
      <div className="py-6">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Analytics
        </h1>
        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          Maintenance spend, preventive compliance, and portfolio performance trends.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      {!loading && analytics.pendingInvoices.length > 0 ? (
        <section className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-6 py-4">
          <h2 className="text-[14px] font-semibold text-[#92400e]">
            {analytics.pendingInvoices.length} invoice
            {analytics.pendingInvoices.length === 1 ? '' : 's'} awaiting approval
          </h2>
          <p className="mt-1 text-[13px] text-[#a16207]">
            Approve vendor invoices to record spend and update maintenance analytics.
          </p>
          <ul className="mt-3 divide-y divide-[#fde68a]/60">
            {analytics.pendingInvoices.slice(0, 5).map((inv) => {
              const ticket = inv.maintenance_requests
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[#0a0a0a]">
                      {ticket?.unit ?? 'Unit'} · {formatSpend(inv.total_cost)}
                    </p>
                    <p className="text-[12px] text-[#6a7282]">
                      {ticket?.resident_name ?? 'Resident'}
                      {ticket?.issue_category
                        ? ` · ${formatCategoryName(ticket.issue_category)}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={approvingId === inv.id}
                    onClick={() => void handleApproveInvoice(inv.id)}
                    className="h-9 shrink-0 rounded-[10px] bg-[#008236] px-4 text-[13px] font-medium text-white hover:bg-[#006b2d] disabled:opacity-50"
                  >
                    {approvingId === inv.id ? 'Approving…' : 'Approve cost'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Open Work Orders"
          value={loading ? '—' : String(analytics.openWorkOrders)}
          delta={null}
          caption={
            loading
              ? updatedCaption
              : `${analytics.overdueOpen} overdue · ${analytics.unassignedOpen} unassigned`
          }
        />
        <KpiCard
          label="PM Compliance"
          value={loading || analytics.pmCompliance == null ? '—' : `${analytics.pmCompliance}%`}
          delta={null}
          goodWhenUp
          caption={
            loading
              ? updatedCaption
              : analytics.pmTotalTasks === 0
                ? 'No preventive maintenance tasks yet'
                : `${analytics.pmCompleted} of ${analytics.pmTotalTasks} preventive tasks complete · ${analytics.pmComplianceLabel}`
          }
        />
        <KpiCard
          label="MTD Maint. Cost"
          value={loading ? '—' : formatSpend(analytics.mtdTotal)}
          delta={null}
          caption={
            loading
              ? updatedCaption
              : `${formatSpend(analytics.mtdProactive)} proactive · ${formatSpend(analytics.mtdReactive)} reactive`
          }
        />
        <KpiCard
          label="YTD Maintenance Cost"
          value={loading ? '—' : formatSpendCompact(analytics.ytdTotal)}
          delta={loading ? null : analytics.ytdDeltaPct}
          deltaSuffix="%"
          goodWhenUp={false}
          caption={updatedCaption}
        />
      </div>

      <section className="mt-4 rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Monthly maintenance cost · {new Date().getFullYear()}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-[#6a7282]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-[#00c950]" />
                Proactive
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-[#fb2c36]" />
                Reactive
              </span>
              <span className="inline-flex items-center gap-1.5 opacity-50">
                <span className="size-2.5 rounded-[2px] border border-dashed border-[#99a1af] bg-[#e5e7eb]" />
                Projected
              </span>
            </div>
          </div>
          <span className="rounded-full bg-[#dbfce7] px-3 py-1 text-[12px] font-medium text-[#008236]">
            {loading ? '—' : `${formatSpendCompact(analytics.ytdTotal)} YTD`}
          </span>
        </div>

        <div className="overflow-visible px-6 pb-5 pt-8">
          <div className="flex gap-3">
            <div
              className="flex h-56 w-9 shrink-0 flex-col justify-between text-right text-[11px] leading-none tabular-nums text-[#6a7282]"
              aria-hidden
            >
              {CHART_Y_TICKS.map((tick) => (
                <span key={tick}>{formatChartYTick(tick)}</span>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 flex h-56 flex-col justify-between"
                aria-hidden
              >
                {CHART_Y_TICKS.map((tick) => (
                  <div
                    key={tick}
                    className={[
                      'w-full border-[#f3f4f6]',
                      tick === 0 ? 'border-b border-[#e5e7eb]' : 'border-t',
                    ].join(' ')}
                  />
                ))}
              </div>

              <div className="relative flex gap-2 sm:gap-3">
                {analytics.monthlySpend.map((month) => {
                  const total = month.proactive + month.reactive
                  const totalPx =
                    total > 0
                      ? Math.max(
                          Math.min(
                            Math.round((total / CHART_Y_MAX) * CHART_BAR_AREA_PX),
                            CHART_BAR_AREA_PX,
                          ),
                          4,
                        )
                      : 0
                  const reactivePx =
                    total > 0 ? Math.round((month.reactive / total) * totalPx) : 0
                  const proactivePx = totalPx - reactivePx
                  return (
                    <MaintenanceSpendBar
                      key={month.label}
                      month={month}
                      totalPx={totalPx}
                      reactivePx={reactivePx}
                      proactivePx={proactivePx}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-[#e5e7eb] bg-[#eff6ff] px-6 py-4">
          <p className="text-[13px] leading-6 text-[#1e40af]">
            <span aria-hidden className="mr-1.5">
              💡
            </span>
            {loading ? 'Loading insights…' : analytics.insight}
          </p>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">PM compliance</h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              {loading
                ? 'Loading preventive tasks…'
                : analytics.pmTotalTasks > 0 || analytics.applianceReplacementCount > 0
                  ? [
                      analytics.pmTotalTasks > 0
                        ? `${analytics.pmCompleted} of ${analytics.pmTotalTasks} tasks complete`
                        : null,
                      analytics.applianceReplacementCount > 0
                        ? `${analytics.applianceReplacementCount} replacement${analytics.applianceReplacementCount === 1 ? '' : 's'} recommended`
                        : null,
                      analytics.applianceAttentionCount > 0
                        ? `${analytics.applianceAttentionCount} need attention`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Preventive tasks flow from property assets through the workflow engine.'}
            </p>
          </div>
          <span className="text-[13px] font-medium text-[#a65f00]">
            {loading || analytics.pmCompliance == null
              ? '—'
              : `${analytics.pmCompliance}% · ${analytics.pmComplianceLabel}`}
          </span>
        </div>

        <div className="px-6 py-5">
          <div className="mb-5">
            <div className="flex items-end justify-between gap-3">
              <p className="text-[36px] font-bold leading-none text-[#0a0a0a] tabular-nums">
                {loading || analytics.pmCompliance == null ? '—' : `${analytics.pmCompliance}%`}
              </p>
              <p className="text-[13px] text-[#6a7282]">
                {loading
                  ? '—'
                  : `${analytics.pmCompleted} of ${Math.max(analytics.pmTotalTasks, analytics.pmCompleted)} tasks complete`}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f3f4f6]">
              <div
                className="h-full rounded-full bg-[#00c950] transition-all duration-300"
                style={{
                  width: loading || analytics.pmCompliance == null ? '0%' : `${analytics.pmCompliance}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] text-[#6a7282]">
              {loading
                ? '—'
                : analytics.applianceAttentionCount > 0
                  ? `${analytics.applianceAttentionCount} overdue or due soon`
                  : analytics.pmTasks.length > 0
                    ? 'No overdue preventive tasks right now'
                    : 'Tasks appear when property assets generate preventive work'}
            </p>
          </div>

          {loading ? (
            <p className="py-6 text-center text-[13px] text-[#6a7282]">Loading tasks…</p>
          ) : analytics.pmTasks.length > 0 ? (
            <div>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-[#0a0a0a]">
                    Preventive maintenance tasks
                  </h3>
                  <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
                    Asset → task → workflow → assignment → completion
                  </p>
                </div>
                <span className="text-[12px] font-medium text-[#6a7282]">
                  {analytics.pmTasks.length} task
                  {analytics.pmTasks.length === 1 ? '' : 's'} due
                </span>
              </div>
              <div className="divide-y divide-[#f3f4f6]">
                {analytics.pmTasks.map((task) => (
                  <PmComplianceRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          ) : (
            <p className="py-6 text-center text-[12px] leading-5 text-[#6a7282]">
              Preventive maintenance tasks will appear when property assets are tracked and scheduled.
            </p>
          )}
        </div>

        <div className="border-t border-[#e5e7eb] px-6 py-4 text-center">
          <Link
            to="/admin/workflows"
            className="inline-flex h-9 items-center justify-center rounded-[10px] border border-black/10 bg-white px-4 text-[14px] font-medium text-tertiary transition-colors duration-150 hover:bg-[#e2f5f1]"
          >
            Schedule all overdue tasks →
          </Link>
        </div>
      </section>
    </main>
  )
}

export default AdminAnalyticsDashboard
