import {
  rosterVendorTypePluralFromTrade,
} from '@/lib/vendorTrades'

/** Escalation reasons when no roster vendor is available — admin must assign or onboard. */
export const MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS = [
  'sla_expired_no_vendor',
  'vendor_declined_no_vendor',
  'no_vendor_available',
] as const

export type MaintenanceAdminVendorEscalationReason =
  (typeof MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS)[number]

export function isMaintenanceAdminVendorEscalationReason(
  reason: string | null | undefined,
): reason is MaintenanceAdminVendorEscalationReason {
  return (
    reason === 'sla_expired_no_vendor' ||
    reason === 'vendor_declined_no_vendor' ||
    reason === 'no_vendor_available'
  )
}

const LIVE_ASSIGNMENT_WORK_STATUSES = new Set([
  'pending_accept',
  'accepted',
  'in_progress',
])

/** Sticky hold written by auto-reassign / stall follow-up when staff must pick a vendor. */
export function isNeedsAdminVendorStickyOutcome(
  autoReassignLastOutcome?: string | null,
): boolean {
  return (autoReassignLastOutcome ?? '')
    .trim()
    .toLowerCase()
    .startsWith('needs_admin_vendor|')
}

/**
 * Sticky needs_admin_vendor + still-assigned pending_accept — backend already
 * escalated; board must not render this as ordinary "Awaiting vendor."
 */
export function isStalePendingAcceptNeedsAdminVendor(input: {
  vendorWorkStatus?: string | null
  assignedVendorId?: string | null
  autoReassignLastOutcome?: string | null
  /** Escalated run with sla_expired_no_vendor / declined / no_vendor reasons. */
  workflowNeedsAdminVendor?: boolean
}): boolean {
  const vws = (input.vendorWorkStatus ?? '').trim().toLowerCase()
  if (vws !== 'pending_accept') return false
  if (!input.assignedVendorId?.trim()) return false
  return (
    isNeedsAdminVendorStickyOutcome(input.autoReassignLastOutcome) ||
    input.workflowNeedsAdminVendor === true
  )
}

export const STALE_PENDING_ACCEPT_NEEDS_ADMIN_STATUS_LABEL =
  'Vendor unresponsive · needs reassignment'

export const STALE_PENDING_ACCEPT_NEEDS_ADMIN_ATTENTION_TITLE =
  'Vendor unresponsive — needs reassignment'

export const STALE_PENDING_ACCEPT_NEEDS_ADMIN_CONTEXT =
  'The assigned vendor never accepted. This needs a new vendor choice — not another wait.'

/**
 * SLA rematch skip must follow the ticket, not a stale `no_vendor_available` run.
 * `pending_accept` + assigned vendor is never "needs admin vendor."
 */
export function shouldSkipSlaReassignForNeedsAdminVendor(input: {
  assignedVendorId?: string | null
  vendorWorkStatus?: string | null
  workflowNeedsAdminVendor: boolean
}): boolean {
  if (!input.workflowNeedsAdminVendor) return false
  const assigned = Boolean(input.assignedVendorId?.trim())
  const status = (input.vendorWorkStatus ?? '').trim().toLowerCase()
  if (assigned) return false
  if (LIVE_ASSIGNMENT_WORK_STATUSES.has(status)) return false
  return true
}

export function maintenanceAdminVendorAttentionTitle(
  reason: MaintenanceAdminVendorEscalationReason,
): string {
  switch (reason) {
    case 'no_vendor_available':
      return 'Assign a vendor'
    case 'sla_expired_no_vendor':
    case 'vendor_declined_no_vendor':
      return 'Find a Replacement Vendor'
  }
}

/**
 * Plural specialty label for empty-roster copy (e.g. "plumbers", "HVAC technicians").
 * Returns null when the category is missing or too generic to name a trade.
 */
export function rosterVendorTypePlural(
  issueCategory: string | null | undefined,
): string | null {
  return rosterVendorTypePluralFromTrade(issueCategory)
}

/** Explains why Ulo is recommending outside-roster vendors. */
export function noRosterVendorsAvailableMessage(
  issueCategory?: string | null,
): string {
  const vendorType = rosterVendorTypePlural(issueCategory)
  if (!vendorType) return 'No available vendors were found on your roster.'
  return `No available ${vendorType} were found on your roster.`
}

export function maintenanceAdminVendorAttentionMeta(
  reason: MaintenanceAdminVendorEscalationReason,
  issueCategory?: string | null,
): string {
  switch (reason) {
    case 'sla_expired_no_vendor':
      return 'The response time has passed.'
    case 'vendor_declined_no_vendor':
    case 'no_vendor_available':
      return noRosterVendorsAvailableMessage(issueCategory)
  }
}

/** True for engine/metadata codes like `sla_expired_no_vendor` — never show raw to landlords. */
export function looksLikeInternalEscalationCode(value: string | null | undefined): boolean {
  const t = (value ?? '').trim()
  if (!t) return false
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(t)
}

/**
 * Plain-language escalation copy for landlord rails (Active Tasks Overview, etc.).
 * Never returns snake_case reason codes.
 */
export function formatLandlordEscalationReason(
  reason: string | null | undefined,
  issueCategory?: string | null,
): string | null {
  const raw = (reason ?? '').trim()
  if (!raw) return null

  if (isMaintenanceAdminVendorEscalationReason(raw)) {
    const title = maintenanceAdminVendorAttentionTitle(raw)
    const meta = maintenanceAdminVendorAttentionMeta(raw, issueCategory)
    if (raw === 'sla_expired_no_vendor') {
      return `${meta} No vendor on your roster could take this — find a replacement vendor.`
    }
    if (raw === 'vendor_declined_no_vendor') {
      return `The assigned vendor declined. ${meta} Find a replacement vendor.`
    }
    return `${title}. ${meta}`
  }

  if (looksLikeInternalEscalationCode(raw)) {
    return 'This task needs your attention — Ulo could not finish vendor matching automatically.'
  }

  return raw
}
