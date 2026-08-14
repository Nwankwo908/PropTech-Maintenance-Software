import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import type { AdminWorkflowDashboardData, AdminWorkflowRow } from '@/lib/adminWorkflows'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'

export type PropertyUnitResident = {
  id: string
  fullName: string
  unit: string
  building: string | null
  status: string
  email?: string | null
  balanceDue: number
  leaseEndDate: string | null
}

export type PropertyUnitRecord = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

export type PropertyUnitTicket = {
  id: string
  unit: string
  building: string | null
  issueCategory: string | null
  urgency: string
  vendorWorkStatus: string
}

export type PropertyUnitOccupancyStatus = 'occupied' | 'vacant' | 'under_maintenance'

export type PropertyUnitRow = {
  id: string
  unitDisplay: string
  residentId: string | null
  residentName: string | null
  occupancyStatus: PropertyUnitOccupancyStatus
  openWorkflowLabel: string | null
  balanceDue: number
  leaseEndLabel: string | null
  sortKey: number
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])
const OCCUPYING_RESIDENT_STATUSES = new Set(['active', 'pending', 'suspended'])

function unitSortKey(label: string): number {
  const digits = label.replace(/\D/g, '')
  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

export function formatPropertyUnitDisplay(unitLabel: string): string {
  const trimmed = unitLabel.trim()
  if (!trimmed) return '—'
  if (/^unit\s+/i.test(trimmed)) return trimmed.replace(/^unit\s+/i, 'Unit ')
  return `Unit ${trimmed}`
}

export function formatPropertyLeaseEnd(value: string | null): string | null {
  if (!value?.trim()) return null
  const date = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** Persisted `units.status` is the source of truth for the Units tab chip. */
export function resolvePropertyUnitOccupancyStatus(
  unitStatus: string | null | undefined,
): PropertyUnitOccupancyStatus {
  const status = (unitStatus ?? '').trim().toLowerCase()
  if (status === 'active') return 'occupied'
  if (status === 'under_maintenance') return 'under_maintenance'
  return 'vacant'
}

function isOpenTicket(ticket: PropertyUnitTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

function ticketMatchesUnit(ticket: PropertyUnitTicket, unitLabel: string, building: string): boolean {
  const unitKey = normalizeUnitLabel(unitLabel)
  const ticketUnitKey = normalizeUnitLabel(ticket.unit)
  if (ticketUnitKey && ticketUnitKey === unitKey) return true
  if (ticket.building && normalizeBuildingKey(ticket.building) === normalizeBuildingKey(building)) {
    return ticketUnitKey === unitKey
  }
  return false
}

function workflowMatchesUnit(row: AdminWorkflowRow, unitLabel: string, building: string): boolean {
  if (normalizeBuildingKey(row.propertyLabel) !== normalizeBuildingKey(building)) return false
  if (!row.unitLabel?.trim()) return false
  return normalizeUnitLabel(row.unitLabel) === normalizeUnitLabel(unitLabel)
}

function formatIssueCategoryLabel(category: string, urgency: string): string {
  const label = formatVendorTradeLabel(category, { emptyLabel: '' })
  const isEmergency = urgency === 'emergency' || urgency === 'critical'
  if (!label) return isEmergency ? 'Emergency maintenance' : 'Maintenance issue'
  if (isEmergency) return `Emergency ${label.toLowerCase()}`
  if (label.toLowerCase().endsWith('issue')) return label
  return `${label} issue`
}

function formatWorkflowCategoryLabel(category: WorkflowKanbanCategory, templateId: string): string {
  if (templateId === 'rent_collection') return 'Rent question'
  if (category === 'lease') return 'Lease renewal'
  if (category === 'move_in') return 'Move-in pending'
  if (category === 'move_out') return 'Move-out pending'
  if (category === 'inspection') return 'Inspection scheduled'
  if (category === 'payment') return 'Payment follow-up'
  if (category === 'maintenance') return 'Maintenance workflow'
  return 'Open workflow'
}

function pickOpenWorkflowLabel(
  unitLabel: string,
  building: string,
  tickets: PropertyUnitTicket[],
  workflowRows: AdminWorkflowRow[],
): string | null {
  const openTickets = tickets
    .filter(isOpenTicket)
    .filter((ticket) => ticketMatchesUnit(ticket, unitLabel, building))
    .sort((a, b) => {
      const aEmergency = a.urgency === 'emergency' ? 0 : 1
      const bEmergency = b.urgency === 'emergency' ? 0 : 1
      return aEmergency - bEmergency
    })

  if (openTickets.length > 0) {
    const ticket = openTickets[0]
    return formatIssueCategoryLabel(ticket.issueCategory ?? 'maintenance', ticket.urgency)
  }

  const openWorkflows = workflowRows
    .filter((row) => workflowMatchesUnit(row, unitLabel, building))
    .filter((row) => row.status !== 'cancelled' && row.status !== 'completed')
    .map((row) => ({ row, card: buildWorkflowKanbanCard(row) }))
    .filter(({ card }) => isOpenWorkflowKanbanCard(card))
    .sort((a, b) => {
      if (a.card.critical !== b.card.critical) return a.card.critical ? -1 : 1
      return new Date(b.row.startedAt).getTime() - new Date(a.row.startedAt).getTime()
    })

  if (openWorkflows.length > 0) {
    const { row, card } = openWorkflows[0]
    return formatWorkflowCategoryLabel(card.category, row.templateId)
  }

  return null
}

function findResidentForUnit(
  unitLabel: string,
  building: string,
  residents: PropertyUnitResident[],
): PropertyUnitResident | null {
  const unitKey = normalizeUnitLabel(unitLabel)
  const unitMatches = residents.filter(
    (resident) => normalizeUnitLabel(resident.unit) === unitKey,
  )
  if (unitMatches.length === 0) return null

  const buildingKey = normalizeBuildingKey(building)
  const matches =
    unitMatches.length === 1
      ? unitMatches
      : unitMatches.filter((resident) => {
          const residentBuilding = resident.building?.trim()
          if (!residentBuilding) return true
          return normalizeBuildingKey(residentBuilding) === buildingKey
        })

  if (matches.length === 0) return null
  return (
    matches.find((resident) =>
      OCCUPYING_RESIDENT_STATUSES.has(resident.status.trim().toLowerCase()),
    ) ??
    matches[0] ??
    null
  )
}

export function buildPropertyUnitRows(input: {
  building: string
  units: PropertyUnitRecord[]
  residents: PropertyUnitResident[]
  tickets: PropertyUnitTicket[]
  workflowData: AdminWorkflowDashboardData | null
}): PropertyUnitRow[] {
  const { building, units, residents, tickets, workflowData } = input
  const workflowRows = workflowData ? collectAdminWorkflowRuns(workflowData) : []

  // Caller passes property-scoped units; match residents/workflows per unit building alias.
  return units
    .map((unit) => {
      const unitBuilding = unit.building?.trim() || building
      const resident = findResidentForUnit(unit.unitLabel, unitBuilding, residents)
      const occupancyStatus = resolvePropertyUnitOccupancyStatus(unit.status)
      const showOccupiedDetails = occupancyStatus === 'occupied'
      const openWorkflowLabel = pickOpenWorkflowLabel(
        unit.unitLabel,
        unitBuilding,
        tickets,
        workflowRows,
      )

      return {
        id: unit.id,
        unitDisplay: formatPropertyUnitDisplay(unit.unitLabel),
        residentId: showOccupiedDetails && resident ? resident.id : null,
        residentName: showOccupiedDetails && resident ? resident.fullName : null,
        occupancyStatus,
        openWorkflowLabel,
        balanceDue: showOccupiedDetails && resident ? resident.balanceDue : 0,
        leaseEndLabel:
          showOccupiedDetails && resident
            ? formatPropertyLeaseEnd(resident.leaseEndDate)
            : null,
        sortKey: unitSortKey(unit.unitLabel),
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)
}
