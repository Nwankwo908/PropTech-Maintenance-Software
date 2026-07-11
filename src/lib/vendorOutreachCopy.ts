/** Vendor outreach copy — short, friendly, one clear CTA (under ~120 words). */

const SMS_TARGET_CHARS = 320

/** Full company / legal business name for greetings — never a first name or "there". */
export function vendorCompanyName(vendorName: string): string {
  return vendorName.trim() || 'there'
}

/** @deprecated Use vendorCompanyName — vendors are greeted by company name. */
export function vendorFirstName(vendorName: string): string {
  return vendorCompanyName(vendorName)
}

/** Property or neighborhood name only — no unit numbers or street addresses. */
export function formatVendorOutreachArea(locationLabel: string): string {
  const raw = locationLabel.trim()
  if (!raw) return 'your area'

  const withoutUnit = raw.replace(/\s*·\s*unit\s+[\w-]+/i, '').trim()
  let property = (withoutUnit.split('·')[0] ?? withoutUnit).trim()

  if (!property) return 'your area'

  if (/\d+\s+[\w\s]+(?:ave|st|dr|ln|way|blvd|court|ct|rd)\b/i.test(property)) {
    const city = raw.match(/,\s*([^,]+?)(?:,\s*[A-Z]{2})?\s*(?:\d{5})?/i)?.[1]?.trim()
    if (city) return city
    return 'the area'
  }

  return property.replace(/\s+Apartments$/i, '').trim() || property
}

/** e.g. "near Birch Tower", "in Downtown Atlanta" */
export function vendorOutreachLocationPhrase(locationLabel: string): string {
  const area = formatVendorOutreachArea(locationLabel)
  if (area === 'your area' || area === 'the area') return `near ${area}`
  if (/downtown|midtown|uptown|old town|city center|east side|west side/i.test(area)) {
    return `in ${area}`
  }
  return `near ${area}`
}

/** e.g. "Plumbing" → "plumbing job", "HVAC" → "HVAC job" */
export function tradeJobPhrase(tradeLabel: string): string {
  const trade = tradeLabel.trim()
  if (!trade) return 'maintenance job'
  if (/^hvac$/i.test(trade)) return 'HVAC job'
  const lower = trade.toLowerCase()
  if (lower.endsWith(' job')) return lower
  return `${lower} job`
}

function greetingLine(companyName: string): string {
  return `Hi ${companyName},`
}

export function buildVendorVerificationSms(input: {
  vendorName: string
  tradeLabel: string
  locationLabel: string
  formLink: string
}): string {
  const company = vendorCompanyName(input.vendorName)
  const job = tradeJobPhrase(input.tradeLabel)
  const location = vendorOutreachLocationPhrase(input.locationLabel)
  const link = input.formLink.trim()

  const full = [
    greetingLine(company),
    '',
    `We have a new ${job} ${location}. Interested?`,
    '',
    `Complete this quick form to verify your insurance, pricing, and availability:`,
    '',
    `👉 ${link}`,
    '',
    `Takes a few minutes. Thanks!`,
  ].join('\n')

  if (full.length <= SMS_TARGET_CHARS) return full

  return [
    greetingLine(company),
    '',
    `New ${job} ${location}. Interested?`,
    '',
    `Verify insurance, pricing, and availability:`,
    link,
    '',
    `Thanks!`,
  ].join('\n')
}

export function buildVendorVerificationEmail(input: {
  vendorName: string
  tradeLabel: string
  locationLabel: string
  formLink: string
}): string {
  const company = vendorCompanyName(input.vendorName)
  const job = tradeJobPhrase(input.tradeLabel)
  const location = vendorOutreachLocationPhrase(input.locationLabel)
  const link = input.formLink.trim()

  return [
    greetingLine(company),
    '',
    `We have a new ${job} ${location} and wanted to see if you're interested.`,
    '',
    `If you'd like to be considered, please complete this quick form so we can verify your insurance, pricing, and availability.`,
    '',
    `👉 ${link}`,
    '',
    `It only takes a few minutes. Once you're verified, you'll be eligible for this job and future opportunities with Ulo.`,
    '',
    'Thanks!',
  ].join('\n')
}

export function buildVendorVerificationEmailSubject(
  tradeLabel: string,
  locationLabel: string,
): string {
  const job = tradeJobPhrase(tradeLabel)
  const location = vendorOutreachLocationPhrase(locationLabel)
  return `New ${job} ${location}`
}

export const VENDOR_SETUP_DELIVERY_GROUP_WINDOW_MS = 60_000

export function vendorSetupSmsDeliveryLabel(): string {
  return 'Job invitation sent via SMS'
}

export function vendorSetupEmailDeliveryLabel(): string {
  return 'Job invitation sent via Email'
}

export function vendorSetupGroupedInvitationLabel(): string {
  return 'Job invitation sent'
}

export function vendorSetupGroupedInvitationDetail(): string {
  return 'Delivered via SMS and Email'
}

export function vendorSetupSmsMonitoringSummary(
  vendorName: string,
  phoneLabel: string,
  locationLabel: string,
): string {
  const location = vendorOutreachLocationPhrase(locationLabel)
  return `We texted ${vendorName} at ${phoneLabel} about a new job ${location}. Watch for SMS replies here.`
}

export function vendorSetupEmailMonitoringSummary(
  vendorName: string,
  emailLabel: string,
  locationLabel: string,
): string {
  const location = vendorOutreachLocationPhrase(locationLabel)
  return `We emailed ${vendorName} at ${emailLabel} about a new job ${location}. Watch for form submissions and email replies here.`
}

export function vendorSetupSmsReadOnlyNote(): string {
  return ''
}

export function vendorSetupEmailReadOnlyNote(): string {
  return 'Read-only · Email thread with the vendor. Full job address is shared only after they are verified and accept.'
}

/** @deprecated Use channel-specific summaries via vendorOutreachChannels on monitoring detail. */
export function vendorSetupMonitoringSummary(
  vendorName: string,
  phoneLabel: string,
  emailLabel: string,
  locationLabel: string,
): string {
  const location = vendorOutreachLocationPhrase(locationLabel)
  return `We invited ${vendorName} by text (${phoneLabel}) and email (${emailLabel}) about a new job ${location}. Watch for replies here.`
}

/** @deprecated Use channel-specific read-only notes. */
export function vendorSetupReadOnlyNote(): string {
  return 'Read-only · We sent the vendor a text and email with a verification form — full job address is shared only after they are verified and accept.'
}

export function vendorSetupInboxContext(locationLabel: string): string {
  return `New job · ${vendorOutreachLocationPhrase(locationLabel)}`
}

export function vendorSetupInboxStatus(): string {
  return 'Waiting for reply'
}

export function vendorSetupInboxPreview(locationLabel: string): string {
  return `Job invite · ${vendorOutreachLocationPhrase(locationLabel)}`
}

/** Vendor intake portal — after they confirm pricing on the setup form. */
export function vendorPricingWorkOrderConfirmedHeadline(): string {
  return "You're all set"
}

export function vendorPricingWorkOrderConfirmedBody(): string {
  return 'The rates you shared in setup are confirmed for this work order.'
}

export function vendorPricingWorkOrderConfirmedMessage(): string {
  return `${vendorPricingWorkOrderConfirmedHeadline()}. ${vendorPricingWorkOrderConfirmedBody()}`
}

/** SMS to vendor when the landlord confirms submitted hourly rate from setup messages. */
export function vendorSetupAdminHourlyRateConfirmationSms(hourlyDisplay: string): string {
  const rate = hourlyDisplay.trim() || 'your quoted rate'
  return `Your hourly rate of ${rate} is confirmed for this work order. We'll follow up with assignment details shortly.`
}

/** @deprecated Use vendorSetupInboxPreview */
export function vendorSetupInboxPreviewFromSms(_smsBody: string): string {
  return 'Job invite sent'
}
