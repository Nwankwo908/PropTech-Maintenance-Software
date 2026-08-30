import {
  isCancelledOnActiveTasks,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  WORKFLOW_STAGE_LABEL,
} from '@/lib/adminWorkflowKanban'
import { formatPropertyLeaseEnd, formatPropertyUnitDisplay } from '@/lib/propertyUnitRows'
import {
  normalizeResidentOccupancyStatus,
  residentOccupancyLabel,
  type ResidentOccupancyStatus,
} from '@/lib/residentOccupancy'

export type ResidentStanding = 'good_standing' | 'at_risk' | 'past_due'

export type ResidentEmergencyContact = {
  name: string
  relationship: string
  phone: string
}

export type ResidentPet = {
  name: string
  species: string
  breed: string
}

export type ResidentWorkflowSummaryItem = {
  id: string
  title: string
  subtitle: string
  priorityLabel: string
  priorityClassName: string
}

export type ResidentCommunicationItem = {
  id: string
  preview: string
  channel: string
  dateLabel: string
}

export type ResidentProfileDetail = {
  id: string
  name: string
  building: string
  buildingShort: string
  unitDisplay: string
  standing: ResidentStanding
  standingLabel: string
  phone: string | null
  email: string | null
  emergencyContact: ResidentEmergencyContact | null
  pets: ResidentPet[]
  leaseStatus: string
  occupancyStatus: ResidentOccupancyStatus
  leaseStartDate: string | null
  leaseEndDate: string | null
  rentDueDay: number | null
  leaseStartLabel: string
  leaseEndLabel: string
  monthlyRentLabel: string
  depositLabel: string
  tenantMaintenance: string | null
  landlordMaintenance: string | null
  /** Free-text lease maintenance responsibilities clause from onboarding. */
  maintenanceResponsibilitiesClause: string | null
  balanceDue: number
  balanceLabel: string
  workflows: ResidentWorkflowSummaryItem[]
  communications: ResidentCommunicationItem[]
}

export type ResidentProfileUserRow = {
  id: string
  fullName: string
  email: string
  phone: string | null
  unit: string
  building: string | null
  status: string
  balanceDue: number
  leaseStartDate?: string | null
  leaseEndDate: string | null
  rentDueDay?: number | null
  /** Contract rent from users.monthly_rent when set during onboarding/edit. */
  monthlyRent?: number | null
  maintenanceResponsibilitiesClause?: string | null
}

/** Placeholder emails minted when onboarding saved a resident without an email. */
export function isPlaceholderResidentEmail(email: string | null | undefined): boolean {
  const value = (email ?? '').trim().toLowerCase()
  if (!value) return true
  return value.endsWith('@onboarding.local')
}

export function displayResidentEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim()
  if (!value || isPlaceholderResidentEmail(value)) return null
  return value
}

function formatPhone(value: string | null): string | null {
  if (!value?.trim()) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value.trim()
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function buildingShortName(building: string): string {
  return building.replace(/\s+Apartments$/i, '').trim() || building
}

function resolveStanding(status: string, balanceDue: number): {
  standing: ResidentStanding
  standingLabel: string
} {
  if (balanceDue > 0) {
    return { standing: 'past_due', standingLabel: 'PAST DUE' }
  }
  if (status === 'suspended') {
    return { standing: 'at_risk', standingLabel: 'AT RISK' }
  }
  if (status === 'pending') {
    return { standing: 'at_risk', standingLabel: 'MOVE-IN PENDING' }
  }
  return { standing: 'good_standing', standingLabel: 'GOOD STANDING' }
}

function workflowPriorityLabel(row: ReturnType<typeof collectAdminWorkflowRuns>[number]): {
  label: string
  className: string
} {
  if (row.status === 'escalated') {
    return { label: 'HIGH', className: 'bg-[#ffe2e2] text-[#c10007]' }
  }
  const hay = `${row.templateId} ${row.lastEventType ?? ''}`.toLowerCase()
  if (hay.includes('emergency') || hay.includes('urgent')) {
    return { label: 'HIGH', className: 'bg-[#ffe2e2] text-[#c10007]' }
  }
  return { label: 'MED', className: 'bg-[#ffedd5] text-[#c2410c]' }
}

function workflowDisplayTitle(
  row: ReturnType<typeof collectAdminWorkflowRuns>[number],
  card: ReturnType<typeof buildWorkflowKanbanCard>,
): string {
  const hay = `${row.templateId} ${row.templateName} ${row.lastEventMessage ?? ''}`.toLowerCase()
  if (hay.includes('hvac')) return 'HVAC tune-up'
  if (hay.includes('plumb')) return card.critical ? 'Emergency plumbing' : 'Plumbing issue'
  if (hay.includes('rent')) return 'Rent follow-up'
  if (hay.includes('lease')) return 'Lease renewal'
  if (hay.includes('inspection')) return 'Inspection scheduled'
  return row.templateName
}

function workflowCategoryLabel(category: ReturnType<typeof buildWorkflowKanbanCard>['category']): string {
  switch (category) {
    case 'maintenance':
      return 'Maintenance'
    case 'payment':
      return 'Payment'
    case 'lease':
      return 'Lease'
    case 'inspection':
      return 'Inspection'
    case 'move_in':
      return 'Move in'
    case 'move_out':
      return 'Move out'
    default:
      return 'Workflow'
  }
}

export function buildResidentWorkflowSummaries(
  residentId: string,
  workflowData: AdminWorkflowDashboardData | null,
): ResidentWorkflowSummaryItem[] {
  if (!workflowData) return []

  return collectAdminWorkflowRuns(workflowData)
    .filter((row) => row.residentId === residentId)
    .filter((row) => !isCancelledOnActiveTasks(row) && row.status !== 'completed')
    .map((row) => ({ row, card: buildWorkflowKanbanCard(row) }))
    .filter(({ card }) => isOpenWorkflowKanbanCard(card))
    .sort((a, b) => {
      if (a.card.critical !== b.card.critical) return a.card.critical ? -1 : 1
      return new Date(b.row.startedAt).getTime() - new Date(a.row.startedAt).getTime()
    })
    .slice(0, 5)
    .map(({ row, card }) => {
      const priority = workflowPriorityLabel(row)
      return {
        id: row.id,
        title: workflowDisplayTitle(row, card),
        subtitle: `${workflowCategoryLabel(card.category)} · ${WORKFLOW_STAGE_LABEL[card.stage]}`,
        priorityLabel: priority.label,
        priorityClassName: priority.className,
      }
    })
}

export function buildResidentProfileDetail(input: {
  user: ResidentProfileUserRow
  workflowData: AdminWorkflowDashboardData | null
  communications?: ResidentCommunicationItem[]
}): ResidentProfileDetail {
  const { user, workflowData, communications = [] } = input
  const standing = resolveStanding(user.status, user.balanceDue)
  const monthlyRent =
    typeof user.monthlyRent === 'number' && Number.isFinite(user.monthlyRent) && user.monthlyRent > 0
      ? user.monthlyRent
      : null

  return {
    id: user.id,
    name: user.fullName,
    building: user.building?.trim() || 'Portfolio',
    buildingShort: buildingShortName(user.building?.trim() || 'Portfolio'),
    unitDisplay: formatPropertyUnitDisplay(user.unit),
    standing: standing.standing,
    standingLabel: standing.standingLabel,
    phone: formatPhone(user.phone),
    email: displayResidentEmail(user.email),
    emergencyContact: null,
    pets: [],
    occupancyStatus: normalizeResidentOccupancyStatus(user.status),
    leaseStatus: residentOccupancyLabel(user.status),
    leaseStartDate: user.leaseStartDate?.trim() || null,
    leaseEndDate: user.leaseEndDate?.trim() || null,
    rentDueDay:
      typeof user.rentDueDay === 'number' &&
      Number.isFinite(user.rentDueDay) &&
      user.rentDueDay >= 1 &&
      user.rentDueDay <= 31
        ? Math.trunc(user.rentDueDay)
        : null,
    leaseStartLabel: formatPropertyLeaseEnd(user.leaseStartDate ?? null) ?? '—',
    leaseEndLabel: formatPropertyLeaseEnd(user.leaseEndDate) ?? '—',
    monthlyRentLabel: monthlyRent != null ? formatCurrency(monthlyRent) : '—',
    depositLabel: '—',
    tenantMaintenance: null,
    landlordMaintenance: null,
    maintenanceResponsibilitiesClause:
      user.maintenanceResponsibilitiesClause?.trim() || null,
    balanceDue: user.balanceDue,
    balanceLabel: formatCurrency(user.balanceDue),
    workflows: buildResidentWorkflowSummaries(user.id, workflowData),
    communications,
  }
}

export const RESIDENT_STANDING_STYLES: Record<ResidentStanding, string> = {
  good_standing: 'bg-[#dcfce7] text-[#008236]',
  at_risk: 'bg-[#ffedd5] text-[#c2410c]',
  past_due: 'bg-[#ffe2e2] text-[#c10007]',
}
