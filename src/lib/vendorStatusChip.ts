/**
 * Vendor capacity/status chip mapping.
 *
 * Pending until verification is complete (`vendor_verifications.status === 'verified'`),
 * then Active (or Paused/Backup if not accepting work).
 * See `.cursor/rules/vendor-status-chip.mdc`.
 */

export type VendorCapacityChipStatus = 'pending' | 'active' | 'paused'

export type VendorCapacityChip = {
  status: VendorCapacityChipStatus
  label: string
  /** Tailwind classes for the pill background + text. */
  className: string
}

export function isVendorVerificationComplete(
  verificationStatus: string | null | undefined,
): boolean {
  return (verificationStatus ?? '').trim().toLowerCase() === 'verified'
}

/**
 * Resolve the landlord-facing capacity chip for a vendor roster row.
 */
export function resolveVendorCapacityChip(input: {
  verificationStatus?: string | null
  /** `vendors.active` — only honored after verification is complete. */
  vendorActive?: boolean | null
}): VendorCapacityChip {
  if (!isVendorVerificationComplete(input.verificationStatus)) {
    return {
      status: 'pending',
      label: 'Pending',
      className: 'bg-[#fef9c3] text-[#92400e]',
    }
  }

  if (input.vendorActive === false) {
    return {
      status: 'paused',
      label: 'Paused',
      className: 'bg-[#f3f4f6] text-[#6a7282]',
    }
  }

  return {
    status: 'active',
    label: 'Active',
    className: 'bg-[#dbfce7] text-[#008236]',
  }
}
