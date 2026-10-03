import {
  isCancelledOnActiveTasks,
  maintenanceTicketIdFromWorkflowRun,
  workflowMatchesPropertyScope,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { isSingleFamilyPropertyType } from '@shared/properties/propertyType'
import { formatUnitReference } from '@shared/properties/unitLabelDisplay'

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
  propertyId?: string | null
}

export type PropertyUnitTicket = {
  id: string
  unit: string
  unitId?: string | null
  building: string | null
  propertyId?: string | null
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
  /** Active Tasks / pipeline run to open from the Open workflow column. */
  openWorkflowRunId: string | null
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

export function formatPropertyUnitDisplay(
  unitLabel: string,
  propertyType?: string | null,
): string {
  if (isSingleFamilyPropertyType(propertyType)) return ''
  const formatted = formatUnitReference(unitLabel, propertyType)
  if (formatted) return formatted
  // Empty stored label on non-SFH still shows an em dash in table cells.
  if (!(unitLabel ?? '').trim()) return '—'
  return ''
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

/**
 * Unit-row ticket attribution. Fail closed on repeating labels — same contract as
 * workflowMatchesPropertyScope / workflowMatchesUnit (FK first; no bare "1").
 */
export function ticketMatchesUnit(
  ticket: PropertyUnitTicket,
  unitLabel: string,
  building: string,
  unitId?: string | null,
  propertyId?: string | null,
): boolean {
  if (unitId && ticket.unitId) return ticket.unitId === unitId
  // Inventory has a unit id but the ticket does not — do not match by bare label.
  if (unitId && !ticket.unitId) return false
  if (
    propertyId?.trim() &&
    ticket.propertyId?.trim() &&
    ticket.propertyId.trim() !== propertyId.trim()
  ) {
    return false
  }
  const unitKey = normalizeUnitLabel(unitLabel)
  const ticketUnitKey = normalizeUnitLabel(ticket.unit)
  if (!ticketUnitKey || ticketUnitKey !== unitKey) return false
  // Unit labels like "1" repeat across the portfolio — require building when present.
  if (ticket.building?.trim()) {
    return normalizeBuildingKey(ticket.building) === normalizeBuildingKey(building)
  }
  // Orphan label-only tickets are not attributed to a specific unit when inventory has ids.
  if (unitId) return false
  return true
}

/** Unit-row workflow attribution — delegates property scope to workflowMatchesPropertyScope. */
export function workflowMatchesUnit(
  row: AdminWorkflowRow,
  unitLabel: string,
  building: string,
  unitId?: string | null,
  propertyId?: string | null,
): boolean {
  if (unitId && row.unitId) return row.unitId === unitId
  // Inventory has a unit id but the run does not — do not match by bare label.
  if (unitId && !row.unitId) return false
  if (
    !workflowMatchesPropertyScope(row, {
      building,
      propertyId,
      unitIds: unitId ? new Set([unitId]) : undefined,
    })
  ) {
    return false
  }
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

function pickOpenWorkflow(
  unitLabel: string,
  building: string,
  tickets: PropertyUnitTicket[],
  workflowRows: AdminWorkflowRow[],
  unitId?: string | null,
  propertyId?: string | null,
): { label: string; runId: string | null } | null {
  const openTickets = tickets
    .filter(isOpenTicket)
    .filter((ticket) => ticketMatchesUnit(ticket, unitLabel, building, unitId, propertyId))
    .sort((a, b) => {
      const aEmergency = a.urgency === 'emergency' ? 0 : 1
      const bEmergency = b.urgency === 'emergency' ? 0 : 1
      return aEmergency - bEmergency
    })

  const openWorkflows = workflowRows
    .filter((row) => workflowMatchesUnit(row, unitLabel, building, unitId, propertyId))
    .filter((row) => !isCancelledOnActiveTasks(row) && row.status !== 'completed')
    .map((row) => ({ row, card: buildWorkflowKanbanCard(row) }))
    .filter(({ card }) => isOpenWorkflowKanbanCard(card))
    .sort((a, b) => {
      if (a.card.critical !== b.card.critical) return a.card.critical ? -1 : 1
      return new Date(b.row.startedAt).getTime() - new Date(a.row.startedAt).getTime()
    })

  if (openTickets.length > 0) {
    const ticket = openTickets[0]!
    const label = formatIssueCategoryLabel(ticket.issueCategory ?? 'maintenance', ticket.urgency)
    const linkedRun =
      openWorkflows.find(({ row }) => maintenanceTicketIdFromWorkflowRun(row) === ticket.id)?.row ??
      workflowRows.find(
        (row) =>
          !isCancelledOnActiveTasks(row) &&
          row.status !== 'completed' &&
          maintenanceTicketIdFromWorkflowRun(row) === ticket.id,
      ) ??
      null
    // Never fall back to a different unit workflow — that can attach Shahita's
    // WO to another resident's row when labels collide.
    return { label, runId: linkedRun?.id ?? null }
  }

  if (openWorkflows.length > 0) {
    const { row, card } = openWorkflows[0]!
    return {
      label: formatWorkflowCategoryLabel(card.category, row.templateId),
      runId: row.id,
    }
  }

  return null
}

/**
 * Residents on a unit row. Bare repeating labels without building never match —
 * same fail-closed posture as ticket/workflow unit attribution.
 */
export function findResidentsForUnit(
  unitLabel: string,
  building: string,
  residents: PropertyUnitResident[],
): PropertyUnitResident[] {
  const unitKey = normalizeUnitLabel(unitLabel)
  if (!unitKey) return []

  const buildingKey = normalizeBuildingKey(building)
  const matches = residents.filter((resident) => {
    if (normalizeUnitLabel(resident.unit) !== unitKey) return false
    const residentBuilding = resident.building?.trim()
    // Bare unit labels like "1" repeat across the portfolio — never attach a
    // resident with no building text, or a different building, to this unit.
    if (!residentBuilding) return false
    return normalizeBuildingKey(residentBuilding) === buildingKey
  })

  const occupying = matches.filter((resident) =>
    OCCUPYING_RESIDENT_STATUSES.has(resident.status.trim().toLowerCase()),
  )
  const household = occupying.length > 0 ? occupying : matches.slice(0, 1)
  return [...household].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }),
  )
}

export function buildPropertyUnitRows(input: {
  building: string
  propertyId?: string | null
  propertyType?: string | null
  units: PropertyUnitRecord[]
  residents: PropertyUnitResident[]
  tickets: PropertyUnitTicket[]
  workflowData: AdminWorkflowDashboardData | null
}): PropertyUnitRow[] {
  const {
    building,
    propertyId = null,
    propertyType = null,
    units,
    residents,
    tickets,
    workflowData,
  } = input
  const workflowRows = workflowData ? collectAdminWorkflowRuns(workflowData) : []

  // Caller passes property-scoped units; match residents/workflows per unit building alias.
  return units
    .map((unit) => {
      const unitBuilding = unit.building?.trim() || building
      const household = findResidentsForUnit(unit.unitLabel, unitBuilding, residents)
      const resident = household[0] ?? null
      const occupancyStatus = resolvePropertyUnitOccupancyStatus(unit.status)
      const showOccupiedDetails = occupancyStatus === 'occupied'
      const openWorkflow = pickOpenWorkflow(
        unit.unitLabel,
        unitBuilding,
        tickets,
        workflowRows,
        unit.id,
        propertyId ?? unit.propertyId ?? null,
      )
      const names = household.map((member) => member.fullName.trim()).filter(Boolean)
      const balanceDue = household.length > 0 ? Math.max(...household.map((member) => member.balanceDue), 0) : 0
      const leaseEndDate =
        household.find((member) => member.leaseEndDate?.trim())?.leaseEndDate ?? null
      const unitDisplay = formatPropertyUnitDisplay(unit.unitLabel, propertyType)

      return {
        id: unit.id,
        unitDisplay: unitDisplay || '—',
        // Always link a matched resident so profile is reachable even if the unit
        // chip has not flipped to Occupied yet. Co-tenants share one cell.
        residentId: resident?.id ?? null,
        residentName: names.length > 0 ? names.join(', ') : null,
        occupancyStatus,
        openWorkflowLabel: openWorkflow?.label ?? null,
        openWorkflowRunId: openWorkflow?.runId ?? null,
        balanceDue: showOccupiedDetails ? balanceDue : 0,
        leaseEndLabel:
          showOccupiedDetails ? formatPropertyLeaseEnd(leaseEndDate) : null,
        sortKey: unitSortKey(unit.unitLabel),
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)
}
