import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
}

type OverviewUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

type BuildingHealth = {
  building: string
  unitCount: number
  openTickets: number
  occupancyPct: number
  health: number
  status: 'healthy' | 'monitor' | 'at_risk'
  /** Estimated maintenance spend over the last 30 days (cost proxy). */
  monthlySpend: number
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
  }
}

/**
 * Cost proxy shared with unit_maintenance_cost_view:
 * estimated_minutes × $1.25/min, defaulting to 240 minutes per ticket.
 */
function ticketCostEstimate(ticket: OverviewTicket): number {
  return (ticket.estimatedMinutes ?? 240) * 1.25
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
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

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  goodWhenUp = false,
  caption,
}: {
  label: string
  value: string
  delta: number | null
  /** Appended to the delta, e.g. '%' for rate cards. */
  deltaSuffix?: string
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
            {positive ? `+${delta}${deltaSuffix}` : `${delta}${deltaSuffix}`}
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

const HEALTH_BADGE_STYLES: Record<BuildingHealth['status'], string> = {
  healthy: 'bg-[#dbfce7] text-[#008236]',
  monitor: 'bg-[#fef9c2] text-[#a65f00]',
  at_risk: 'bg-[#ffe2e2] text-[#c10007]',
}

const HEALTH_BADGE_LABELS: Record<BuildingHealth['status'], string> = {
  healthy: 'HEALTHY',
  monitor: 'MONITOR',
  at_risk: 'AT RISK',
}

const HEALTH_BAR_STYLES: Record<BuildingHealth['status'], string> = {
  healthy: 'bg-[#00c950]',
  monitor: 'bg-[#fdc700]',
  at_risk: 'bg-[#fb2c36]',
}

export function AdminOverviewDashboard() {
  const [tickets, setTickets] = useState<OverviewTicket[]>([])
  const [units, setUnits] = useState<OverviewUnit[]>([])
  const [workflowData, setWorkflowData] =
    useState<AdminWorkflowDashboardData | null>(null)
  const [feedEvents, setFeedEvents] = useState<PropertyOperationsTimelineEvent[]>([])
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

      const [ticketsResult, unitsResult, workflowResult, feedResult] =
        await Promise.allSettled([
          supabase
            .from('maintenance_requests')
            .select('*')
            .eq('landlord_id', getActiveLandlordId())
            .order('created_at', { ascending: false })
            .limit(500),
          supabase
            .from('units')
            .select('id, unit_label, building, status')
            .eq('landlord_id', getActiveLandlordId())
            .limit(1000),
          fetchAdminWorkflowDashboard(),
          fetchRecentPropertyOperationsEvents(8),
        ])

      if (cancelled) return

      if (ticketsResult.status === 'fulfilled' && !ticketsResult.value.error) {
        setTickets(
          ((ticketsResult.value.data ?? []) as Record<string, unknown>[]).map(
            normalizeTicketRow,
          ),
        )
      } else {
        console.error(
          '[admin overview] maintenance_requests fetch failed',
          ticketsResult.status === 'fulfilled'
            ? ticketsResult.value.error?.message
            : ticketsResult.reason,
        )
      }

      if (unitsResult.status === 'fulfilled' && !unitsResult.value.error) {
        setUnits(
          ((unitsResult.value.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: asString(r.id),
            unitLabel: asString(r.unit_label),
            building: asString(r.building) || null,
            status: asString(r.status).toLowerCase(),
          })),
        )
      }

      if (workflowResult.status === 'fulfilled') {
        setWorkflowData(workflowResult.value)
      } else {
        console.error('[admin overview] workflow dashboard fetch failed', workflowResult.reason)
      }

      if (feedResult.status === 'fulfilled') {
        setFeedEvents(feedResult.value)
      }

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

    const workOrders = openTickets.filter((t) => t.assignedVendorId).length
    const ordersRecent = countCreatedBetween(
      tickets,
      now - fourWeeksMs,
      now,
      (t) => Boolean(t.assignedVendorId),
    )
    const ordersPrevious = countCreatedBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
      (t) => Boolean(t.assignedVendorId),
    )

    const trackedUnits = units.filter((u) => u.status !== 'inactive')
    const unitsWithOpenIssue = new Set(
      openTickets.map((t) => normalizeUnitLabel(t.unit)).filter(Boolean),
    )
    const healthyUnits = trackedUnits.filter(
      (u) => !unitsWithOpenIssue.has(normalizeUnitLabel(u.unitLabel)),
    ).length
    const propertyHealth = trackedUnits.length
      ? Math.round((healthyUnits / trackedUnits.length) * 100)
      : null

    // Approximate health 4 weeks ago: still-open issues that already existed
    // then (percentage-point change; no historical snapshots available).
    const unitsWithOlderOpenIssue = new Set(
      openTickets
        .filter((t) => {
          const ts = new Date(t.createdAt).getTime()
          return !Number.isNaN(ts) && ts < now - fourWeeksMs
        })
        .map((t) => normalizeUnitLabel(t.unit))
        .filter(Boolean),
    )
    const previousHealth = trackedUnits.length
      ? Math.round(
          (trackedUnits.filter(
            (u) => !unitsWithOlderOpenIssue.has(normalizeUnitLabel(u.unitLabel)),
          ).length /
            trackedUnits.length) *
            100,
        )
      : null
    const propertyHealthDelta =
      propertyHealth != null && previousHealth != null
        ? propertyHealth - previousHealth
        : null

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
    }
  }, [tickets, openTickets, units, workflowData, now, fourWeeksMs])

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

  const buildingHealth = useMemo<BuildingHealth[]>(() => {
    if (units.length === 0) return []

    const byBuilding = new Map<string, OverviewUnit[]>()
    for (const unit of units) {
      const key = unit.building ?? 'Portfolio'
      const list = byBuilding.get(key) ?? []
      list.push(unit)
      byBuilding.set(key, list)
    }

    const openByUnitLabel = new Map<string, number>()
    for (const t of openTickets) {
      const key = normalizeUnitLabel(t.unit)
      if (!key) continue
      openByUnitLabel.set(key, (openByUnitLabel.get(key) ?? 0) + 1)
    }

    // Estimated spend per unit label over the last 30 days (open or completed).
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const spendByUnitLabel = new Map<string, number>()
    for (const t of tickets) {
      const key = normalizeUnitLabel(t.unit)
      if (!key) continue
      const ts = new Date(t.createdAt).getTime()
      if (Number.isNaN(ts) || ts < thirtyDaysAgo) continue
      spendByUnitLabel.set(key, (spendByUnitLabel.get(key) ?? 0) + ticketCostEstimate(t))
    }

    const rows: BuildingHealth[] = []
    for (const [building, buildingUnits] of byBuilding) {
      const openTicketCount = buildingUnits.reduce(
        (sum, u) => sum + (openByUnitLabel.get(normalizeUnitLabel(u.unitLabel)) ?? 0),
        0,
      )
      const monthlySpend = buildingUnits.reduce(
        (sum, u) => sum + (spendByUnitLabel.get(normalizeUnitLabel(u.unitLabel)) ?? 0),
        0,
      )
      const activeUnits = buildingUnits.filter((u) => u.status === 'active').length
      const occupancyPct = buildingUnits.length
        ? Math.round((activeUnits / buildingUnits.length) * 100)
        : 0
      // Penalize open issues relative to building size so a 200-unit tower
      // isn't flagged at-risk by the same ticket count as a 6-unit building.
      const issuePenalty = buildingUnits.length
        ? Math.round((openTicketCount / buildingUnits.length) * 450)
        : openTicketCount * 9
      const health = Math.max(
        30,
        Math.min(100, 100 - issuePenalty - Math.round((100 - occupancyPct) / 6)),
      )
      rows.push({
        building,
        unitCount: buildingUnits.length,
        openTickets: openTicketCount,
        occupancyPct,
        health,
        status: health >= 85 ? 'healthy' : health >= 70 ? 'monitor' : 'at_risk',
        monthlySpend: Math.round(monthlySpend),
      })
    }

    return rows.sort((a, b) => a.health - b.health).slice(0, 6)
  }, [units, openTickets, tickets, now])

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
        <KpiCard
          label="Property Health"
          value={
            loading || kpis.propertyHealth == null ? '—' : `${kpis.propertyHealth}%`
          }
          delta={loading ? null : kpis.propertyHealthDelta}
          deltaSuffix="%"
          goodWhenUp
          caption={updatedCaption}
        />
        <KpiCard
          label="Vendor Response"
          value={
            loading || kpis.vendorResponse == null ? '—' : `${kpis.vendorResponse}%`
          }
          delta={loading ? null : kpis.vendorResponseDelta}
          deltaSuffix="%"
          goodWhenUp
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
                      'shrink-0 rounded-full px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                      item.badge === 'critical'
                        ? 'bg-[#fb2c36] text-white hover:bg-[#e7000b]'
                        : 'bg-[#101828] text-white hover:bg-[#1e2939]',
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

        {/* Property Health */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                Property Health
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                {buildingHealth.length} propert{buildingHealth.length === 1 ? 'y' : 'ies'} ·{' '}
                {units.length} units · See which properties need attention before
                issues become costly.
              </p>
            </div>
            <Link
              to="/admin/users"
              className="shrink-0 text-[13px] font-medium text-[#364153] hover:underline"
            >
              View all properties →
            </Link>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 2xl:grid-cols-3">
            {loading ? (
              <p className="col-span-full px-2 py-8 text-center text-[13px] text-[#6a7282]">
                Loading…
              </p>
            ) : buildingHealth.length === 0 ? (
              <div className="col-span-full px-2 py-8 text-center">
                <p className="text-[13px] text-[#6a7282]">No properties yet.</p>
                <Link
                  to="/admin/users"
                  className="mt-2 inline-block rounded-[10px] bg-[#101828] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1e2939]"
                >
                  Add your first property
                </Link>
              </div>
            ) : (
              buildingHealth.map((b) => (
                <div
                  key={b.building}
                  className="flex flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e7eb] text-[#364153]">
                        <BuildingIcon />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                          {b.building}
                        </p>
                        <p className="text-[12px] leading-4 text-[#6a7282]">
                          {b.unitCount} unit{b.unitCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${HEALTH_BADGE_STYLES[b.status]}`}
                    >
                      {HEALTH_BADGE_LABELS[b.status]}
                    </span>
                  </div>
                  <div>
                    <p className="text-[28px] font-bold leading-8 text-[#0a0a0a] tabular-nums">
                      {b.health}
                      <span className="text-[12px] font-normal text-[#6a7282]">
                        {' '}
                        / 100 health
                      </span>
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
                      <div
                        className={`h-full rounded-full ${HEALTH_BAR_STYLES[b.status]}`}
                        style={{ width: `${b.health}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[12px] leading-4 text-[#6a7282]">
                    <span>Monthly spend</span>
                    <span className="font-semibold text-[#0a0a0a] tabular-nums">
                      {formatSpend(b.monthlySpend)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#f3f4f6] pt-2 text-[12px] leading-4 text-[#6a7282]">
                    <span>
                      {b.openTickets} open issue{b.openTickets === 1 ? '' : 's'}
                    </span>
                    <span>{b.occupancyPct}% occ.</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
