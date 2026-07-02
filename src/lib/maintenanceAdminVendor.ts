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
      return 'Assign vendor — SLA expired, none on roster'
    case 'vendor_declined_no_vendor':
      return 'Assign vendor — declined, none on roster'
  }
}
