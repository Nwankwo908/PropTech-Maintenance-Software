/** Kanban columns map to vendor-update-job-status actions (target column = desired transition). */

export type VendorKanbanColumn = 'assigned' | 'in_progress' | 'completed'

export const columnToAction = {
  assigned: 'accept',
  in_progress: 'in_progress',
  completed: 'completed',
} as const

export type VendorStatusAction = (typeof columnToAction)[VendorKanbanColumn]

/** Resulting `vendor_work_status` after a successful action (informative; server is source of truth). */
export const actionToStatus = {
  accept: 'accepted',
  in_progress: 'in_progress',
  completed: 'completed',
} as const

export type VendorDbWorkStatus =
  | 'pending_accept'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'unassigned'

/** Client-side guard: skip API for impossible transitions (DB: pending_accept → accepted → in_progress → completed). */
export function isValidMove(
  currentStatus: VendorDbWorkStatus | undefined,
  targetColumn: VendorKanbanColumn,
): boolean {
  if (!currentStatus) return true
  if (currentStatus === 'declined' || currentStatus === 'unassigned') return false
  const action = columnToAction[targetColumn]
  if (action === 'accept') return currentStatus === 'pending_accept'
  if (action === 'in_progress') {
    return currentStatus === 'pending_accept' || currentStatus === 'accepted'
  }
  if (action === 'completed') return currentStatus === 'in_progress'
  return false
}
