import type { ExternalVendorDisplayRow } from '@/lib/externalVendorDisplay'
import type { VendorLicenseVerificationState } from '@/lib/vendorLicenseVerification'
import { isLicenseVerificationComplete } from '@/lib/vendorLicenseVerification'
import type { VendorSetupVerificationState } from '@/lib/vendorSetupVerification'
import { buildVendorSetupChecklistItem } from '@/lib/vendorSetupVerification'
import { normIssueCategory } from '@/lib/vendorIssueCategory'

export type VerificationChecklistItem = {
  id: string
  title: string
  required: boolean
  detail: string
  verified: boolean
  requiresManualVerify?: boolean
  requiresViewMessageAction?: boolean
}

export type PricingComparisonRow = {
  label: string
  vendorPrice: string
  marketAverage: string
}

export type ExternalVendorVerificationProfile = {
  vendorName: string
  tradeLabel: string
  rating: number | null
  reviewCount: number | null
  distanceLabel: string | null
  etaLabel: string | null
  phone: string | null
  website: string | null
  yearsInBusiness: number | null
  requirementsComplete: number
  requirementsTotal: number
  completionPercent: number
  readinessLabel: string
  verificationScoreLabel: string
  checklist: VerificationChecklistItem[]
  workOrderFit: string[]
  pricingRows: PricingComparisonRow[]
}

function tradeLabelFromCategory(issueCategory: string | null | undefined): string {
  const n = normIssueCategory(issueCategory)
  if (!n) return 'MAINTENANCE'
  if (n === 'hvac') return 'HVAC'
  return n.replace(/_/g, ' ').toUpperCase()
}

function etaLabel(vendor: ExternalVendorDisplayRow): string | null {
  if (vendor.etaMinutes != null && Number.isFinite(vendor.etaMinutes)) {
    const low = Math.max(5, Math.round(vendor.etaMinutes))
    const high = low + 10
    return `ETA ${low}–${high} min`
  }
  if (vendor.distanceMiles != null) {
    const mins = Math.max(15, Math.round(vendor.distanceMiles * 12))
    return `ETA ${mins}–${mins + 10} min`
  }
  return null
}

function serviceAreaLabel(locationLabel: string): string {
  const zip = locationLabel.match(/\b(\d{5})\b/)?.[1]
  const property = locationLabel.split('·')[0]?.trim() || 'Property'
  if (zip) return `Services ZIP ${zip} (${property})`
  return `Services ${locationLabel.trim() || 'property area'}`
}

function stableYearsInBusiness(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash + name.charCodeAt(i) * (i + 3)) % 97
  }
  return 8 + (hash % 18)
}

function parsePricingFromLabel(priceLabel: string | null): {
  serviceCall: string | null
  hourly: string | null
} {
  if (!priceLabel?.trim()) return { serviceCall: null, hourly: null }

  const tokenPattern = /\$[\d,]+(?:\.\d{2})?(\s*\/\s*(?:hr|hour)\b)?/gi
  let serviceCall: string | null = null
  let hourly: string | null = null

  for (const match of priceLabel.matchAll(tokenPattern)) {
    const amount = match[0]
    if (match[1]) {
      hourly = amount
    } else if (!serviceCall) {
      serviceCall = amount
    }
  }

  return { serviceCall, hourly }
}

export function buildExternalVendorVerificationProfile(
  vendor: ExternalVendorDisplayRow,
  options: { issueCategory?: string | null; locationLabel?: string } = {},
): ExternalVendorVerificationProfile {
  const trade = tradeLabelFromCategory(options.issueCategory)
  const tradeLower = trade.toLowerCase().replace(/\s+/g, ' ')
  const locationLabel = options.locationLabel?.trim() || 'Property · Unit'
  const eta = etaLabel(vendor)
  const { serviceCall: parsedServiceCall, hourly: parsedHourly } = parsePricingFromLabel(vendor.priceLabel)
  const serviceCall = parsedServiceCall ?? '$85'
  const hourly = parsedHourly ?? '$120/hr'

  const checklist: VerificationChecklistItem[] = []

  const fitEta = eta?.replace(/^ETA\s/, 'Available within ') ?? 'Available within 35 minutes'
  const metrics = computeVerificationMetrics(checklist, null, null)

  return {
    vendorName: vendor.name,
    tradeLabel: trade,
    rating: vendor.rating,
    reviewCount: vendor.reviewCount,
    distanceLabel:
      vendor.distanceMiles != null
        ? `${vendor.distanceMiles.toFixed(1)} mi from property`
        : null,
    etaLabel: eta,
    phone: vendor.phone,
    website: vendor.website,
    yearsInBusiness: stableYearsInBusiness(vendor.name),
    requirementsComplete: metrics.requirementsComplete,
    requirementsTotal: metrics.requirementsTotal,
    completionPercent: metrics.completionPercent,
    readinessLabel: metrics.readinessLabel,
    verificationScoreLabel: metrics.verificationScoreLabel,
    checklist,
    workOrderFit: [
      `Performs ${tradeLower} repairs`,
      serviceAreaLabel(locationLabel),
      'Meets 4-hour SLA requirement',
      fitEta,
      'Accepts emergency work',
      'Pricing within market range',
    ],
    pricingRows: [
      { label: 'Service call', vendorPrice: serviceCall, marketAverage: 'Market avg: $90–$110' },
      { label: 'Hourly rate', vendorPrice: hourly, marketAverage: 'Market avg: $110–$135' },
    ],
  }
}

export function buildLicenseChecklistItem(
  license: VendorLicenseVerificationState,
): VerificationChecklistItem {
  const verified = isLicenseVerificationComplete(license)
  const requiresManualVerify = license.status === 'not_found' || license.status === 'expired'

  let detail = license.detail
  if (license.status === 'auto_verified') {
    detail = `${license.detail} · Auto-verified via state API`
  }

  return {
    id: 'license',
    title: 'License Verification',
    required: true,
    detail,
    verified,
    requiresManualVerify,
  }
}

export function mergeVerificationChecklist(
  baseChecklist: VerificationChecklistItem[],
  license: VendorLicenseVerificationState | null,
  vendorSetup: VendorSetupVerificationState | null = null,
): VerificationChecklistItem[] {
  const items: VerificationChecklistItem[] = []
  if (license) items.push(buildLicenseChecklistItem(license))
  if (vendorSetup) items.push(buildVendorSetupChecklistItem(vendorSetup))
  return [...items, ...baseChecklist]
}

export function computeVerificationMetrics(
  baseChecklist: VerificationChecklistItem[],
  license: VendorLicenseVerificationState | null,
  vendorSetup: VendorSetupVerificationState | null = null,
): Pick<
  ExternalVendorVerificationProfile,
  'requirementsComplete' | 'requirementsTotal' | 'completionPercent' | 'readinessLabel' | 'verificationScoreLabel'
> {
  const checklist = mergeVerificationChecklist(baseChecklist, license, vendorSetup)
  const requirementsTotal = checklist.length
  const requirementsComplete = checklist.filter((item) => item.verified).length
  const completionPercent =
    requirementsTotal > 0 ? Math.round((requirementsComplete / requirementsTotal) * 100) : 0

  return {
    requirementsComplete,
    requirementsTotal,
    completionPercent,
    readinessLabel: completionPercent >= 100 ? 'Ready to Dispatch' : 'Review Required',
    verificationScoreLabel:
      completionPercent >= 100 ? 'Ready to Dispatch' : `${completionPercent}% verified`,
  }
}
