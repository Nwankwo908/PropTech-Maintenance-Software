import { isDemoAccountActive } from '@/lib/activeLandlord'
import type { RecognizedMaintenanceSpend } from '@/api/maintenanceInvoice'
import type { PmComplianceSummary, PmComplianceTask } from '@/lib/pmCompliance'
import { summarizePmComplianceTasks } from '@/lib/pmCompliance'
import { filterTicketsForBuildingScope, normalizeBuildingKey, type PropertyHealthUnit } from '@/lib/propertyHealth'

export type PropertyMonthlySpend = {
  monthIndex: number
  label: string
  proactive: number
  reactive: number
  isFuture: boolean
  isProjection: boolean
}

export type PropertyAnalyticsTicket = {
  id: string
  createdAt: string
  completedAt: string | null
  urgency: string
  vendorWorkStatus: string
  estimatedMinutes: number | null
  unit: string
  unitId: string | null
  building: string | null
  totalCost: number | null
}

export type PropertyAnalyticsSnapshot = {
  ytdTotal: number
  ytdProactive: number
  ytdReactive: number
  mtdTotal: number
  monthlySpend: PropertyMonthlySpend[]
  pm: PmComplianceSummary
  insight: string
}

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
] as const

const CHART_Y_MAX = 5000

/** Fallback MTD when demo DB has not been re-seeded (matches seed_demo_maintenance_spend.sql). */
const DEMO_MTD_BY_BUILDING: Record<string, { total: number; reactive: number }> = {
  'oakwood apartments': { total: 920, reactive: 645 },
  'birch tower': { total: 1307, reactive: 1307 },
  'maple heights': { total: 329, reactive: 0 },
  'pine ridge': { total: 238, reactive: 0 },
  'cedar court': { total: 0, reactive: 0 },
  'willow park': { total: 1144, reactive: 1144 },
}

function demoMtdForBuilding(building: string): { total: number; reactive: number } | null {
  if (!isDemoAccountActive()) return null
  const key = normalizeBuildingKey(building).toLowerCase()
  return DEMO_MTD_BY_BUILDING[key] ?? null
}

function withDemoMtdFallback(building: string, amount: number): number {
  if (amount > 0) return amount
  return demoMtdForBuilding(building)?.total ?? 0
}

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
  const total = Math.round(900 + seededUnit(totalSeed) * 1400)
  const reactiveShare = 0.22 + seededUnit(splitSeed) * 0.38
  const reactive = Math.round(total * reactiveShare)
  return { proactive: total - reactive, reactive }
}

function averageMonthProjection(
  actualMonths: PropertyMonthlySpend[],
): { proactive: number; reactive: number } {
  const withSpend = actualMonths.filter((month) => month.proactive + month.reactive > 0)
  if (!withSpend.length) {
    return { proactive: 650, reactive: 350 }
  }
  const proactive = Math.round(
    withSpend.reduce((sum, month) => sum + month.proactive, 0) / withSpend.length,
  )
  const reactive = Math.round(
    withSpend.reduce((sum, month) => sum + month.reactive, 0) / withSpend.length,
  )
  return { proactive, reactive }
}

function ticketSpendAmount(ticket: PropertyAnalyticsTicket): number {
  if (ticket.totalCost != null && ticket.totalCost > 0) return ticket.totalCost
  return (ticket.estimatedMinutes ?? 240) * 1.25
}

function ticketSpendDate(ticket: PropertyAnalyticsTicket): number {
  const completed = ticket.completedAt ? new Date(ticket.completedAt).getTime() : NaN
  if (!Number.isNaN(completed)) return completed
  return new Date(ticket.createdAt).getTime()
}

function isReactiveUrgency(urgency: string): boolean {
  const value = urgency.toLowerCase()
  return value === 'urgent' || value === 'high' || value === 'emergency'
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function spendFromRecognized(
  rows: RecognizedMaintenanceSpend[],
  ticketIds: Set<string>,
  fromMs: number,
  toMs: number,
  reactive?: boolean,
): number {
  return rows.reduce((sum, row) => {
    if (!ticketIds.has(row.maintenance_request_id)) return sum
    const at = new Date(row.spend_date).getTime()
    if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
    const rowReactive = row.spend_class === 'reactive'
    if (reactive != null && rowReactive !== reactive) return sum
    return sum + row.total_cost
  }, 0)
}

function spendFromCompletedTickets(
  tickets: PropertyAnalyticsTicket[],
  fromMs: number,
  toMs: number,
  reactive?: boolean,
): number {
  return tickets.reduce((sum, ticket) => {
    if (ticket.vendorWorkStatus !== 'completed') return sum
    const at = ticketSpendDate(ticket)
    if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
    const rowReactive = isReactiveUrgency(ticket.urgency)
    if (reactive != null && rowReactive !== reactive) return sum
    return sum + ticketSpendAmount(ticket)
  }, 0)
}

function spendBetween(
  recognized: RecognizedMaintenanceSpend[],
  tickets: PropertyAnalyticsTicket[],
  ticketIds: Set<string>,
  fromMs: number,
  toMs: number,
  reactive?: boolean,
): number {
  const scoped = tickets.filter((ticket) => ticketIds.has(ticket.id))
  const recognizedTotal = spendFromRecognized(recognized, ticketIds, fromMs, toMs, reactive)
  if (recognizedTotal > 0) return Math.round(recognizedTotal)
  return Math.round(spendFromCompletedTickets(scoped, fromMs, toMs, reactive))
}

export function monthToDateWindow(nowMs: number = Date.now()): { fromMs: number; toMs: number } {
  const now = new Date(nowMs)
  return {
    fromMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    toMs: nowMs,
  }
}

/** Month-to-date maintenance spend for one property (matches Analytics tab MTD). */
export function computePropertyMtdSpend(input: {
  buildingTicketIds: Set<string>
  tickets: PropertyAnalyticsTicket[]
  recognizedSpend: RecognizedMaintenanceSpend[]
  nowMs?: number
}): number {
  const { fromMs, toMs } = monthToDateWindow(input.nowMs)
  return spendBetween(
    input.recognizedSpend,
    input.tickets,
    input.buildingTicketIds,
    fromMs,
    toMs,
  )
}

/** MTD maintenance spend keyed by building — same logic as property Analytics tab. */
export function buildMonthlySpendByBuilding(input: {
  buildings: string[]
  tickets: PropertyAnalyticsTicket[]
  units: PropertyHealthUnit[]
  recognizedSpend: RecognizedMaintenanceSpend[]
  nowMs?: number
}): Map<string, number> {
  const { fromMs, toMs } = monthToDateWindow(input.nowMs)
  const byBuilding = new Map<string, number>()

  for (const building of input.buildings) {
    const scoped = filterTicketsForBuildingScope(input.tickets, building, input.units)
    const ticketIds = new Set(scoped.map((ticket) => ticket.id))
    byBuilding.set(
      building,
      withDemoMtdFallback(
        building,
        spendBetween(input.recognizedSpend, scoped, ticketIds, fromMs, toMs),
      ),
    )
  }

  return byBuilding
}

/** Property-scoped maintenance spend chart + PM compliance inputs. */
export function buildPropertyAnalytics(input: {
  building: string
  buildingTicketIds: Set<string>
  tickets: PropertyAnalyticsTicket[]
  recognizedSpend: RecognizedMaintenanceSpend[]
  pmTasks: PmComplianceTask[]
}): PropertyAnalyticsSnapshot {
  const now = Date.now()
  const year = new Date().getFullYear()
  const startOfYear = new Date(year, 0, 1).getTime()
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const currentMonthIndex = new Date().getMonth()

  const scopedTickets = input.tickets.filter((ticket) => input.buildingTicketIds.has(ticket.id))
  const pm = summarizePmComplianceTasks(input.pmTasks)

  const ytdTotal = spendBetween(
    input.recognizedSpend,
    scopedTickets,
    input.buildingTicketIds,
    startOfYear,
    now,
  )
  const ytdProactive = spendBetween(
    input.recognizedSpend,
    scopedTickets,
    input.buildingTicketIds,
    startOfYear,
    now,
    false,
  )
  const ytdReactive = spendBetween(
    input.recognizedSpend,
    scopedTickets,
    input.buildingTicketIds,
    startOfYear,
    now,
    true,
  )
  const mtdTotal = withDemoMtdFallback(
    input.building,
    spendBetween(
      input.recognizedSpend,
      scopedTickets,
      input.buildingTicketIds,
      startOfMonth,
      now,
    ),
  )

  const actualMonthlySpend: PropertyMonthlySpend[] = MONTH_LABELS.map((label, monthIndex) => {
    const monthStart = new Date(year, monthIndex, 1).getTime()
    const monthEnd = new Date(year, monthIndex + 1, 1).getTime()
    const isFuture = monthIndex > currentMonthIndex
    let proactive = isFuture
      ? 0
      : spendBetween(
          input.recognizedSpend,
          scopedTickets,
          input.buildingTicketIds,
          monthStart,
          monthEnd,
          false,
        )
    let reactive = isFuture
      ? 0
      : spendBetween(
          input.recognizedSpend,
          scopedTickets,
          input.buildingTicketIds,
          monthStart,
          monthEnd,
          true,
        )
    if (!isFuture && monthIndex === currentMonthIndex && proactive + reactive === 0) {
      const demo = demoMtdForBuilding(input.building)
      if (demo) {
        reactive = demo.reactive
        proactive = demo.total - demo.reactive
      }
    }
    return {
      monthIndex,
      label,
      proactive,
      reactive,
      isFuture,
      isProjection: false,
    }
  })

  const useDemoProjections = isDemoAccountActive()
  const averageProjection = averageMonthProjection(actualMonthlySpend)
  const monthlySpend = actualMonthlySpend.map((month) => {
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

  const reactiveMultiple =
    ytdProactive > 0 ? Math.round((ytdReactive / ytdProactive) * 10) / 10 : null
  const buildingShort = input.building.replace(/\s+Apartments$/i, '').trim()

  const insight =
    reactiveMultiple != null && reactiveMultiple >= 2
      ? `Reactive costs at ${buildingShort} are ${reactiveMultiple}x proactive YTD. Closing overdue preventive tasks could reduce emergency spend this quarter.`
      : ytdTotal > 0
        ? `${buildingShort} YTD maintenance is ${formatSpend(ytdTotal)} (${formatSpend(ytdProactive)} proactive · ${formatSpend(ytdReactive)} reactive).`
        : pm.totalTasks > 0
          ? `${buildingShort} has ${pm.totalTasks} preventive task${pm.totalTasks === 1 ? '' : 's'} tracked — spend appears as vendor invoices are approved.`
          : 'Maintenance spend and PM compliance populate as work is completed and preventive tasks are scheduled.'

  return {
    ytdTotal,
    ytdProactive,
    ytdReactive,
    mtdTotal,
    monthlySpend,
    pm,
    insight,
  }
}

export const PROPERTY_CHART_Y_MAX = CHART_Y_MAX
export const PROPERTY_CHART_Y_TICKS = [5000, 4000, 3000, 2000, 1000, 0] as const
export const PROPERTY_CHART_BAR_AREA_PX = 224

export function formatPropertyChartYTick(amount: number): string {
  if (amount === 0) return '$0'
  return `$${amount / 1000}k`
}

export function formatPropertySpendCompact(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(amount)
    .replace('K', 'k')
}
