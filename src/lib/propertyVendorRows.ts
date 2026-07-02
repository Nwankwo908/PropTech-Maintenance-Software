export type PropertyVendorTicket = {
  id: string
  unit: string
  building: string | null
  issueCategory: string | null
  description: string | null
  assignedVendorId: string | null
  vendorWorkStatus: string
  urgency: string
}

export type PropertyVendorRecord = {
  id: string
  name: string
  category: string | null
}

export type PropertyVendorWorkOrder = {
  ticketId: string
  title: string
  metaLine: string
  statusLabel: string
  priorityLabel: string
  priorityClassName: string
}

export type PropertyActiveVendorRow = {
  vendorId: string
  vendorName: string
  trade: string
  activeJobCount: number
  workOrders: PropertyVendorWorkOrder[]
}

const URGENT_BADGE = 'bg-[#ffe2e2] text-[#c10007]'
const NORMAL_BADGE = 'bg-[#f3f4f6] text-[#364153]'

/** True when a vendor is still assigned to an open maintenance order. */
export function isActiveVendorJobStatus(rawStatus: string): boolean {
  const normalized = rawStatus.trim().toLowerCase().replace(/\s+/g, '_')
  return (
    normalized !== '' &&
    normalized !== 'completed' &&
    normalized !== 'done' &&
    normalized !== 'closed' &&
    normalized !== 'cancelled' &&
    normalized !== 'declined' &&
    normalized !== 'unassigned'
  )
}

function formatTrade(category: string | null): string {
  if (!category?.trim()) return 'General'
  return category
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function humanizeWorkStatus(status: string): string {
  return status
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function workOrderTitle(ticket: PropertyVendorTicket): string {
  const description = ticket.description?.trim()
  if (description) {
    return description.length > 72 ? `${description.slice(0, 71).trim()}…` : description
  }
  return formatTrade(ticket.issueCategory)
}

function workOrderMetaLine(ticket: PropertyVendorTicket): string {
  const unitPart = ticket.unit?.trim() ? `Unit ${ticket.unit.trim()}` : 'Unit —'
  const category = formatTrade(ticket.issueCategory)
  return `${unitPart} · ${category}`
}

function priorityForTicket(ticket: PropertyVendorTicket): {
  priorityLabel: string
  priorityClassName: string
} {
  const urgent = ticket.urgency.toLowerCase() === 'urgent'
  return urgent
    ? { priorityLabel: 'URGENT', priorityClassName: URGENT_BADGE }
    : { priorityLabel: 'OPEN', priorityClassName: NORMAL_BADGE }
}

/** Vendors with at least one active work order on the selected property. */
export function buildPropertyActiveVendorRows(input: {
  tickets: PropertyVendorTicket[]
  vendors: PropertyVendorRecord[]
}): PropertyActiveVendorRow[] {
  const vendorById = new Map(input.vendors.map((vendor) => [vendor.id, vendor]))
  const grouped = new Map<string, PropertyVendorWorkOrder[]>()

  for (const ticket of input.tickets) {
    const vendorId = ticket.assignedVendorId?.trim()
    if (!vendorId || !isActiveVendorJobStatus(ticket.vendorWorkStatus)) continue

    const priority = priorityForTicket(ticket)
    const workOrder: PropertyVendorWorkOrder = {
      ticketId: ticket.id,
      title: workOrderTitle(ticket),
      metaLine: workOrderMetaLine(ticket),
      statusLabel: humanizeWorkStatus(ticket.vendorWorkStatus),
      priorityLabel: priority.priorityLabel,
      priorityClassName: priority.priorityClassName,
    }

    const bucket = grouped.get(vendorId) ?? []
    bucket.push(workOrder)
    grouped.set(vendorId, bucket)
  }

  const rows: PropertyActiveVendorRow[] = []

  for (const [vendorId, workOrders] of grouped) {
    const vendor = vendorById.get(vendorId)
    rows.push({
      vendorId,
      vendorName: vendor?.name?.trim() || 'Assigned vendor',
      trade: formatTrade(vendor?.category ?? null),
      activeJobCount: workOrders.length,
      workOrders: workOrders.sort((a, b) => a.title.localeCompare(b.title)),
    })
  }

  return rows.sort((a, b) => {
    if (b.activeJobCount !== a.activeJobCount) return b.activeJobCount - a.activeJobCount
    return a.vendorName.localeCompare(b.vendorName)
  })
}
