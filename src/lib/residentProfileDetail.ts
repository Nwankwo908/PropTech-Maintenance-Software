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
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { formatRentDueDayOrdinal } from '@/lib/onboarding/persist/residents'

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
  rentDueDayLabel: string
  depositLabel: string
  tenantMaintenance: string | null
  landlordMaintenance: string | null
  /** Free-text lease maintenance responsibilities clause from onboarding. */
  maintenanceResponsibilitiesClause: string | null
  balanceDue: number
  balanceLabel: string
  /** Other current residents on the same unit and property. */
  otherOccupants: ResidentOtherOccupant[]
  workflows: ResidentWorkflowSummaryItem[]
  communications: ResidentCommunicationItem[]
}

export type ResidentOtherOccupant = {
  id: string
  name: string
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

/**
 * Email column to send on resident edit. `undefined` means leave the stored
 * value alone so a blank/shared address is not rewritten onto a unique index.
 */
export function residentEmailPatchForSave(
  submitted: string,
  stored: string | null | undefined,
): string | undefined {
  const next = submitted.trim()
  const current = displayResidentEmail(stored) ?? ''
  if (next === current) return undefined
  return next
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

/** Header place under the tenant name. Empty / placeholder property → Address. */
export function residentPlaceLabel(building: string | null | undefined): string {
  const value = (building ?? '').trim()
  if (!value || value.toLowerCase() === 'portfolio') return 'Address'
  return buildingShortName(value)
}

export type ResidentOccupantRow = {
  id: string
  fullName: string
  unit: string
  building: string | null
  status: string
}

function samePropertyPlace(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftKey = normalizeBuildingKey(left)
  const rightKey = normalizeBuildingKey(right)
  if (leftKey.toLowerCase() === rightKey.toLowerCase()) return true
  const leftPlace = residentPlaceLabel(left)
  const rightPlace = residentPlaceLabel(right)
  if (leftPlace === 'Address' || rightPlace === 'Address') return false
  return leftPlace.toLowerCase() === rightPlace.toLowerCase()
}

/** Same current lease: matching unit + property. Unassigned people stay ungrouped. */
export function shareSameLeasePlace(
  left: Pick<ResidentOccupantRow, 'unit' | 'building' | 'status'>,
  right: Pick<ResidentOccupantRow, 'unit' | 'building' | 'status'>,
): boolean {
  if (left.status === 'past_resident' || right.status === 'past_resident') return false
  const unitKey = normalizeUnitLabel(left.unit)
  if (!unitKey) return false
  if (normalizeUnitLabel(right.unit) !== unitKey) return false
  return samePropertyPlace(left.building, right.building)
}

/** One household per property + unit. People without a unit stay on their own row. */
export function groupResidentsByLeasePlace<T extends ResidentOccupantRow>(residents: T[]): T[][] {
  const current = residents.filter((row) => row.status !== 'past_resident')
  const used = new Set<string>()
  const groups: T[][] = []

  for (const row of current) {
    if (used.has(row.id)) continue
    if (!normalizeUnitLabel(row.unit)) {
      used.add(row.id)
      groups.push([row])
      continue
    }

    const members = current.filter((other) => !used.has(other.id) && shareSameLeasePlace(row, other))
    for (const member of members) used.add(member.id)
    members.sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }))
    groups.push(members)
  }

  return groups.sort((a, b) =>
    (a[0]?.fullName ?? '').localeCompare(b[0]?.fullName ?? '', undefined, { sensitivity: 'base' }),
  )
}

/** Current residents on the same unit and property, excluding the open profile. */
export function otherOccupantsOnSamePlace(input: {
  residentId: string
  unit: string
  building: string | null | undefined
  residents: ResidentOccupantRow[]
}): ResidentOtherOccupant[] {
  const unitKey = normalizeUnitLabel(input.unit)
  if (!unitKey) return []

  const seen = new Set<string>()
  const occupants: ResidentOtherOccupant[] = []
  for (const row of input.residents) {
    if (row.id === input.residentId) continue
    if (row.status === 'past_resident') continue
    if (normalizeUnitLabel(row.unit) !== unitKey) continue
    if (!samePropertyPlace(row.building, input.building)) continue
    const name = row.fullName.trim()
    if (!name) continue
    const key = row.id.trim() || name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    occupants.push({ id: row.id, name })
  }
  return occupants.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
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
  const rentDueDay =
    typeof user.rentDueDay === 'number' &&
    Number.isFinite(user.rentDueDay) &&
    user.rentDueDay >= 1 &&
    user.rentDueDay <= 31
      ? Math.trunc(user.rentDueDay)
      : null

  return {
    id: user.id,
    name: user.fullName,
    building: user.building?.trim() || 'Address',
    buildingShort: residentPlaceLabel(user.building),
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
    rentDueDay,
    leaseStartLabel: formatPropertyLeaseEnd(user.leaseStartDate ?? null) ?? '—',
    leaseEndLabel: formatPropertyLeaseEnd(user.leaseEndDate) ?? '—',
    monthlyRentLabel: monthlyRent != null ? formatCurrency(monthlyRent) : '—',
    rentDueDayLabel: rentDueDay != null ? formatRentDueDayOrdinal(rentDueDay) : '—',
    depositLabel: '—',
    tenantMaintenance: null,
    landlordMaintenance: null,
    maintenanceResponsibilitiesClause:
      user.maintenanceResponsibilitiesClause?.trim() || null,
    balanceDue: user.balanceDue,
    balanceLabel: formatCurrency(user.balanceDue),
    otherOccupants: [],
    workflows: buildResidentWorkflowSummaries(user.id, workflowData),
    communications,
  }
}

export const RESIDENT_STANDING_STYLES: Record<ResidentStanding, string> = {
  good_standing: 'bg-[#dcfce7] text-[#008236]',
  at_risk: 'bg-[#ffedd5] text-[#c2410c]',
  past_due: 'bg-[#ffe2e2] text-[#c10007]',
}
