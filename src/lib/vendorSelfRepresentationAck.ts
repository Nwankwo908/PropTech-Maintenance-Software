/** Immutable copy for landlord-preferred vendor self-representation (Terms §6.3). */
export const VENDOR_SELF_REPRESENTATION_ACK_VERSION = 'ulo-vendor-self-rep-ack-v1'

export const TERMS_SECTION_6_3_HREF = '/terms#6-3'

export const VENDOR_SELF_REPRESENTATION_ACK_BODY =
  'I confirm my business information is accurate, I hold all required licenses and insurance, and I will notify Ulo if any credential changes. I am an independent contractor, Ulo is a coordination platform, not my employer.'

export function vendorSelfRepresentationDisclaimerText(): string {
  return `${VENDOR_SELF_REPRESENTATION_ACK_BODY} (Links to Terms Section 6.3)`
}

export function vendorSelfRepresentationAckFromProgress(
  progress: Record<string, unknown> | null | undefined,
): boolean {
  const raw = progress?.self_representation_attestation
  if (!raw || typeof raw !== 'object') return false
  return (raw as { accepted?: unknown }).accepted === true
}

export function vendorSelfRepresentationAckProgressPatch(): Record<string, unknown> {
  return {
    accepted: true,
    accepted_at: new Date().toISOString(),
    disclaimer_version: VENDOR_SELF_REPRESENTATION_ACK_VERSION,
    disclaimer_text: vendorSelfRepresentationDisclaimerText(),
  }
}
