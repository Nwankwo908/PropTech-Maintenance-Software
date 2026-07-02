import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import type { AdminWorkflowDashboardData, AdminWorkflowRow } from '@/lib/adminWorkflows'
import {
  isUnitOccupiedByResident,
  normalizeBuildingKey,
  normalizeUnitLabel,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

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

export type PropertyUnitRow = {
  id: string
  unitDisplay: string
  residentId: string | null
  residentName: string | null
  occupancyStatus: 'occupied' | 'vacant'
  openWorkflowLabel: string | null
  balanceDue: number
  leaseEndLabel: string | null
  sortKey: number
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])

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

function capitalizeWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function formatIssueCategoryLabel(category: string, urgency: string): string {
  const normalized = category.trim().toLowerCase()
  const isEmergency = urgency === 'emergency' || urgency === 'critical'

  if (normalized.includes('plumb')) {
    return isEmergency ? 'Emergency plumbing' : 'Plumbing issue'
  }
  if (
    normalized.includes('hvac') ||
    normalized.includes('cool') ||
    normalized.includes('heat') ||
    normalized.includes('air')
  ) {
    return 'AC not cooling'
  }
  if (normalized.includes('elect')) return 'Electrical issue'
  if (normalized.includes('appliance')) return 'Appliance issue'

  const words = capitalizeWords(normalized.replace(/_/g, ' '))
  return words.toLowerCase().endsWith('issue') ? words : `${words} issue`
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
  return (
    residents.find((resident) => {
      if (normalizeBuildingKey(resident.building) !== normalizeBuildingKey(building)) return false
      return normalizeUnitLabel(resident.unit) === unitKey
    }) ?? null
  )
}

function toHealthUnit(unit: PropertyUnitRecord): PropertyHealthUnit {
  return {
    id: unit.id,
    unitLabel: unit.unitLabel,
    building: unit.building,
    status: unit.status,
  }
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

  return units
    .filter((unit) => normalizeBuildingKey(unit.building) === normalizeBuildingKey(building))
    .map((unit) => {
      const resident = findResidentForUnit(unit.unitLabel, building, residents)
      const isOccupied = isUnitOccupiedByResident(toHealthUnit(unit), building, residents)

      return {
        id: unit.id,
        unitDisplay: formatPropertyUnitDisplay(unit.unitLabel),
        residentId: isOccupied && resident ? resident.id : null,
        residentName: isOccupied && resident ? resident.fullName : null,
        occupancyStatus: isOccupied ? 'occupied' : 'vacant',
        openWorkflowLabel: pickOpenWorkflowLabel(unit.unitLabel, building, tickets, workflowRows),
        balanceDue: isOccupied && resident ? resident.balanceDue : 0,
        leaseEndLabel:
          isOccupied && resident ? formatPropertyLeaseEnd(resident.leaseEndDate) : null,
        sortKey: unitSortKey(unit.unitLabel),
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)
}
