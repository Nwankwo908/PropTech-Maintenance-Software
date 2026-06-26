import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  fetchAdminWorkflowDashboard,
  formatLocationContextLabel,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'
import {
  fetchRecentPropertyOperationsEvents,
  formatTimelineCategoryLabel,
  formatTimelineContextLine,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'
import {
  buildPropertyHealthReport,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  formatPropertyHealthTooltip,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  PROPERTY_HEALTH_KPI_CAPTION,
  type PropertyHealthFeedback,
  type PropertyHealthPmTask,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import { supabase } from '@/lib/supabase'

type OverviewTicket = {
  id: string
  createdAt: string
  urgency: string
  dueAt: string | null
  vendorWorkStatus: string
  unit: string
  issueCategory: string | null
  assignedVendorId: string | null
  residentName: string | null
  estimatedMinutes: number | null
  /** Actual total from an extracted vendor invoice (labor + materials + tax), when available. */
  totalCost: number | null
  /** When the job was marked complete, when the schema records it. */
  completedAt: string | null
}

type OverviewUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

type SmartInsight = {
  tag: 'PATTERN' | 'PERFORMANCE' | 'RISK' | 'PREVENTIVE'
  text: string
  score: number
}

type AttentionItem = {
  key: string
  title: string
  badge: 'critical' | 'warning'
  context: string
  meta: string
  actionLabel: string
  actionTo: string
  actionStyle?: 'alert'
}

const CRITICAL_LEVELS = new Set(['urgent', 'emergency', 'critical', 'high'])
const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeTicketRow(raw: Record<string, unknown>): OverviewTicket {
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
    issueCategory: asString(raw.issue_category) || null,
    assignedVendorId: asString(raw.assigned_vendor_id) || null,
    residentName: asString(raw.resident_name) || null,
    estimatedMinutes:
      typeof raw.estimated_minutes === 'number' && Number.isFinite(raw.estimated_minutes)
        ? raw.estimated_minutes
        : null,
    totalCost: invoiceTotalFromRow(raw),
    completedAt:
      asString(raw.completed_at) ||
      asString(raw.resolved_at) ||
      asString(raw.closed_at) ||
      null,
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Total cost recorded from an extracted vendor invoice. Prefers an explicit
 * total column; otherwise sums labor + materials + tax when those are present.
 * Returns null when no invoice cost exists yet (job not invoiced).
 */
function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

/**
 * Cost proxy shared with unit_maintenance_cost_view:
 * estimated_minutes × $1.25/min, defaulting to 240 minutes per ticket.
 */
function ticketCostEstimate(ticket: OverviewTicket): number {
  return (ticket.estimatedMinutes ?? 240) * 1.25
}

/**
 * Spend for a single ticket: the real extracted invoice total when available,
 * otherwise the estimate proxy so the figure stays populated pre-invoicing.
 */
function ticketSpend(ticket: OverviewTicket): number {
  return ticket.totalCost ?? ticketCostEstimate(ticket)
}

/** Date a job's spend should be attributed to (completion date, else created). */
function ticketSpendDate(ticket: OverviewTicket): number {
  const completed = ticket.completedAt ? new Date(ticket.completedAt).getTime() : NaN
  if (!Number.isNaN(completed)) return completed
  return new Date(ticket.createdAt).getTime()
}

function isCompletedJob(ticket: OverviewTicket): boolean {
  return ticket.vendorWorkStatus === 'completed'
}

/** Abbreviated currency, e.g. "$1k", "$48.2k", "$1.2M". */
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

/** Signed abbreviated currency for a delta pill, e.g. "+$1.2k" / "-$340" / "$0". */
function formatSignedSpend(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  return `${sign}${formatSpendCompact(Math.abs(amount))}`
}

function isTicketOpen(ticket: OverviewTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus)
}

function isTicketCritical(ticket: OverviewTicket): boolean {
  return CRITICAL_LEVELS.has(ticket.urgency)
}

function normalizeUnitLabel(label: string): string {
  return label.toLowerCase().replace(/^unit\s+/, '').trim()
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** "Updated 11:17 AM" same-day, "Updated yesterday", or "Updated Jun 11" for older. */
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

function formatCategoryName(slug: string): string {
  return slug
    .split(/[_-]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function countCreatedBetween(
  tickets: OverviewTicket[],
  fromMs: number,
  toMs: number,
  predicate?: (t: OverviewTicket) => boolean,
): number {
  return tickets.filter((t) => {
    const ts = new Date(t.createdAt).getTime()
    if (Number.isNaN(ts) || ts < fromMs || ts >= toMs) return false
    return predicate ? predicate(t) : true
  }).length
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
  /** Appended to the delta, e.g. '%' for rate cards. */
  deltaSuffix?: string
  /** Renders the full signed delta string (e.g. currency); overrides deltaSuffix. */
  deltaFormatter?: (delta: number) => string
  /** True when an increase is a good trend (e.g. health), false when it's bad (e.g. critical issues). */
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
              // Icon carries a brighter shade than the label text.
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

const INSIGHT_TAG_STYLES: Record<SmartInsight['tag'], string> = {
  PATTERN: 'text-[#7c3aed]',
  PERFORMANCE: 'text-[#7c3aed]',
  RISK: 'text-[#7c3aed]',
  PREVENTIVE: 'text-[#7c3aed]',
}

const FEED_BADGE_STYLES: Record<string, string> = {
  maintenance: 'bg-[#f3e8ff] text-[#7c3aed]',
  rent: 'bg-[#fef9c2] text-[#a65f00]',
  move_in: 'bg-[#dbfce7] text-[#008236]',
  move_out: 'bg-[#ffe2e2] text-[#c10007]',
  inspection: 'bg-[#dbeafe] text-[#1447e6]',
  vendor: 'bg-[#e0f2fe] text-[#0069a8]',
  admin: 'bg-[#f3f4f6] text-[#364153]',
}

export function AdminOverviewDashboard() {
  const [tickets, setTickets] = useState<OverviewTicket[]>([])
  const [units, setUnits] = useState<OverviewUnit[]>([])
  const [workflowData, setWorkflowData] =
    useState<AdminWorkflowDashboardData | null>(null)
  const [feedEvents, setFeedEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!supabase) {
        setLoading(false)
        setError('Supabase is not configured — connect a project to see live operations data.')
        return
      }

      setLoading(true)
      setError(null)

      const landlordId = getActiveLandlordId()
      const [ticketsResult, unitsResult, workflowResult, feedResult, healthSignals] =
        await Promise.all([
          supabase
            .from('maintenance_request_enriched')
            .select(
              'id, created_at, unit, unit_id, building, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, due_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
            )
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(500)
            .then((r) =>
              r.error
                ? supabase!
                    .from('maintenance_requests')
                    .select('*')
                    .eq('landlord_id', landlordId)
                    .order('created_at', { ascending: false })
                    .limit(500)
                : r,
            ),
          supabase
            .from('units')
            .select('id, unit_label, building, status')
            .eq('landlord_id', landlordId)
            .limit(1000),
          fetchAdminWorkflowDashboard(),
          fetchRecentPropertyOperationsEvents(8),
          fetchPropertyHealthSignals(),
        ])

      if (cancelled) return

      if (!ticketsResult.error) {
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).map(normalizeTicketRow),
        )
      } else {
        console.error(
          '[admin overview] maintenance requests fetch failed',
          ticketsResult.error.message,
        )
      }

      if (!unitsResult.error) {
        setUnits(
          ((unitsResult.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: asString(r.id),
            unitLabel: asString(r.unit_label),
            building: asString(r.building) || null,
            status: asString(r.status).toLowerCase(),
          })),
        )
      }

      setWorkflowData(workflowResult)
      setFeedEvents(feedResult)
      setPmTasks(healthSignals.pmTasks)
      setFeedback(healthSignals.feedback)
      setVendorMetrics(healthSignals.vendorMetrics)

      setLastUpdated(new Date())
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const now = Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

  const openTickets = useMemo(() => tickets.filter(isTicketOpen), [tickets])

  const healthReport = useMemo(() => {
    const healthTickets = mapTicketsForPropertyHealth(
      tickets as unknown as Record<string, unknown>[],
    )
    return buildPropertyHealthReport({
      units: mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[]),
      tickets: healthTickets,
      pmTasks,
      feedback: enrichFeedbackFromTickets(feedback, healthTickets),
      vendorMetrics,
      now,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, now])

  const kpis = useMemo(() => {
    const criticalOpen = openTickets.filter(isTicketCritical).length
    const criticalRecent = countCreatedBetween(
      tickets,
      now - fourWeeksMs,
      now,
      isTicketCritical,
    )
    const criticalPrevious = countCreatedBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
      isTicketCritical,
    )

    // Active operations = every workflow run currently in flight, regardless
    // of type (maintenance, rent collection, move-ins, move-outs, inspections).
    // Headline and delta are computed from the same run pool with the same
    // rule: a run was active at time T if it had started by T and had not
    // completed yet.
    type RunLifespan = {
      startedAt: string
      completedAt: string | null
      status: string
    }
    const allRunsById = new Map<string, RunLifespan>()
    if (workflowData) {
      for (const run of [
        ...workflowData.active,
        ...workflowData.escalated,
        ...workflowData.maintenanceRuns,
        ...workflowData.rentCollection.runs,
        ...workflowData.lifecycle.runs,
      ]) {
        allRunsById.set(run.id, run)
      }
    }
    const wasActiveAt = (run: RunLifespan, atMs: number): boolean => {
      const started = new Date(run.startedAt).getTime()
      if (Number.isNaN(started) || started > atMs) return false
      if (run.completedAt) {
        const completed = new Date(run.completedAt).getTime()
        return Number.isNaN(completed) || completed > atMs
      }
      // No completion timestamp: only currently active/escalated runs count.
      return run.status === 'active' || run.status === 'escalated'
    }
    let opsNow = 0
    let opsPrevious = 0
    for (const run of allRunsById.values()) {
      if (wasActiveAt(run, now)) opsNow += 1
      if (wasActiveAt(run, now - fourWeeksMs)) opsPrevious += 1
    }
    const activeOps = opsNow

    const workOrders = openTickets.length
    const ordersRecent = countCreatedBetween(
      tickets,
      now - fourWeeksMs,
      now,
      isTicketOpen,
    )
    const ordersPrevious = countCreatedBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
      isTicketOpen,
    )

    const propertyHealth = healthReport.portfolio?.score ?? null
    const propertyHealthDelta = healthReport.portfolioDelta

    const assigned = tickets.filter((t) => t.assignedVendorId)
    const responded = assigned.filter(
      (t) => t.vendorWorkStatus && t.vendorWorkStatus !== 'pending_accept',
    )
    const vendorResponse = assigned.length
      ? Math.round((responded.length / assigned.length) * 100)
      : null

    // Response rate among tickets created in each 4-week window.
    const responseRateBetween = (fromMs: number, toMs: number): number | null => {
      const windowAssigned = assigned.filter((t) => {
        const ts = new Date(t.createdAt).getTime()
        return !Number.isNaN(ts) && ts >= fromMs && ts < toMs
      })
      if (!windowAssigned.length) return null
      const windowResponded = windowAssigned.filter(
        (t) => t.vendorWorkStatus && t.vendorWorkStatus !== 'pending_accept',
      )
      return Math.round((windowResponded.length / windowAssigned.length) * 100)
    }
    const responseRecent = responseRateBetween(now - fourWeeksMs, now)
    const responsePrevious = responseRateBetween(
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
    )
    const vendorResponseDelta =
      responseRecent != null && responsePrevious != null
        ? responseRecent - responsePrevious
        : null

    // YTD maintenance cost: total spend on completed maintenance jobs from
    // Jan 1 (local) through now. Uses extracted invoice totals when present,
    // else the estimate proxy, attributed to each job's completion date.
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime()
    const completedJobs = tickets.filter(isCompletedJob)
    const spendBetween = (fromMs: number, toMs: number): number =>
      completedJobs.reduce((sum, t) => {
        const at = ticketSpendDate(t)
        if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
        return sum + ticketSpend(t)
      }, 0)
    const ytdMaintenanceCost = Math.round(spendBetween(startOfYear, now))
    // 4-week-over-4-week change in completed-job spend (rising spend = bad).
    const ytdMaintenanceCostDelta = Math.round(
      spendBetween(now - fourWeeksMs, now) -
        spendBetween(now - 2 * fourWeeksMs, now - fourWeeksMs),
    )

    return {
      criticalOpen,
      criticalDelta: criticalRecent - criticalPrevious,
      activeOps,
      activeOpsDelta: workflowData ? opsNow - opsPrevious : null,
      workOrders,
      workOrdersDelta: ordersRecent - ordersPrevious,
      propertyHealth,
      propertyHealthDelta,
      vendorResponse,
      vendorResponseDelta,
      ytdMaintenanceCost,
      ytdMaintenanceCostDelta,
    }
  }, [tickets, openTickets, units, workflowData, healthReport, now, fourWeeksMs])

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []

    const slaOverdue = openTickets.filter((t) => {
      if (!t.dueAt) return false
      const due = new Date(t.dueAt).getTime()
      return !Number.isNaN(due) && due < now
    })
    for (const t of slaOverdue.slice(0, 2)) {
      items.push({
        key: `ticket-${t.id}`,
        badge: isTicketCritical(t) ? 'critical' : 'warning',
        title: isTicketCritical(t)
          ? `Emergency ${formatCategoryName(t.issueCategory ?? 'maintenance')} Issue`
          : `${formatCategoryName(t.issueCategory ?? 'maintenance')} SLA Overdue`,
        context: [t.unit ? `Unit ${t.unit.replace(/^unit\s+/i, '')}` : null, t.residentName]
          .filter(Boolean)
          .join(' · '),
        meta: `Due ${formatRelativeTime(t.dueAt ?? t.createdAt)}`,
        actionLabel: 'Review',
        actionTo: '/admin/requests',
        actionStyle: 'alert',
      })
    }

    if (workflowData) {
      for (const run of workflowData.escalated.slice(0, 3)) {
        items.push({
          key: `run-${run.id}`,
          badge: 'warning',
          title: `${run.templateName} Escalated`,
          context: formatLocationContextLabel({
            propertyLabel: run.propertyLabel,
            unitLabel: run.unitLabel,
            residentName: run.residentName,
          }),
          meta: run.lastEventAt
            ? `Escalated ${formatRelativeTime(run.lastEventAt)}`
            : 'Awaiting input',
          actionLabel: 'Review',
          actionTo: '/admin/workflows',
        })
      }

      for (const row of workflowData.rentCollection.overdue.slice(0, 2)) {
        items.push({
          key: `rent-${row.id}`,
          badge: 'warning',
          title: 'Late Rent Escalation',
          context: formatLocationContextLabel({
            propertyLabel: row.propertyLabel,
            unitLabel: row.unitLabel,
            residentName: row.residentName,
          }),
          meta: row.rentDueDate
            ? `Overdue since ${new Date(row.rentDueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : 'Overdue',
          actionLabel: 'Review Account',
          actionTo: '/admin/workflows',
        })
      }
    }

    return items
      .sort((a, b) => (a.badge === b.badge ? 0 : a.badge === 'critical' ? -1 : 1))
      .slice(0, 4)
  }, [openTickets, workflowData, now])

  const criticalAttentionCount = attentionItems.filter(
    (i) => i.badge === 'critical',
  ).length

  const overviewBuildingHealth = useMemo(
    () => healthReport.buildings.slice(0, 6),
    [healthReport.buildings],
  )

  const smartInsights = useMemo<SmartInsight[]>(() => {
    const insights: SmartInsight[] = []
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000

    const buildingByUnitLabel = new Map<string, string>()
    for (const u of units) {
      if (u.building) buildingByUnitLabel.set(normalizeUnitLabel(u.unitLabel), u.building)
    }

    const recentTickets = tickets.filter((t) => {
      const ts = new Date(t.createdAt).getTime()
      return !Number.isNaN(ts) && ts >= sixtyDaysAgo
    })

    const byBuildingCategory = new Map<string, number>()
    for (const t of recentTickets) {
      const building = buildingByUnitLabel.get(normalizeUnitLabel(t.unit))
      if (!building || !t.issueCategory) continue
      const key = `${building}|${t.issueCategory}`
      byBuildingCategory.set(key, (byBuildingCategory.get(key) ?? 0) + 1)
    }
    const topPattern = [...byBuildingCategory.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topPattern && topPattern[1] >= 2) {
      const [key, count] = topPattern
      const [building, category] = key.split('|')
      insights.push({
        tag: 'PATTERN',
        text: `${building} has experienced ${count} ${formatCategoryName(category).toLowerCase()} issues in the last 60 days.`,
        score: Math.min(95, 70 + count * 5),
      })
    }

    const byUnit = new Map<string, number>()
    for (const t of recentTickets) {
      const key = normalizeUnitLabel(t.unit)
      if (!key) continue
      byUnit.set(key, (byUnit.get(key) ?? 0) + 1)
    }
    const topUnit = [...byUnit.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topUnit && topUnit[1] >= 2) {
      insights.push({
        tag: 'RISK',
        text: `Unit ${topUnit[0].toUpperCase()} shows elevated maintenance volume (${topUnit[1]} requests in 60 days).`,
        score: Math.min(90, 60 + topUnit[1] * 6),
      })
    }

    if (kpis.vendorResponse != null) {
      insights.push({
        tag: 'PERFORMANCE',
        text: `Vendors have responded to ${kpis.vendorResponse}% of assigned work orders.`,
        score: kpis.vendorResponse,
      })
    }

    const byCategory = new Map<string, number>()
    for (const t of recentTickets) {
      if (!t.issueCategory) continue
      byCategory.set(t.issueCategory, (byCategory.get(t.issueCategory) ?? 0) + 1)
    }
    const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topCategory && topCategory[1] >= 3) {
      insights.push({
        tag: 'PREVENTIVE',
        text: `Preventive ${formatCategoryName(topCategory[0]).toLowerCase()} inspection recommended — ${topCategory[1]} related requests in 60 days.`,
        score: Math.min(95, 65 + topCategory[1] * 4),
      })
    }

    return insights.slice(0, 4)
  }, [tickets, units, kpis.vendorResponse, now])

  const updatedCaption =
    loading || !lastUpdated ? 'Updating…' : formatUpdatedAt(lastUpdated)
  const portfolioPendingSetup = healthReport.portfolio?.status === 'pending_setup'
  const healthKpiCaption = healthReport.portfolio
    ? portfolioPendingSetup
      ? 'Units are inactive — activate units to measure portfolio health.'
      : `${PROPERTY_HEALTH_KPI_CAPTION} Hover score for breakdown.`
    : updatedCaption
  const healthKpiTooltip = healthReport.portfolio
    ? formatPropertyHealthTooltip(healthReport.portfolio.components)
    : undefined
  const healthKpiValue =
    loading || !healthReport.portfolio
      ? '—'
      : portfolioPendingSetup
        ? 'Pending'
        : `${healthReport.portfolio.score}%`

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Operations Overview
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Good Morning, Alex. See whats happening across your portfolio.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      {!loading && units.length === 0 && tickets.length === 0 ? (
        <section className="mb-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
            Welcome to Ulo — let’s get your portfolio set up
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            Data will appear once activity begins. Work through these steps to
            bring your first property online.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                step: '1',
                title: 'Add a property',
                desc: 'Register your first building and units.',
                to: '/admin/users',
              },
              {
                step: '2',
                title: 'Import residents',
                desc: 'Add residents so Ulo can reach them.',
                to: '/admin/users',
              },
              {
                step: '3',
                title: 'Add vendors',
                desc: 'Plumbing, HVAC, electrical, and more.',
                to: '/admin/users',
              },
              {
                step: '4',
                title: 'Connect channels',
                desc: 'Set up SMS and email communication.',
                to: '/admin/notifications',
              },
              {
                step: '5',
                title: 'First request',
                desc: 'Submit a test maintenance request.',
                to: '/request',
              },
            ].map((item) => (
              <li key={item.step}>
                <Link
                  to={item.to}
                  className="flex h-full flex-col gap-1 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4 transition-colors hover:border-[#101828]/30 hover:bg-white"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#101828] text-[12px] font-semibold text-white">
                    {item.step}
                  </span>
                  <span className="mt-1 text-[14px] font-semibold text-[#101828]">
                    {item.title}
                  </span>
                  <span className="text-[12px] leading-4 text-[#6a7282]">
                    {item.desc}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Critical Issues"
          value={loading ? '—' : String(kpis.criticalOpen)}
          delta={loading ? null : kpis.criticalDelta}
          caption="More reported than 4 weeks ago"
        />
        <KpiCard
          label="Active Operations"
          value={loading ? '—' : String(kpis.activeOps)}
          delta={loading ? null : kpis.activeOpsDelta}
          caption="Compared to 4 weeks ago"
        />
        <KpiCard
          label="Open Work Orders"
          value={loading ? '—' : String(kpis.workOrders)}
          delta={loading ? null : kpis.workOrdersDelta}
          caption={updatedCaption}
        />
        <div title={healthKpiTooltip} aria-label={healthKpiTooltip}>
          <KpiCard
            label="Property Health"
            value={healthKpiValue}
            delta={loading || portfolioPendingSetup ? null : kpis.propertyHealthDelta}
            deltaSuffix="%"
            goodWhenUp
            caption={healthKpiCaption}
          />
        </div>
        <KpiCard
          label="YTD Maintenance Cost"
          value={loading ? '—' : formatSpendCompact(kpis.ytdMaintenanceCost)}
          delta={loading ? null : kpis.ytdMaintenanceCostDelta}
          deltaFormatter={formatSignedSpend}
          caption={updatedCaption}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_3fr]">
        {/* Smart Insights */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="border-b border-[#e5e7eb] px-6 py-4">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Property Insights
            </h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Insights generated from activity across your property
            </p>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {loading ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : smartInsights.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">
                Insights will appear as Ulo learns from your properties.
              </p>
            ) : (
              smartInsights.map((insight) => (
                <div
                  key={insight.tag}
                  className="rounded-[10px] border border-[#ede9fe] bg-[#fbfaff] p-4"
                >
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                    {insight.text}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${INSIGHT_TAG_STYLES[insight.tag]}`}
                    >
                      {insight.tag}
                    </span>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#ede9fe]">
                      <div
                        className="h-full rounded-full bg-[#7c3aed]"
                        style={{ width: `${insight.score}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[#6a7282]">{insight.score}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Needs Attention */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                Awaiting Your Decision
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                {attentionItems.length} operations{attentionItems.length === 1 ? '' : 's'}{' '}
                awaiting your decision
                {criticalAttentionCount > 0 ? ` · ${criticalAttentionCount} critical` : ''}
              </p>
            </div>
            <Link
              to="/admin/workflows"
              className="shrink-0 text-[13px] font-medium text-[#364153] hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-[#f3f4f6]">
            {loading ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : attentionItems.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                Nothing needs attention.
              </p>
            ) : (
              attentionItems.map((item) => (
                <div key={item.key} className="flex items-center gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                        {item.title}
                      </p>
                      <span
                        className={[
                          'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                          item.badge === 'critical'
                            ? 'bg-[#fb2c36] text-white'
                            : item.actionStyle === 'alert'
                              ? 'bg-[#f7e1e3] text-[#b22430]'
                              : 'bg-[#fef9c2] text-[#a65f00]',
                        ].join(' ')}
                      >
                        {item.badge === 'critical' ? 'Critical' : 'Warning'}
                      </span>
                    </div>
                    {item.context ? (
                      <p className="mt-0.5 truncate text-[13px] leading-5 text-[#6a7282]">
                        {item.context}
                      </p>
                    ) : null}
                    <p className="text-[12px] leading-4 text-[#6a7282]">{item.meta}</p>
                  </div>
                  <Link
                    to={item.actionTo}
                    className={[
                      'shrink-0 rounded-[10px] border px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                      item.actionStyle === 'alert'
                        ? 'border-transparent bg-[#f7e1e3] text-[#b22430] hover:bg-[#efd0d4]'
                        : 'border-black/10 bg-white text-tertiary hover:bg-[#e2f5f1]',
                    ].join(' ')}
                  >
                    {item.actionLabel} →
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        {/* AI Operations Feed */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                What Ulo Handled Today
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">Actions completed across your properties</p>
            </div>
            <span className="size-2 shrink-0 rounded-full bg-[#00c950]" aria-hidden />
          </div>
          <div className="flex flex-col">
            {loading ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : feedEvents.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                No AI actions yet. Activity will stream here as Ulo starts working.
              </p>
            ) : (
              feedEvents.map((event) => {
                const context = formatTimelineContextLine(event)
                return (
                  <div key={event.id} className="flex gap-3 px-6 py-3">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-[#7c3aed]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                        {event.label}
                        {context ? (
                          <span className="text-[#6a7282]"> · {context}</span>
                        ) : null}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={[
                            'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                            FEED_BADGE_STYLES[event.category] ?? FEED_BADGE_STYLES.admin,
                          ].join(' ')}
                        >
                          {formatTimelineCategoryLabel(event.category)}
                        </span>
                        <span className="text-[11px] text-[#6a7282]">
                          {formatRelativeTime(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <PropertyHealthBuildingGrid
          loading={loading}
          buildings={overviewBuildingHealth}
          totalUnits={units.length}
          headerAction={
            <Link
              to="/admin/properties"
              className="shrink-0 text-[13px] font-medium text-[#364153] hover:underline"
            >
              View all properties →
            </Link>
          }
        />
      </div>
    </main>
  )
}
