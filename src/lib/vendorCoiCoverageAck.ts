export const VENDOR_COI_COVERAGE_ACK_VERSION = 'ulo-vendor-coi-coverage-ack-v1'

export const VENDOR_COI_COVERAGE_ACK_TEXT =
  'I confirm I hold general liability insurance meeting or exceeding the minimum required for my trade category as disclosed during registration. I agree to maintain this coverage for the duration of my activity on Ulo.'

export function vendorCoiCoverageAckFromProgress(
  progress: Record<string, unknown> | null | undefined,
): boolean {
  const raw = progress?.coi_coverage_attestation
  if (!raw || typeof raw !== 'object') return false
  return (raw as { accepted?: unknown }).accepted === true
}

export function vendorCoiCoverageAckProgressPatch(): Record<string, unknown> {
  return {
    accepted: true,
    accepted_at: new Date().toISOString(),
    disclaimer_version: VENDOR_COI_COVERAGE_ACK_VERSION,
    disclaimer_text: VENDOR_COI_COVERAGE_ACK_TEXT,
  }
}
