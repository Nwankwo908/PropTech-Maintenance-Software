/**
 * Vendor status state machine (matching eligibility).
 *
 * Account status (Pending → Active) is separate from capacity (Paused).
 * A vendor can be ACTIVE (verified) but PAUSED (not accepting jobs).
 * Matching requires Active account + accepting capacity (not paused / under weekly cap).
 * See `.cursor/rules/vendor-status-chip.mdc`.
 */

export type VendorCapacityChipStatus =
  | 'pending'
  | 'docs_submitted'
  | 'active'
  | 'paused'
  | 'suspended'
  | 'banned'

export type VendorCapacityChip = {
  status: VendorCapacityChipStatus
  label: string
  /** Short rule text for list/detail UI. */
  detail: string
  /** Tailwind classes for the pill background + text. */
  className: string
  /** Only ACTIVE is matchable for job dispatch. */
  matchable: boolean
}

export const VENDOR_STATUS_MEANINGS: Record<
  VendorCapacityChipStatus,
  { label: string; detail: string; className: string }
> = {
  pending: {
    label: 'Pending',
    detail: 'App received. No docs submitted. Not matchable. 48hr reminder if no action.',
    className: 'bg-[#fef9c3] text-[#92400e]',
  },
  docs_submitted: {
    label: 'Docs submitted',
    detail: 'Docs under review. Not matchable. Target: 48hrs (manual), 24hrs post-Checkr.',
    className: 'bg-[#e0e7ff] text-[#3730a3]',
  },
  active: {
    label: 'Active',
    detail: 'All requirements met. Enters matching queue. Only matchable state.',
    className: 'bg-[#dbfce7] text-[#008236]',
  },
  paused: {
    label: 'Paused',
    detail: 'Vendor-initiated hold. No new jobs. Self-reactivate via SMS or portal.',
    className: 'bg-[#f3f4f6] text-[#6a7282]',
  },
  suspended: {
    label: 'Suspended',
    detail: 'Platform hold: incident, performance breach, or expired COI/license. Review in 1–2hrs.',
    className: 'bg-[#ffedd5] text-[#9a3412]',
  },
  banned: {
    label: 'Banned',
    detail: 'Permanent removal. No reinstatement. Data retained for audit.',
    className: 'bg-[#fee2e2] text-[#991b1b]',
  },
}

export function isVendorVerificationComplete(
  verificationStatus: string | null | undefined,
): boolean {
  return (verificationStatus ?? '').trim().toLowerCase() === 'verified'
}

function normalizeVerificationStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function chipFor(status: VendorCapacityChipStatus): VendorCapacityChip {
  const meaning = VENDOR_STATUS_MEANINGS[status]
  return {
    status,
    label: meaning.label,
    detail: meaning.detail,
    className: meaning.className,
    matchable: status === 'active',
  }
}

/**
 * Resolve the landlord-facing capacity chip for a vendor roster row.
 *
 * Precedence:
 * 1. Platform holds (banned → suspended)
 * 2. Docs submitted / under review
 * 3. Pending (invite / in progress / no verification)
 * 4. Verified → Active, or Paused if vendor hold
 */
export function resolveVendorCapacityChip(input: {
  verificationStatus?: string | null
  /** `vendors.active` — only honored after verification is complete. */
  vendorActive?: boolean | null
  /** `vendor_verifications.availability` — paused is a vendor-initiated hold. */
  availability?: string | null
  /** Platform hold on `vendors.roster_status` (`suspended` | `banned`). */
  rosterStatus?: string | null
}): VendorCapacityChip {
  const roster = normalizeVerificationStatus(input.rosterStatus)
  if (roster === 'banned') return chipFor('banned')
  if (roster === 'suspended') return chipFor('suspended')

  const verification = normalizeVerificationStatus(input.verificationStatus)

  if (verification === 'submitted' || verification === 'needs_review') {
    return chipFor('docs_submitted')
  }

  if (!isVendorVerificationComplete(verification)) {
    return chipFor('pending')
  }

  const availability = normalizeVerificationStatus(input.availability)
  if (availability === 'paused' || input.vendorActive === false) {
    return chipFor('paused')
  }

  return chipFor('active')
}

/** Matching / dispatch eligibility — only ACTIVE. */
export function isVendorMatchable(input: {
  verificationStatus?: string | null
  vendorActive?: boolean | null
  availability?: string | null
  rosterStatus?: string | null
}): boolean {
  return resolveVendorCapacityChip(input).matchable
}
