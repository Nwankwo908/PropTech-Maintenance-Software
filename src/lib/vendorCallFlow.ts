import { normIssueCategory } from '@/lib/vendorIssueCategory'

export function buildLeaseRenewalCallReasonLine(workflowRef?: string | null): string {
  const ref = workflowRef?.trim()
  if (ref) return `Calling re: ${ref} · Lease renewal`
  return 'Calling re: Lease renewal'
}

export type VendorCallContext = {
  workOrderRef?: string | null
  issueCategory?: string | null
  locationLabel: string
  residentName?: string | null
}

export function vendorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function formatWorkOrderRefFromTicketId(ticketId: string): string {
  const compact = ticketId.replace(/-/g, '').slice(0, 4).toUpperCase()
  return `WO-${compact || '0000'}`
}

const LIFECYCLE_WORK_ORDER_REF_TEMPLATES = new Set([
  'move_out',
  'move_in',
  'inspection',
  'unit_inspection',
  'lease_renewal',
])

/** Active Tasks pipeline ref — lifecycle runs use workflow run id (e.g. WO-D777). */
export function formatWorkOrderRefForWorkflowRun(
  templateId: string,
  runId: string,
  entityId?: string | null,
): string {
  const source = LIFECYCLE_WORK_ORDER_REF_TEMPLATES.has(templateId)
    ? runId
    : (entityId?.trim() || runId)
  return formatWorkOrderRefFromTicketId(source)
}

export function formatIssueLabel(issueCategory: string | null | undefined): string {
  const n = normIssueCategory(issueCategory)
  if (!n) return 'Maintenance repair'
  if (n === 'hvac') return 'HVAC repair'
  return `${n.replace(/_/g, ' ')} repair`.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function buildVendorCallReasonLine(context: VendorCallContext): string {
  const ref = context.workOrderRef?.trim()
  const issue = formatIssueLabel(context.issueCategory)
  if (ref) return `Calling re: ${ref} · ${issue}`
  return `Calling re: ${issue}`
}

export function buildVendorCallLocationLine(context: VendorCallContext): string {
  const location = context.locationLabel.trim()
  const resident = context.residentName?.trim()
  if (location && resident) return `${location} · ${resident}`
  return location || resident || 'Property'
}

export function formatCallDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
