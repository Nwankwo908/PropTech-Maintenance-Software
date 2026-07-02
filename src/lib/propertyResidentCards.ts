import {
  formatPropertyLeaseEnd,
  formatPropertyUnitDisplay,
  type PropertyUnitResident,
} from '@/lib/propertyUnitRows'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'

export type PropertyResidentCard = {
  id: string
  initials: string
  name: string
  unitDisplay: string
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

export function buildPropertyResidentCards(
  building: string,
  residents: PropertyUnitResident[],
): PropertyResidentCard[] {
  return residents
    .filter((resident) => normalizeBuildingKey(resident.building) === normalizeBuildingKey(building))
    .filter((resident) => !['past_resident', 'inactive'].includes(resident.status.toLowerCase()))
    .map((resident) => ({
      id: resident.id,
      initials: residentInitials(resident.fullName),
      name: resident.fullName,
      unitDisplay: formatPropertyUnitDisplay(resident.unit),
      leaseEndLabel: formatPropertyLeaseEnd(resident.leaseEndDate) ?? '—',
      balanceLabel: formatBalance(resident.balanceDue),
      sortKey: unitSortKey(normalizeUnitLabel(resident.unit)),
    }))
    .sort((a, b) => a.sortKey - b.sortKey)
}
