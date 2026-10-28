export type AdminRequestStatus =
  | 'in_progress'
  | 'assigned'
  | 'under_review'
  | 'completed'
  | 'cancelled'

function mapRequestStatus(raw: string): AdminRequestStatus {
  const x = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (x === 'cancelled' || x === 'archived') return 'cancelled'
  if (x === 'completed' || x === 'done' || x === 'closed') return 'completed'
  if (x === 'in_progress' || x === 'inprogress') return 'in_progress'
  if (x === 'under_review' || x === 'review' || x === 'pending_review') return 'under_review'
  if (x === 'pending_accept' || x === 'accepted') return 'assigned'
  return 'assigned'
}

function mapVendorWorkStatus(raw: string): AdminRequestStatus {
  const x = raw.trim().toLowerCase()
  if (x === 'completed') return 'completed'
  if (x === 'cancelled' || x === 'archived') return 'cancelled'
  if (x === 'in_progress' || x === 'accepted') return 'in_progress'
  return 'assigned'
}

/**
 * A completed repair stays completed on the dashboard.
 * Request status `completed` wins over a stale cancelled work-order status.
 */
export function adminRequestStatusFromDb(input: {
  status?: string | null
  vendorWorkStatus?: string | null
}): AdminRequestStatus {
  const request = mapRequestStatus(input.status ?? '')
  const vendorRaw = (input.vendorWorkStatus ?? '').trim()
  const vendor = vendorRaw ? mapVendorWorkStatus(vendorRaw) : null
  if (request === 'completed' || vendor === 'completed') return 'completed'
  if (vendor) return vendor
  return request
}
