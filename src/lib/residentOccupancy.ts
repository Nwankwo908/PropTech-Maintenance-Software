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

export function residentOccupancyOccupiesUnit(status: string | null | undefined): boolean {
  return UNIT_OCCUPYING_STATUSES.has(normalizeResidentOccupancyStatus(status))
}

export function unitOccupancyFromResidentStatus(
  status: string | null | undefined,
): 'occupied' | 'vacant' {
  return residentOccupancyOccupiesUnit(status) ? 'occupied' : 'vacant'
}
