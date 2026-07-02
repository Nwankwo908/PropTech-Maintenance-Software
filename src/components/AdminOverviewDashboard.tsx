import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { postAdminReassignVendor } from '@/api/adminReassignVendor'
import { postRecommendVendorAlternatives } from '@/api/recommendVendorAlternatives'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { AwaitingDecisionListRail } from '@/components/AwaitingDecisionListRail'
import { LateRentAccountReviewRail } from '@/components/LateRentAccountReviewRail'
import { LeaseRenewalEscalatedRail } from '@/components/LeaseRenewalEscalatedRail'
import { SlaOverdueActionRail } from '@/components/SlaOverdueActionRail'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  isMaintenanceAdminVendorEscalationReason,
  maintenanceAdminVendorAttentionTitle,
} from '@/lib/maintenanceAdminVendor'
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
  type PropertyHealthResident,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import { buildEscalatedWorkflowReview } from '@/lib/escalatedWorkflowReview'
import {
  applyLateRentAccountAction,
  buildLateRentAccountReview,
  collectLateRentReviewRuns,
  type LateRentAccountAction,
  type LateRentAccountReview,
} from '@/lib/lateRentAccountReview'
import {
  applyLeaseRenewalEscalatedAction,
  buildLeaseRenewalEscalatedReview,
  isLeaseRenewalEscalatedRun,
  type LeaseRenewalEscalatedAction,
  type LeaseRenewalEscalatedReview,
} from '@/lib/leaseRenewalEscalatedReview'
import {
  buildSlaOverdueActionReview,
  isSlaOverdueOpenTicket,
  type SlaOverdueActionReview,
  type SlaOverdueTicketInput,
} from '@/lib/slaOverdueActionReview'
import { supabase } from '@/lib/supabase'

type OverviewTicket = {
  id: string
  createdAt: string
  urgency: string
  dueAt: string | null
  vendorWorkStatus: string
  unit: string
  building: string | null
  description: string | null
  issueCategory: string | null
  assignedVendorId: string | null
  assignedVendorName: string | null
  assignedAt: string | null
  residentName: string | null
  estimatedMinutes: number | null
  /** Actual total from an extracted vendor invoice (labor + materials + tax), when available. */
  totalCost: number | null
  /** When the job was marked complete, when the schema records it. */
  completedAt: string | null
}

type OverviewVendor = {
  id: string
  name: string
  category: string | null
  active: boolean
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
  actionTo?: string
  onAction?: () => void
  actionStyle?: 'alert'
}

type EscalatedRailTarget =
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'workflow'; runId: string }

type OverviewResident = {
  id: string
  fullName: string
  unit: string
  building: string | null
  status: string
  moveInDate: string | null
  balanceDue: number
  phone: string | null
}

function overviewTicketToInput(
  ticket: OverviewTicket,
  units: OverviewUnit[],
): SlaOverdueTicketInput {
  const building =
    ticket.building ??
    units.find((u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit))
      ?.building ??
    null
  return {
    id: ticket.id,
    createdAt: ticket.createdAt,
    dueAt: ticket.dueAt,
    urgency: ticket.urgency,
    unit: ticket.unit,
    building,
    description: ticket.description,
    issueCategory: ticket.issueCategory,
    assignedVendorId: ticket.assignedVendorId,
    assignedVendorName: ticket.assignedVendorName,
    vendorWorkStatus: ticket.vendorWorkStatus,
    residentName: ticket.residentName,
    assignedAt: ticket.assignedAt,
  }
}
const CRITICAL_LEVELS = new Set(['urgent', 'emergency', 'critical', 'high'])
const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeTicketRow(
  raw: Record<string, unknown>,
  vendorNameById: Record<string, string> = {},
): OverviewTicket {
  const assignedVendorId = asString(raw.assigned_vendor_id) || null
  const embeddedVendor =
    asString(raw.assigned_vendor_name) ||
    asString(raw.vendor_name) ||
    (assignedVendorId ? vendorNameById[assignedVendorId] : '') ||
    asString(raw.vendor) ||
    null
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
    description: asString(raw.description) || null,
    issueCategory: asString(raw.issue_category) || null,
    assignedVendorId,
    assignedVendorName: embeddedVendor?.trim() || null,
    assignedAt: asString(raw.assigned_at) || null,
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

function resolveVendorRecommendAlternativesUrl(): string | undefined {
  const explicit = import.meta.env.VITE_VENDOR_RECOMMEND_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  if (base) return `${base}/functions/v1/recommend-vendor-alternatives`
  return undefined
}

export function AdminOverviewDashboard() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState<OverviewTicket[]>([])
  const [vendors, setVendors] = useState<OverviewVendor[]>([])
  const [units, setUnits] = useState<OverviewUnit[]>([])
  const [workflowData, setWorkflowData] =
    useState<AdminWorkflowDashboardData | null>(null)
  const [feedEvents, setFeedEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [residents, setResidents] = useState<PropertyHealthResident[]>([])
  const [overviewResidents, setOverviewResidents] = useState<OverviewResident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [escalatedRailTarget, setEscalatedRailTarget] = useState<EscalatedRailTarget | null>(null)
  const [escalatedReview, setEscalatedReview] = useState<SlaOverdueActionReview | null>(null)
  const [escalatedRailLoading, setEscalatedRailLoading] = useState(false)
  const [escalatedRailSaving, setEscalatedRailSaving] = useState(false)
  const [escalatedRailError, setEscalatedRailError] = useState<string | null>(null)
  const [lateRentRailRunId, setLateRentRailRunId] = useState<string | null>(null)
  const [lateRentRailSaving, setLateRentRailSaving] = useState(false)
  const [lateRentRailError, setLateRentRailError] = useState<string | null>(null)
  const [leaseRenewalRailRunId, setLeaseRenewalRailRunId] = useState<string | null>(null)
  const [leaseRenewalRailSaving, setLeaseRenewalRailSaving] = useState(false)
  const [leaseRenewalRailError, setLeaseRenewalRailError] = useState<string | null>(null)
  const [awaitingDecisionListOpen, setAwaitingDecisionListOpen] = useState(false)

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
      const [ticketsResult, vendorsResult, unitsResult, workflowResult, feedResult, healthSignals, residentsResult] =
        await Promise.all([
          supabase
            .from('maintenance_request_enriched')
            .select(
              'id, created_at, assigned_at, unit, unit_id, building, description, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, due_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
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
            .from('vendors')
            .select('id, name, category, active')
            .eq('landlord_id', landlordId)
            .eq('active', true)
            .limit(500),
          supabase
            .from('units')
            .select('id, unit_label, building, status')
            .eq('landlord_id', landlordId)
            .limit(1000),
          fetchAdminWorkflowDashboard(),
          fetchRecentPropertyOperationsEvents(8),
          fetchPropertyHealthSignals(),
          supabase
            .from('users')
            .select('id, full_name, unit, building, status, move_in_date, balance_due, phone')
            .eq('landlord_id', landlordId)
            .neq('status', 'past_resident')
            .limit(2000),
        ])

      if (cancelled) return

      const vendorNameById: Record<string, string> = {}
      if (!vendorsResult.error) {
        const vendorRows = ((vendorsResult.data ?? []) as Record<string, unknown>[])
          .map((r) => ({
            id: asString(r.id),
            name: asString(r.name),
            category: asString(r.category) || null,
            active: r.active !== false,
          }))
          .filter((v) => v.id && v.name)
        setVendors(vendorRows)
        for (const v of vendorRows) vendorNameById[v.id] = v.name
      } else {
        setVendors([])
      }

      if (!ticketsResult.error) {
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((raw) =>
            normalizeTicketRow(raw, vendorNameById),
          ),
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

      if (!residentsResult.error) {
        const mapped = ((residentsResult.data ?? []) as Record<string, unknown>[])
          .map((raw) => ({
            id: asString(raw.id),
            fullName: asString(raw.full_name) || 'Unnamed resident',
            unit: asString(raw.unit),
            building: asString(raw.building) || null,
            status: asString(raw.status).toLowerCase() || 'active',
            moveInDate: asString(raw.move_in_date) || null,
            balanceDue: asFiniteNumber(raw.balance_due) ?? 0,
            phone: asString(raw.phone) || null,
          }))
          .filter((row) => row.id)
        setResidents(
          mapped.map((row) => ({
            id: row.id,
            fullName: row.fullName,
            unit: row.unit,
            building: row.building,
            status: row.status,
          })),
        )
        setOverviewResidents(mapped)
      } else {
        setResidents([])
        setOverviewResidents([])
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
      residents,
      now,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, residents, now])

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

  const slaOverdueTickets = useMemo(
    () =>
      openTickets
        .filter(isSlaOverdueOpenTicket)
        .sort((a, b) => {
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : 0
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : 0
          return aDue - bDue
        }),
    [openTickets],
  )

  const openEscalatedRailForTicket = useCallback((ticketId: string) => {
    setEscalatedRailTarget({ kind: 'ticket', ticketId })
    setEscalatedRailError(null)
  }, [])

  const openEscalatedRailForRun = useCallback((runId: string) => {
    setEscalatedRailTarget({ kind: 'workflow', runId })
    setEscalatedRailError(null)
  }, [])

  const lateRentReviewRuns = useMemo(
    () => (workflowData ? collectLateRentReviewRuns(workflowData) : []),
    [workflowData],
  )

  const openLateRentRail = useCallback((runId: string) => {
    setLateRentRailRunId(runId)
    setLateRentRailError(null)
  }, [])

  const closeLateRentRail = useCallback(() => {
    setLateRentRailRunId(null)
    setLateRentRailError(null)
  }, [])

  const openLeaseRenewalRail = useCallback((runId: string) => {
    setLeaseRenewalRailRunId(runId)
    setLeaseRenewalRailError(null)
  }, [])

  const closeLeaseRenewalRail = useCallback(() => {
    setLeaseRenewalRailRunId(null)
    setLeaseRenewalRailError(null)
  }, [])

  const lateRentReview = useMemo<LateRentAccountReview | null>(() => {
    if (!workflowData || !lateRentRailRunId) return null
    const row =
      lateRentReviewRuns.find((entry) => entry.id === lateRentRailRunId) ??
      workflowData.rentCollection.runs.find((entry) => entry.id === lateRentRailRunId)
    if (!row) return null
    const resident = row.residentId
      ? overviewResidents.find((entry) => entry.id === row.residentId) ?? null
      : null
    return buildLateRentAccountReview(row, resident)
  }, [workflowData, lateRentReviewRuns, lateRentRailRunId, overviewResidents])

  const leaseRenewalReview = useMemo<LeaseRenewalEscalatedReview | null>(() => {
    if (!workflowData || !leaseRenewalRailRunId) return null
    const run = workflowData.escalated.find((entry) => entry.id === leaseRenewalRailRunId)
    if (!run || !isLeaseRenewalEscalatedRun(run)) return null
    const resident = run.residentId
      ? overviewResidents.find((entry) => entry.id === run.residentId) ?? null
      : null
    return buildLeaseRenewalEscalatedReview(
      run,
      workflowData.runMetadata[run.id],
      resident ? { phone: resident.phone } : null,
    )
  }, [workflowData, leaseRenewalRailRunId, overviewResidents])

  const allAttentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const escalatedNoVendorKeys = new Set(
      (workflowData?.escalated ?? [])
        .filter((r) => isMaintenanceAdminVendorEscalationReason(r.escalationReason))
        .map((r) => r.entityId)
        .filter(Boolean),
    )

    for (const ticket of slaOverdueTickets) {
      if (escalatedNoVendorKeys.has(ticket.id)) continue
      const building =
        ticket.building ??
        units.find(
          (u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit),
        )?.building ??
        null
      items.push({
        key: `sla-${ticket.id}`,
        badge: isTicketCritical(ticket) ? 'critical' : 'warning',
        title: 'SLA breached — maintenance ticket',
        context: formatLocationContextLabel({
          propertyLabel: building,
          unitLabel: ticket.unit,
          residentName: ticket.residentName,
        }),
        meta: ticket.dueAt
          ? `Past due ${formatRelativeTime(ticket.dueAt)}`
          : 'Past SLA',
        actionLabel: 'Review',
        actionStyle: 'alert',
        onAction: () => openEscalatedRailForTicket(ticket.id),
      })
    }

    if (workflowData) {
      for (const run of workflowData.escalated) {
        const adminVendorReason = isMaintenanceAdminVendorEscalationReason(run.escalationReason)
          ? run.escalationReason
          : null
        const needsVendor = adminVendorReason != null
        const isLeaseRenewal = isLeaseRenewalEscalatedRun(run)
        items.push({
          key: `run-${run.id}`,
          badge: needsVendor || isLeaseRenewal ? 'critical' : 'warning',
          title: needsVendor
            ? maintenanceAdminVendorAttentionTitle(adminVendorReason)
            : isLeaseRenewal
              ? 'Lease Renewal Escalated'
              : `${run.templateName} Escalated`,
          context: formatLocationContextLabel({
            propertyLabel: run.propertyLabel,
            unitLabel: run.unitLabel,
            residentName: run.residentName,
          }),
          meta: run.lastEventAt
            ? needsVendor
              ? `Needs vendor onboarding ${formatRelativeTime(run.lastEventAt)}`
              : isLeaseRenewal
                ? `No tenant response ${formatRelativeTime(run.lastEventAt)}`
                : `Escalated ${formatRelativeTime(run.lastEventAt)}`
            : 'Awaiting input',
          actionLabel: needsVendor ? 'Assign vendor' : 'Review',
          actionTo: needsVendor ? '/admin/users' : undefined,
          onAction: needsVendor
            ? undefined
            : isLeaseRenewal
              ? () => openLeaseRenewalRail(run.id)
              : () => openEscalatedRailForRun(run.id),
          actionStyle: needsVendor ? 'alert' : undefined,
        })
      }

      for (const row of lateRentReviewRuns) {
        items.push({
          key: `rent-${row.id}`,
          badge: row.status === 'escalated' ? 'critical' : 'warning',
          title: 'Late Rent Escalation',
          context: formatLocationContextLabel({
            propertyLabel: row.propertyLabel,
            unitLabel: row.unitLabel,
            residentName: row.residentName,
          }),
          meta: row.rentDueDate
            ? `Overdue since ${new Date(row.rentDueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : 'Overdue',
          actionLabel: 'Review',
          onAction: () => openLateRentRail(row.id),
        })
      }
    }

    return items.sort((a, b) => (a.badge === b.badge ? 0 : a.badge === 'critical' ? -1 : 1))
  }, [workflowData, slaOverdueTickets, units, lateRentReviewRuns, openEscalatedRailForTicket, openEscalatedRailForRun, openLateRentRail, openLeaseRenewalRail])

  const attentionItems = useMemo(() => allAttentionItems.slice(0, 4), [allAttentionItems])

  const handleAwaitingDecisionItemAction = useCallback((item: AttentionItem) => {
    setAwaitingDecisionListOpen(false)
    item.onAction?.()
  }, [])

  useEffect(() => {
    if (!escalatedRailTarget) {
      setEscalatedReview(null)
      setEscalatedRailLoading(false)
      return
    }

    let cancelled = false
    let ticketIdForRecommend: string | null = null

    if (escalatedRailTarget.kind === 'ticket') {
      const ticket = tickets.find((t) => t.id === escalatedRailTarget.ticketId)
      if (!ticket) {
        setEscalatedReview(null)
        return
      }
      ticketIdForRecommend = ticket.id
      const review = buildSlaOverdueActionReview(
        overviewTicketToInput(ticket, units),
        vendors,
        vendorMetrics,
      )
      if (!review) {
        setEscalatedRailTarget(null)
        return
      }
      setEscalatedReview(review)
    } else {
      const run = workflowData?.escalated.find((r) => r.id === escalatedRailTarget.runId)
      if (!run) {
        setEscalatedReview(null)
        return
      }
      const linkedTicket =
        run.entityType === 'maintenance_request' && run.entityId
          ? tickets.find((t) => t.id === run.entityId) ?? null
          : null
      if (linkedTicket) ticketIdForRecommend = linkedTicket.id
      const review = buildEscalatedWorkflowReview(
        run,
        linkedTicket ? overviewTicketToInput(linkedTicket, units) : null,
        vendors,
        vendorMetrics,
      )
      if (!review) {
        setEscalatedRailTarget(null)
        return
      }
      setEscalatedReview(review)
    }

    setEscalatedRailLoading(true)

    const recommendUrl = resolveVendorRecommendAlternativesUrl()
    const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
    if (!recommendUrl || !secret || !ticketIdForRecommend) {
      setEscalatedRailLoading(false)
      return
    }

    void postRecommendVendorAlternatives({
      url: recommendUrl,
      secret,
      ticketId: ticketIdForRecommend,
      limit: 1,
    })
      .then((result) => {
        if (cancelled) return
        const alt = result.alternatives[0]
        if (escalatedRailTarget.kind === 'ticket') {
          const ticket = tickets.find((t) => t.id === escalatedRailTarget.ticketId)
          if (!ticket) return
          const next = buildSlaOverdueActionReview(
            overviewTicketToInput(ticket, units),
            vendors,
            vendorMetrics,
            alt ? { id: alt.id, name: alt.name } : null,
          )
          if (next) setEscalatedReview(next)
        } else {
          const run = workflowData?.escalated.find((r) => r.id === escalatedRailTarget.runId)
          if (!run) return
          const linkedTicket =
            run.entityType === 'maintenance_request' && run.entityId
              ? tickets.find((t) => t.id === run.entityId) ?? null
              : null
          const next = buildEscalatedWorkflowReview(
            run,
            linkedTicket ? overviewTicketToInput(linkedTicket, units) : null,
            vendors,
            vendorMetrics,
            alt ? { id: alt.id, name: alt.name } : null,
          )
          if (next) setEscalatedReview(next)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[admin overview] vendor alternatives', err)
      })
      .finally(() => {
        if (!cancelled) setEscalatedRailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [escalatedRailTarget, tickets, units, vendors, vendorMetrics, workflowData])

  const handleEscalatedTakeAction = useCallback(
    async (review: SlaOverdueActionReview) => {
      if (review.takeActionMode === 'workflows') {
        navigate(review.workflowRunId ? `/admin/workflows?run=${review.workflowRunId}` : '/admin/workflows')
        setEscalatedRailTarget(null)
        return
      }

      const suggestion = review.suggestion
      if (review.takeActionMode === 'assign_vendor' || !suggestion?.vendorName) {
        navigate('/admin/users')
        setEscalatedRailTarget(null)
        return
      }

      const reassignUrl = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
      const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
      if (!reassignUrl || !secret) {
        navigate('/admin/requests')
        setEscalatedRailTarget(null)
        return
      }

      setEscalatedRailSaving(true)
      setEscalatedRailError(null)
      try {
        await postAdminReassignVendor({
          url: reassignUrl,
          secret,
          ticketId: review.ticketId,
          vendorId: suggestion.vendorId,
          vendorName: suggestion.vendorName,
        })
        setTickets((prev) =>
          prev.map((t) =>
            t.id === review.ticketId
              ? {
                  ...t,
                  assignedVendorId: review.suggestion!.vendorId,
                  assignedVendorName: review.suggestion!.vendorName,
                  vendorWorkStatus: 'pending_accept',
                }
              : t,
          ),
        )
        setEscalatedRailTarget(null)
      } catch (err) {
        setEscalatedRailError(err instanceof Error ? err.message : 'Reassign failed')
      } finally {
        setEscalatedRailSaving(false)
      }
    },
    [navigate],
  )

  const handleLateRentAction = useCallback(
    async (action: LateRentAccountAction, review: LateRentAccountReview) => {
      setLateRentRailSaving(true)
      setLateRentRailError(null)
      try {
        const result = await applyLateRentAccountAction(action, review, getActiveLandlordId())
        if (!result.ok) {
          setLateRentRailError(result.error)
          return
        }

        if (action === 'mark_payment_received' && review.residentId) {
          setOverviewResidents((prev) =>
            prev.map((resident) =>
              resident.id === review.residentId
                ? { ...resident, balanceDue: 0 }
                : resident,
            ),
          )
        }

        const nextWorkflowData = await fetchAdminWorkflowDashboard()
        setWorkflowData(nextWorkflowData)
        closeLateRentRail()
      } catch (err) {
        setLateRentRailError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setLateRentRailSaving(false)
      }
    },
    [closeLateRentRail],
  )

  const handleLeaseRenewalAction = useCallback(
    async (action: LeaseRenewalEscalatedAction, review: LeaseRenewalEscalatedReview) => {
      setLeaseRenewalRailSaving(true)
      setLeaseRenewalRailError(null)
      try {
        const result = await applyLeaseRenewalEscalatedAction(action, review, getActiveLandlordId())
        if (!result.ok) {
          setLeaseRenewalRailError(result.error)
          return
        }

        if (action === 'mark_resolved' || action === 'snooze_1h') {
          setWorkflowData(await fetchAdminWorkflowDashboard())
          closeLeaseRenewalRail()
          return
        }

        if (action === 'call_tenant' && review.residentPhone) {
          window.location.href = `tel:${review.residentPhone.replace(/\D/g, '')}`
        }
      } catch (err) {
        setLeaseRenewalRailError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setLeaseRenewalRailSaving(false)
      }
    },
    [closeLeaseRenewalRail],
  )

  const criticalAttentionCount = allAttentionItems.filter(
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
                {allAttentionItems.length} operations{allAttentionItems.length === 1 ? '' : 's'}{' '}
                awaiting your decision
                {criticalAttentionCount > 0 ? ` · ${criticalAttentionCount} critical` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAwaitingDecisionListOpen(true)}
              disabled={loading || allAttentionItems.length === 0}
              className="shrink-0 cursor-pointer text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:text-[#0a0a0a] hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              View all →
            </button>
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
                  {item.onAction ? (
                    <button
                      type="button"
                      onClick={item.onAction}
                      className={[
                        'shrink-0 rounded-[10px] border px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                        item.actionStyle === 'alert'
                          ? 'border-transparent bg-[#f7e1e3] text-[#b22430] hover:bg-[#efd0d4]'
                          : 'border-black/10 bg-white text-tertiary hover:bg-[#e2f5f1]',
                      ].join(' ')}
                    >
                      {item.actionLabel} →
                    </button>
                  ) : (
                    <Link
                      to={item.actionTo ?? '/admin/workflows'}
                      className={[
                        'shrink-0 rounded-[10px] border px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                        item.actionStyle === 'alert'
                          ? 'border-transparent bg-[#f7e1e3] text-[#b22430] hover:bg-[#efd0d4]'
                          : 'border-black/10 bg-white text-tertiary hover:bg-[#e2f5f1]',
                      ].join(' ')}
                    >
                      {item.actionLabel} →
                    </Link>
                  )}
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

      {escalatedRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {escalatedRailError}
        </p>
      ) : null}

      {lateRentRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {lateRentRailError}
        </p>
      ) : null}

      {leaseRenewalRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {leaseRenewalRailError}
        </p>
      ) : null}

      <SlaOverdueActionRail
        open={escalatedRailTarget != null && escalatedReview != null}
        review={escalatedReview}
        loading={escalatedRailLoading}
        saving={escalatedRailSaving}
        onClose={() => {
          setEscalatedRailTarget(null)
          setEscalatedRailError(null)
        }}
        onTakeAction={handleEscalatedTakeAction}
      />

      <AwaitingDecisionListRail
        open={awaitingDecisionListOpen}
        items={allAttentionItems}
        criticalCount={criticalAttentionCount}
        onClose={() => setAwaitingDecisionListOpen(false)}
        onItemAction={handleAwaitingDecisionItemAction}
      />

      <LateRentAccountReviewRail
        open={lateRentRailRunId != null && lateRentReview != null}
        review={lateRentReview}
        saving={lateRentRailSaving}
        onClose={closeLateRentRail}
        onAction={(action, review) => void handleLateRentAction(action, review)}
      />

      <LeaseRenewalEscalatedRail
        open={leaseRenewalRailRunId != null && leaseRenewalReview != null}
        review={leaseRenewalReview}
        saving={leaseRenewalRailSaving}
        onClose={closeLeaseRenewalRail}
        onAction={(action, review) => void handleLeaseRenewalAction(action, review)}
      />
    </main>
  )
}
