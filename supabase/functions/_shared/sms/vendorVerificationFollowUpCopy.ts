export function buildVendorVerificationReceivedSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  const trimmed = input.vendorLabel.trim()
  const name = trimmed || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    "We received your verification form. Thank you.",
  ].join("\n")
}
