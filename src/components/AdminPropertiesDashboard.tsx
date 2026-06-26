import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { deleteLandlordBuildings } from '@/lib/landlordOnboarding'
import {
  buildPropertyHealthReport,
  countPortfolioBuildings,
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

type PropertyTicket = {
  id: string
  createdAt: string
  urgency: string
  vendorWorkStatus: string
  unit: string
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

function normalizeUnitLabel(label: string): string {
  return label.toLowerCase().replace(/^unit\s+/, '').trim()
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

export function AdminPropertiesDashboard() {
  const [tickets, setTickets] = useState<PropertyTicket[]>([])
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedBuildings, setSelectedBuildings] = useState<Set<string>>(() => new Set())
  const [deleteBuildingsSaving, setDeleteBuildingsSaving] = useState(false)
  const [deleteBuildingsError, setDeleteBuildingsError] = useState<string | null>(null)

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
        'id, created_at, unit, unit_id, building, issue_category, assigned_vendor_id, vendor_work_status, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
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

    const [unitsResult, healthSignals] = await Promise.all([
      supabase
        .from('units')
        .select('id, unit_label, building, status')
        .eq('landlord_id', landlordId)
        .limit(1000),
      fetchPropertyHealthSignals(),
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
      now,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, now])

  const monthlySpendByBuilding = useMemo(() => {
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const spendByUnitLabel = new Map<string, number>()
    for (const t of tickets) {
      const key = normalizeUnitLabel(t.unit)
      if (!key) continue
      const ts = new Date(t.createdAt).getTime()
      if (Number.isNaN(ts) || ts < thirtyDaysAgo) continue
      spendByUnitLabel.set(key, (spendByUnitLabel.get(key) ?? 0) + ticketCostEstimate(t))
    }

    const byBuilding = new Map<string, number>()
    for (const unit of units) {
      const building = unit.building ?? 'Portfolio'
      const spend = spendByUnitLabel.get(normalizeUnitLabel(unit.unitLabel)) ?? 0
      byBuilding.set(building, (byBuilding.get(building) ?? 0) + spend)
    }
    return byBuilding
  }, [units, tickets, now])

  const kpis = useMemo(() => {
    const healthTickets = mapTicketsForPropertyHealth(
      tickets as unknown as Record<string, unknown>[],
    )
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    const buildings = countPortfolioBuildings(healthUnits, pmTasks, healthTickets)
    const totalUnits = units.length

    const trackedUnits = units.filter((u) => u.status !== 'inactive')
    const activeUnits = trackedUnits.filter((u) => u.status === 'active').length
    const avgOccupancy = trackedUnits.length
      ? Math.round((activeUnits / trackedUnits.length) * 100)
      : null

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
  }, [units, tickets, pmTasks, healthReport, now, fourWeeksMs])

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

  const visibleBuildings = healthReport.buildings
  const selectedBuildingCount = selectedBuildings.size
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
        <div
          title={healthKpiTooltip}
          aria-label={healthKpiTooltip}
        >
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

      {deleteBuildingsError ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          Could not delete selected properties: {deleteBuildingsError}
        </div>
      ) : null}

      {selectedBuildingCount > 0 ? (
        <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
            <span className="font-medium">{selectedBuildingCount}</span>
            {selectedBuildingCount === 1 ? ' property selected' : ' properties selected'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedBuildings(new Set())}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={deleteBuildingsSaving}
              onClick={() => void deleteSelectedBuildings()}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteBuildingsSaving ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
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
        }}
        headerAction={
          <Link
            to="/admin/users"
            className="shrink-0 rounded-[10px] border border-black/10 bg-white px-4 py-2 text-[13px] font-medium leading-5 text-tertiary transition-colors duration-150 hover:bg-[#e2f5f1]"
          >
            Add Properties
          </Link>
        }
      />
    </main>
  )
}

export default AdminPropertiesDashboard
