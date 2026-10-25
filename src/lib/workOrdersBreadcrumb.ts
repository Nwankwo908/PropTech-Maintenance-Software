import type { AdminBreadcrumbItem } from '@/components/AdminBreadcrumb'
import { propertyDetailPath } from '@/lib/propertyRoutes'

export const WORK_ORDER_ISSUE_MAX_CHARS = 40

const OVERVIEW: AdminBreadcrumbItem = { label: 'Overview', to: '/admin' }

export function shortWorkOrderIssue(
  description: string,
  maxChars = WORK_ORDER_ISSUE_MAX_CHARS,
): string {
  const line = description.replace(/\s+/g, ' ').trim()
  if (line.length <= maxChars) return line
  const slice = line.slice(0, maxChars + 1)
  const space = slice.lastIndexOf(' ')
  if (space <= 0) return line.slice(0, maxChars).trim()
  return slice.slice(0, space).trim()
}

export function workOrderDetailCrumbLabel(requestId: string, description: string): string {
  const issue = shortWorkOrderIssue(description)
  return issue ? `${requestId} — ${issue}` : requestId
}

export function workOrdersListPath(propertyId?: string | null): string {
  const id = propertyId?.trim()
  if (!id) return '/admin/requests'
  return `/admin/requests?property=${encodeURIComponent(id)}`
}

export function workOrdersBreadcrumbItems(input: {
  property?: { id: string; address: string } | null
  searchQuery?: string | null
  openWorkOrder?: { requestId: string; description: string } | null
  onCloseDetail?: () => void
  onClearSearch?: () => void
}): AdminBreadcrumbItem[] {
  const propertyId = input.property?.id.trim() ?? ''
  const address = input.property?.address.trim() ?? ''
  const propertyCrumb =
    propertyId && address
      ? { label: address, to: propertyDetailPath(propertyId) }
      : null
  const search = input.searchQuery?.trim() ?? ''
  const open = input.openWorkOrder

  if (open?.requestId.trim()) {
    return [
      OVERVIEW,
      {
        label: 'Work Orders',
        to: workOrdersListPath(propertyId),
        onClick: input.onCloseDetail,
      },
      { label: workOrderDetailCrumbLabel(open.requestId.trim(), open.description) },
    ]
  }

  if (search) {
    return [
      OVERVIEW,
      { label: 'Work Orders', to: '/admin/requests', onClick: input.onClearSearch },
      { label: `Search: "${search}"` },
    ]
  }

  if (propertyCrumb) {
    return [
      OVERVIEW,
      { label: 'Properties', to: '/admin/properties' },
      propertyCrumb,
      { label: 'Work Orders' },
    ]
  }

  return [OVERVIEW, { label: 'Work Orders' }]
}
