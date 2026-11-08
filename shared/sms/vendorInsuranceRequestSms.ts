/**
 * Landlord-requested vendor verification updates — preview + send share this copy.
 */

export type VendorVerificationRequestItemId =
  | 'license'
  | 'coi_coverage'
  | 'w9'
  | 'stripe_connect'
  | 'trade_categories'
  | 'service_area'

export function isVendorVerificationRequestItemId(
  value: string | null | undefined,
): value is VendorVerificationRequestItemId {
  return (
    value === 'license' ||
    value === 'coi_coverage' ||
    value === 'w9' ||
    value === 'stripe_connect' ||
    value === 'trade_categories' ||
    value === 'service_area'
  )
}

export function vendorVerificationRequestTitle(
  itemId: VendorVerificationRequestItemId,
): string {
  switch (itemId) {
    case 'license':
      return 'Request updated license'
    case 'coi_coverage':
      return 'Request updated insurance'
    case 'w9':
      return 'Request W-9 details'
    case 'stripe_connect':
      return 'Request payout setup'
    case 'trade_categories':
      return 'Request trade categories'
    case 'service_area':
      return 'Request service area'
    default:
      return 'Request missing information'
  }
}

export function vendorVerificationRequestSuccessMessage(
  itemId: VendorVerificationRequestItemId,
  vendorLabel: string,
): string {
  const who = vendorLabel.trim() || 'the vendor'
  switch (itemId) {
    case 'license':
      return `Your license update request was sent to ${who} successfully.`
    case 'coi_coverage':
      return `Your insurance update request was sent to ${who} successfully.`
    case 'w9':
      return `Your W-9 request was sent to ${who} successfully.`
    case 'stripe_connect':
      return `Your payout setup request was sent to ${who} successfully.`
    case 'trade_categories':
      return `Your trade categories request was sent to ${who} successfully.`
    case 'service_area':
      return `Your service area request was sent to ${who} successfully.`
    default:
      return `Your request was sent to ${who} successfully.`
  }
}

function requestBodyLine(itemId: VendorVerificationRequestItemId): string {
  switch (itemId) {
    case 'license':
      return 'Please upload an updated state license so we can keep you eligible for work orders. It only takes a couple of minutes.'
    case 'coi_coverage':
      return 'Please upload an updated certificate of insurance so we can keep you eligible for work orders. It only takes a couple of minutes.'
    case 'w9':
      return 'Please complete your W-9 details so we can keep your vendor profile up to date. It only takes a couple of minutes.'
    case 'stripe_connect':
      return 'Please connect your payout account so we can pay you for completed work. It only takes a couple of minutes.'
    case 'trade_categories':
      return 'Please confirm which trades you cover so we can match you with the right work orders. It only takes a couple of minutes.'
    case 'service_area':
      return 'Please confirm your service area so we know where you can take jobs. It only takes a couple of minutes.'
    default:
      return 'Please update your vendor profile so we can keep you eligible for work orders. It only takes a couple of minutes.'
  }
}

export function buildVendorVerificationRequestSms(input: {
  itemId: VendorVerificationRequestItemId
  vendorLabel: string
  companyName?: string | null
  renewalLink: string
}): string {
  const name = input.vendorLabel.trim() || 'there'
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : 'This is the property management team.'
  const link = input.renewalLink.trim() || 'https://www.ulohome.io/v/…'

  return [
    `Hi ${name},`,
    '',
    team,
    '',
    requestBodyLine(input.itemId),
    '',
    link,
  ].join('\n')
}

/** @deprecated Prefer buildVendorVerificationRequestSms with itemId coi_coverage */
export function buildVendorInsuranceRequestSms(input: {
  vendorLabel: string
  companyName?: string | null
  renewalLink: string
}): string {
  return buildVendorVerificationRequestSms({
    itemId: 'coi_coverage',
    vendorLabel: input.vendorLabel,
    companyName: input.companyName,
    renewalLink: input.renewalLink,
  })
}
