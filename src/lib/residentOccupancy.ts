/**
 * Resident occupancy status — roster (`users.status`) and how it maps to the
 * property Units chip (`units.status`).
 */

export type ResidentOccupancyStatus =
  | 'active'
  | 'pending'
  | 'past_resident'
  | 'suspended'

export const RESIDENT_OCCUPANCY_OPTIONS: {
  value: ResidentOccupancyStatus
  label: string
}[] = [
  { value: 'active', label: 'Occupied' },
  { value: 'pending', label: 'Pending move-in' },
  { value: 'past_resident', label: 'Past resident' },
  { value: 'suspended', label: 'Suspended' },
]

/** Occupied / Suspended — the unit should show Occupied on the property page. */
const UNIT_OCCUPYING_STATUSES = new Set<ResidentOccupancyStatus>(['active', 'suspended'])

export function normalizeResidentOccupancyStatus(raw: unknown): ResidentOccupancyStatus {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'pending' || v === 'pending_move_in' || v === 'pending move-in') {
    return 'pending'
  }
  if (v === 'past_resident' || v === 'vacant' || v === 'moved_out') {
    return 'past_resident'
  }
  if (v === 'suspended') return 'suspended'
  if (v === 'occupied' || v === 'active') return 'active'
  return 'active'
}

export function residentOccupancyLabel(status: string | null | undefined): string {
  const normalized = normalizeResidentOccupancyStatus(status)
  return (
    RESIDENT_OCCUPANCY_OPTIONS.find((option) => option.value === normalized)?.label ?? 'Occupied'
  )
}

/** Pill + dot colors for resident lease / occupancy chips. */
export function residentOccupancyChipVisualClasses(status: ResidentOccupancyStatus): {
  pill: string
  dot: string
} {
  switch (status) {
    case 'active':
      return { pill: 'bg-[#dcfce7] text-[#008236]', dot: 'bg-[#22c55e]' }
    case 'pending':
      return { pill: 'bg-[#fef9c3] text-[#92400e]', dot: 'bg-[#d97706]' }
    case 'suspended':
      return { pill: 'bg-[#ffedd5] text-[#9a3412]', dot: 'bg-[#ea580c]' }
    case 'past_resident':
      return { pill: 'bg-[#f3f4f6] text-[#6a7282]', dot: 'bg-[#9ca3af]' }
    default:
      return { pill: 'bg-[#f3f4f6] text-[#6a7282]', dot: 'bg-[#9ca3af]' }
  }
}

export function residentOccupancyOccupiesUnit(status: string | null | undefined): boolean {
  return UNIT_OCCUPYING_STATUSES.has(normalizeResidentOccupancyStatus(status))
}

export function unitOccupancyFromResidentStatus(
  status: string | null | undefined,
): 'occupied' | 'vacant' {
  return residentOccupancyOccupiesUnit(status) ? 'occupied' : 'vacant'
}
