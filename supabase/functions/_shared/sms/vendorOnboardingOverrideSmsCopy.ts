/**
 * SMS copy when a landlord activates a vendor via Override onboarding.
 */
export function buildVendorOnboardingOverrideActivatedSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    "Your vendor profile is now active. You're eligible to receive work orders from our team through Ulo.",
    "",
    "We'll text you here when a job is available.",
  ].join("\n")
}
