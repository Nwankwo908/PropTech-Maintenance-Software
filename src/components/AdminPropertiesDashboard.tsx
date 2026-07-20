import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { deleteLandlordBuildings } from '@/lib/landlordOnboarding'
import {
  buildPropertyHealthReport,
  computeOccupancyStats,
  countPortfolioBuildings,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  PROPERTY_HEALTH_KPI_CAPTION,
  propertyHealthFactorBreakdownLines,
  type PropertyHealthFeedback,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import { fetchRecognizedMaintenanceSpend, type RecognizedMaintenanceSpend } from '@/api/maintenanceInvoice'
import { buildMonthlySpendByBuilding, type PropertyAnalyticsTicket } from '@/lib/propertyAnalytics'
import { buildingDetailPath } from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'

type PropertyTicket = {
  id: string
  createdAt: string
  urgency: string
  vendorWorkStatus: string
  unit: string
  unitId: string | null
  building: string | null
  email: string | null
  issueCategory: string | null
  assignedVendorId: string | null
  estimatedMinutes: number | null
  totalCost: number | null
  completedAt: string | null
}

type PropertyUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
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
 * total column; otherwise sums labor + materials + tax. Null when not invoiced.
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

function normalizeTicketRow(raw: Record<string, unknown>): PropertyTicket {
  return {
    id: asString(raw.id),
    createdAt: asString(raw.created_at),
    urgency: (
      asString(raw.urgency) ||
      asString(raw.severity) ||
      asString(raw.priority)
    ).toLowerCase(),
    vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
    unit: asString(raw.unit),
    unitId: asString(raw.unit_id) || null,
    building: asString(raw.building) || null,
    email: asString(raw.email) || null,
    issueCategory: asString(raw.issue_category) || null,
    assignedVendorId: asString(raw.assigned_vendor_id) || null,
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

/** Cost proxy: estimated_minutes × $1.25/min, defaulting to 240 minutes. */
function ticketCostEstimate(ticket: PropertyTicket): number {
  return (ticket.estimatedMinutes ?? 240) * 1.25
}

/** Real extracted invoice total when available, else the estimate proxy. */
function ticketSpend(ticket: PropertyTicket): number {
  return ticket.totalCost ?? ticketCostEstimate(ticket)
}

/** Date a job's spend should attribute to (completion date, else created). */
function ticketSpendDate(ticket: PropertyTicket): number {
  const completed = ticket.completedAt ? new Date(ticket.completedAt).getTime() : NaN
  if (!Number.isNaN(completed)) return completed
  return new Date(ticket.createdAt).getTime()
}

function isCompletedJob(ticket: PropertyTicket): boolean {
  return ticket.vendorWorkStatus === 'completed'
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
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

/** Signed abbreviated currency for a delta pill, e.g. "+$1.2k" / "-$340". */
function formatSignedSpend(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  return `${sign}${formatSpendCompact(Math.abs(amount))}`
}

/** "Updated 11:17 AM" same-day, "Updated yesterday", or "Updated Jun 11". */
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

function KpiInfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5 text-[#9ca3af]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v5M12 8h.01" strokeLinecap="round" />
    </svg>
  )
}

function KpiBreakdownInfo({
  title,
  description,
  lines,
}: {
  title: string
  description?: string
  lines: Array<{ label: string; count?: number; value?: string; detail?: string }>
}) {
  if (!lines.length) return null

  return (
    <span className="group/kpi-info relative inline-flex shrink-0">
      <button
        type="button"
        tabIndex={0}
        className="inline-flex rounded p-0.5 outline-none hover:text-[#4b5563] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
        aria-label={`${title} breakdown`}
      >
        <KpiInfoIcon />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-[min(280px,calc(100vw-2rem))] rounded-[10px] border border-[#e5e7eb] bg-white p-3 opacity-0 shadow-[0px_8px_24px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/kpi-info:opacity-100 group-focus-within/kpi-info:opacity-100"
      >
        <p className="text-[11px] font-semibold leading-4 text-[#0a0a0a]">{title}</p>
        {description ? (
          <p className="mt-1 text-[10px] leading-[14px] text-[#6a7282]">{description}</p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => {
            const displayValue =
              line.value ?? (line.count != null ? String(line.count) : null)
            return (
              <li key={line.label} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
                  <span className="text-[#364153]">{line.label}</span>
                  {displayValue != null ? (
                    <span className="shrink-0 font-semibold tabular-nums text-[#0a0a0a]">
                      {displayValue}
                    </span>
                  ) : null}
                </div>
                {line.detail ? (
                  <p className="text-[10px] leading-[13px] text-[#9ca3af]">{line.detail}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </span>
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
  infoTitle,
  infoDescription,
  infoLines,
}: {
  label: string
  value: string
  delta: number | null
  deltaSuffix?: string
  deltaFormatter?: (delta: number) => string
  goodWhenUp?: boolean
  caption: string
  infoTitle?: string
  infoDescription?: string
  infoLines?: Array<{ label: string; count?: number; value?: string; detail?: string }>
}) {
  const positive = (delta ?? 0) > 0
  const neutral = delta === 0
  const good = neutral ? false : positive === goodWhenUp
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          {label}
        </p>
        {infoLines?.length ? (
          <KpiBreakdownInfo
            title={infoTitle ?? label}
            description={infoDescription}
            lines={infoLines}
          />
        ) : null}
      </div>
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

export function AdminPropertiesDashboard() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState<PropertyTicket[]>([])
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [residents, setResidents] = useState<PropertyHealthResident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedBuildings, setSelectedBuildings] = useState<Set<string>>(() => new Set())
  const [deleteBuildingsSaving, setDeleteBuildingsSaving] = useState(false)
  const [deleteBuildingsError, setDeleteBuildingsError] = useState<string | null>(null)
  const [recognizedSpend, setRecognizedSpend] = useState<RecognizedMaintenanceSpend[]>([])

  const loadProperties = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured — connect a project to see live property data.')
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    const enrichedTickets = await supabase
      .from('maintenance_request_enriched')
      .select(
        'id, created_at, unit, unit_id, building, email, issue_category, assigned_vendor_id, vendor_work_status, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(500)

    const ticketsResult =
      enrichedTickets.error == null
        ? enrichedTickets
        : await supabase
            .from('maintenance_requests')
            .select('*')
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(500)

    const [unitsResult, healthSignals, residentsResult, recognizedSpendResult] = await Promise.all([
      supabase
        .from('units')
        .select('id, unit_label, building, status')
        .eq('landlord_id', landlordId)
        .limit(1000),
      fetchPropertyHealthSignals(),
      supabase
        .from('users')
        .select('id, full_name, unit, building, status, email')
        .eq('landlord_id', landlordId)
        .neq('status', 'past_resident')
        .limit(2000),
      fetchRecognizedMaintenanceSpend(),
    ])

    if (!ticketsResult.error) {
      setTickets(
        ((ticketsResult.data ?? []) as Record<string, unknown>[]).map(normalizeTicketRow),
      )
    } else {
      console.error(
        '[admin properties] maintenance requests fetch failed',
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
    } else {
      console.error('[admin properties] units fetch failed', unitsResult.error.message)
    }

    setPmTasks(healthSignals.pmTasks)
    setFeedback(healthSignals.feedback)
    setVendorMetrics(healthSignals.vendorMetrics)
    setRecognizedSpend(recognizedSpendResult ?? [])

    if (!residentsResult.error) {
      setResidents(
        ((residentsResult.data ?? []) as Record<string, unknown>[])
          .map((raw) => ({
            id: asString(raw.id),
            fullName: asString(raw.full_name) || 'Unnamed resident',
            unit: asString(raw.unit),
            building: asString(raw.building) || null,
            status: asString(raw.status).toLowerCase() || 'active',
            email: asString(raw.email) || null,
          }))
          .filter((row) => row.id),
      )
    } else {
      setResidents([])
    }

    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadProperties()
  }, [loadProperties])

  const now = Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

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

  const monthlySpendByBuilding = useMemo(() => {
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    const unitBuildingById = new Map(
      healthUnits.map((unit) => [unit.id, unit.building] as const),
    )
    const analyticsTickets: PropertyAnalyticsTicket[] = tickets.map((ticket) => {
      const building =
        ticket.building?.trim() ||
        (ticket.unitId ? unitBuildingById.get(ticket.unitId) ?? null : null)
      return {
        id: ticket.id,
        createdAt: ticket.createdAt,
        completedAt: ticket.completedAt,
        urgency: ticket.urgency,
        vendorWorkStatus: ticket.vendorWorkStatus,
        estimatedMinutes: ticket.estimatedMinutes,
        unit: ticket.unit,
        unitId: ticket.unitId,
        building,
        totalCost: ticket.totalCost,
      }
    })
    return buildMonthlySpendByBuilding({
      buildings: healthReport.buildings.map((row) => row.building),
      tickets: analyticsTickets,
      units: healthUnits,
      recognizedSpend,
      nowMs: now,
    })
  }, [healthReport.buildings, units, tickets, recognizedSpend, now])

  const kpis = useMemo(() => {
    const healthTickets = mapTicketsForPropertyHealth(
      tickets as unknown as Record<string, unknown>[],
    )
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    const buildings = countPortfolioBuildings(
      healthUnits,
      pmTasks,
      healthTickets,
      getActiveLandlordId(),
      residents,
    )
    const totalUnits = units.length

    const trackedUnits = healthUnits.filter((u) => u.status !== 'inactive')
    const occupancy = computeOccupancyStats(healthUnits, residents)
    const avgOccupancy = trackedUnits.length ? occupancy.occupancyPct : null

    const propertyHealth = healthReport.portfolio?.score ?? null
    const propertyHealthDelta = healthReport.portfolioDelta

    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime()
    const completedJobs = tickets.filter(isCompletedJob)
    const spendBetween = (fromMs: number, toMs: number): number =>
      completedJobs.reduce((sum, t) => {
        const at = ticketSpendDate(t)
        if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
        return sum + ticketSpend(t)
      }, 0)
    const ytdMaintenanceCost = Math.round(spendBetween(startOfYear, now))
    const ytdMaintenanceCostDelta = Math.round(
      spendBetween(now - fourWeeksMs, now) -
        spendBetween(now - 2 * fourWeeksMs, now - fourWeeksMs),
    )

    return {
      buildings,
      totalUnits,
      avgOccupancy,
      propertyHealth,
      propertyHealthDelta,
      ytdMaintenanceCost,
      ytdMaintenanceCostDelta,
    }
  }, [units, tickets, pmTasks, healthReport, residents, now, fourWeeksMs])

  const updatedCaption =
    loading || !lastUpdated ? 'Updating…' : formatUpdatedAt(lastUpdated)
  const portfolioPendingSetup = healthReport.portfolio?.status === 'pending_setup'
  const healthKpiCaption = healthReport.portfolio
    ? portfolioPendingSetup
      ? 'Units are inactive — activate units to measure portfolio health.'
      : PROPERTY_HEALTH_KPI_CAPTION
    : updatedCaption
  const healthFactorBreakdown =
    !loading && healthReport.portfolio && !portfolioPendingSetup
      ? propertyHealthFactorBreakdownLines(healthReport.portfolio.components)
      : undefined
  const healthKpiValue =
    loading || !healthReport.portfolio
      ? '—'
      : portfolioPendingSetup
        ? 'Pending'
        : `${healthReport.portfolio.score}%`

  const visibleBuildings = healthReport.buildings
  const allVisibleBuildingsSelected =
    visibleBuildings.length > 0 &&
    visibleBuildings.every((building) => selectedBuildings.has(building.building))
  const someVisibleBuildingsSelected =
    visibleBuildings.some((building) => selectedBuildings.has(building.building)) &&
    !allVisibleBuildingsSelected

  function toggleBuildingSelected(building: string) {
    setSelectedBuildings((prev) => {
      const next = new Set(prev)
      if (next.has(building)) next.delete(building)
      else next.add(building)
      return next
    })
  }

  function toggleAllVisibleBuildingsSelected() {
    setSelectedBuildings((prev) => {
      const next = new Set(prev)
      if (allVisibleBuildingsSelected) {
        for (const building of visibleBuildings) next.delete(building.building)
      } else {
        for (const building of visibleBuildings) next.add(building.building)
      }
      return next
    })
  }

  async function deleteSelectedBuildings() {
    if (selectedBuildings.size === 0) return

    setDeleteBuildingsError(null)
    setDeleteBuildingsSaving(true)

    const result = await deleteLandlordBuildings(Array.from(selectedBuildings))
    if (!result.ok) {
      setDeleteBuildingsError(result.error ?? 'Delete failed.')
      setDeleteBuildingsSaving(false)
      return
    }

    setSelectedBuildings(new Set())
    setDeleteBuildingsSaving(false)
    await loadProperties()
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Properties
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Monitor the health, performance, and activity of every property in one place.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Buildings"
          value={loading ? '—' : String(kpis.buildings)}
          delta={null}
          caption={updatedCaption}
        />
        <KpiCard
          label="Total units"
          value={loading ? '—' : String(kpis.totalUnits)}
          delta={null}
          caption={updatedCaption}
        />
        <KpiCard
          label="Avg occupancy"
          value={
            loading || kpis.avgOccupancy == null ? '—' : `${kpis.avgOccupancy}%`
          }
          delta={null}
          caption={updatedCaption}
        />
        <KpiCard
          label="Property Health"
          value={healthKpiValue}
          delta={loading || portfolioPendingSetup ? null : kpis.propertyHealthDelta}
          deltaSuffix="%"
          goodWhenUp
          caption={healthKpiCaption}
          infoTitle="Property health factors"
          infoDescription="Breakdown of the six factors that contribute to this portfolio score. Weaker factors appear first so you can see what affected it most."
          infoLines={healthFactorBreakdown}
        />
        <KpiCard
          label="YTD Maintenance Cost"
          value={loading ? '—' : formatSpendCompact(kpis.ytdMaintenanceCost)}
          delta={loading ? null : kpis.ytdMaintenanceCostDelta}
          deltaFormatter={formatSignedSpend}
          caption={updatedCaption}
        />
      </div>

      {deleteBuildingsError ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          Could not delete selected properties: {deleteBuildingsError}
        </div>
      ) : null}

      <PropertyHealthBuildingGrid
        className="mt-4"
        loading={loading}
        buildings={healthReport.buildings}
        totalUnits={kpis.totalUnits}
        showMonthlySpend
        formatSpend={formatSpend}
        monthlySpendByBuilding={monthlySpendByBuilding}
        selection={{
          selectedBuildings,
          onToggleBuilding: toggleBuildingSelected,
          allSelected: allVisibleBuildingsSelected,
          someSelected: someVisibleBuildingsSelected,
          onToggleAll: toggleAllVisibleBuildingsSelected,
          onClearSelection: () => setSelectedBuildings(new Set()),
          onDeleteSelected: () => void deleteSelectedBuildings(),
          deleteSelectedSaving: deleteBuildingsSaving,
        }}
        onBuildingOpen={(building) => navigate(buildingDetailPath(building))}
        headerAction={
          <Link
            to="/admin/users"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-black/10 bg-white px-4 py-2 text-[13px] font-medium leading-5 text-[#6a7282] transition-colors duration-150 hover:bg-[#e2f5f1]"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-3.5 shrink-0">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
            Add Properties
          </Link>
        }
      />
    </main>
  )
}

export default AdminPropertiesDashboard
