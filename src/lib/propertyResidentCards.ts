import {
  formatPropertyLeaseEnd,
  formatPropertyUnitDisplay,
  type PropertyUnitResident,
} from '@/lib/propertyUnitRows'
import { normalizeUnitLabel } from '@/lib/propertyHealth'
import { groupResidentsByLeasePlace } from '@/lib/residentProfileDetail'
import { residentOccupancyLabel } from '@/lib/residentOccupancy'

export type PropertyResidentCard = {
  id: string
  initials: string
  name: string
  unitDisplay: string
  occupancyLabel: string
  leaseEndLabel: string
  balanceLabel: string
  sortKey: number
}

function residentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function formatBalance(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function unitSortKey(label: string): number {
  const digits = label.replace(/\D/g, '')
  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

/** Pass residents already scoped to the property (see filterResidentsForPropertyScope). */
export function buildPropertyResidentCards(
  _building: string,
  residents: PropertyUnitResident[],
): PropertyResidentCard[] {
  const current = residents.filter(
    (resident) => !['past_resident', 'inactive'].includes(resident.status.toLowerCase()),
  )
  return groupResidentsByLeasePlace(
    current.map((resident) => ({
      id: resident.id,
      fullName: resident.fullName,
      unit: resident.unit,
      building: resident.building,
      status: resident.status,
    })),
  )
    .map((group) => {
      const members = group
        .map((member) => current.find((resident) => resident.id === member.id))
        .filter((resident): resident is PropertyUnitResident => Boolean(resident))
      const primary = members[0]
      if (!primary) return null
      const names = members.map((resident) => resident.fullName.trim()).filter(Boolean)
      const balanceDue = Math.max(...members.map((resident) => resident.balanceDue), 0)
      const leaseEndDate =
        members.find((resident) => resident.leaseEndDate?.trim())?.leaseEndDate ?? null
      return {
        id: primary.id,
        initials: residentInitials(primary.fullName),
        name: names.join(', '),
        unitDisplay: formatPropertyUnitDisplay(primary.unit),
        occupancyLabel: residentOccupancyLabel(primary.status),
        leaseEndLabel: formatPropertyLeaseEnd(leaseEndDate) ?? '—',
        balanceLabel: formatBalance(balanceDue),
        sortKey: unitSortKey(normalizeUnitLabel(primary.unit)),
      }
    })
    .filter((card): card is PropertyResidentCard => Boolean(card))
    .sort((a, b) => a.sortKey - b.sortKey)
}
