import {
  rosterVendorTypePluralFromTrade,
} from '@/lib/vendorTrades'

/** Escalation reasons when no roster vendor is available — admin must assign or onboard. */
export const MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS = [
  'sla_expired_no_vendor',
  'vendor_declined_no_vendor',
] as const

export type MaintenanceAdminVendorEscalationReason =
  (typeof MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS)[number]

export function isMaintenanceAdminVendorEscalationReason(
  reason: string | null | undefined,
): reason is MaintenanceAdminVendorEscalationReason {
  return (
    reason === 'sla_expired_no_vendor' || reason === 'vendor_declined_no_vendor'
  )
}

export function maintenanceAdminVendorAttentionTitle(
  reason: MaintenanceAdminVendorEscalationReason,
): string {
  switch (reason) {
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
      return 'The response deadline has passed.'
    case 'vendor_declined_no_vendor':
      return noRosterVendorsAvailableMessage(issueCategory)
  }
}
