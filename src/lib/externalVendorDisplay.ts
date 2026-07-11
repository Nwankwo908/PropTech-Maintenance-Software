import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import { resolvePropertyBuildingMeta } from '@/lib/propertyRoutes'
import { normIssueCategory } from '@/lib/vendorIssueCategory'

export type VendorRatingTier = {
  qualityLabel: string
  recommendationBadge: string
  tone: 'excellent' | 'strong' | 'good' | 'acceptable' | 'caution'
}

export type VendorConfidenceTier = {
  label: string
  tone: 'very-high' | 'high' | 'moderate' | 'limited' | 'new'
}

export type VendorDistanceTier = {
  tierLabel: string
  recommendation: string
  dot: '🟢' | '🟡' | '🟠' | '🔴'
  tone: 'local' | 'nearby' | 'extended' | 'long' | 'outside'
}

export type ExternalVendorDisplayRow = ExternalVendorSuggestionDto & {
  distanceMiles: number | null
  address: string | null
  phone: string | null
  website: string | null
  tags: string[]
  primarySource: ExternalVendorSuggestionDto['sources'][number] | 'mock'
  ratingTier: VendorRatingTier
  confidenceTier: VendorConfidenceTier
  distanceTier: VendorDistanceTier | null
}

type DemoEnrichmentRow = {
  distanceMiles: number
  address: string
  phone: string
  website: string
  tags: string[]
  rating: number
  reviewCount: number
}

const DEMO_ENRICHMENT_BY_TRADE: Record<string, DemoEnrichmentRow[]> = {
  plumbing: [
    {
      distanceMiles: 1.2,
      address: '840 N. Clark St',
      phone: '(312) 555-0182',
      website: 'allcityplumbing.com',
      tags: ['Plumbing', 'Drain Cleaning', 'Emergency'],
      rating: 4.9,
      reviewCount: 128,
    },
    {
      distanceMiles: 2.1,
      address: '1504 W. Division St',
      phone: '(312) 555-0047',
      website: 'rapidfixplumb.com',
      tags: ['Plumbing', 'Pipe Repair'],
      rating: 4.7,
      reviewCount: 42,
    },
    {
      distanceMiles: 3.4,
      address: '2200 S. Michigan Ave',
      phone: '(312) 555-0219',
      website: 'proflowmech.com',
      tags: ['Plumbing', 'Water Heater'],
      rating: 4.5,
      reviewCount: 24,
    },
  ],
  electrical: [
    {
      distanceMiles: 1.8,
      address: '455 W. Chicago Ave',
      phone: '(312) 555-0144',
      website: 'brightwireelectric.com',
      tags: ['Electrical', 'Panel Repair'],
      rating: 4.8,
      reviewCount: 96,
    },
    {
      distanceMiles: 2.6,
      address: '901 W. Fulton Market',
      phone: '(312) 555-0199',
      website: 'safepanelelectric.com',
      tags: ['Electrical', 'Emergency'],
      rating: 4.6,
      reviewCount: 58,
    },
  ],
  hvac: [
    {
      distanceMiles: 2.0,
      address: '1800 W. Irving Park Rd',
      phone: '(312) 555-0177',
      website: 'summitclimatehvac.com',
      tags: ['HVAC', 'Air Conditioning'],
      rating: 4.8,
      reviewCount: 112,
    },
    {
      distanceMiles: 3.1,
      address: '3200 N. Sheffield Ave',
      phone: '(312) 555-0166',
      website: 'coolflowhvac.com',
      tags: ['HVAC', 'Heating'],
      rating: 4.7,
      reviewCount: 74,
    },
  ],
  default: [
    {
      distanceMiles: 2.5,
      address: '500 W. Madison St',
      phone: '(312) 555-0100',
      website: 'alliedhomerepair.com',
      tags: ['General Maintenance'],
      rating: 4.5,
      reviewCount: 38,
    },
  ],
}

function demoTradeKey(issueCategory: string | null | undefined): string {
  const norm = normIssueCategory(issueCategory)
  if (norm === 'plumbing') return 'plumbing'
  if (norm === 'electrical') return 'electrical'
  if (issueCategory?.toLowerCase().includes('hvac')) return 'hvac'
  return 'default'
}

function localDemoAddress(locationLabel: string, fallbackStreet: string, index: number): string {
  const building = locationLabel.split('·')[0]?.trim() ?? ''
  const meta = resolvePropertyBuildingMeta(building, [])
  const base = meta.addressLine?.split(',')[0]?.trim() || fallbackStreet
  const suffix = meta.addressLine?.includes(',')
    ? meta.addressLine.slice(meta.addressLine.indexOf(','))
    : ', Portland, OR'
  const numMatch = base.match(/^(\d+)\s+(.+)$/)
  if (numMatch) {
    const num = Number(numMatch[1]) + index * 2
    return `${num} ${numMatch[2]}${suffix}`
  }
  return `${base}${suffix}`
}

function categoryTag(issueCategory: string | null | undefined): string {
  const c = String(issueCategory ?? '').trim()
  if (!c) return 'Maintenance'
  return c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')
}

export function formatExternalProviderChip(providersUsed: string[] | undefined): string {
  const ids = (providersUsed ?? []).filter((p) => p !== 'mock')
  if (ids.length === 0) return 'Demo search'
  return ids
    .map((p) => {
      if (p === 'netvendor') return 'NetVendor'
      if (p === 'google') return 'Google'
      if (p === 'yelp') return 'Yelp'
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join(' + ')
}

export function buildExternalSearchQueryLabel(
  issueCategory: string | null | undefined,
  locationLabel: string,
): string {
  const trade = categoryTag(issueCategory).replace(/\s+maintenance$/i, '')
  const loc = locationLabel.trim() || 'United States'
  return `${trade} repair · ${loc} · within 50 mi`
}

/** Rating + review-count recommendation tier (assign-vendor rail). */
export function getVendorRatingTier(
  rating: number | null | undefined,
  reviewCount: number | null | undefined,
): VendorRatingTier {
  const r = rating ?? 0
  const reviews = reviewCount ?? 0

  if (r >= 4.8 && r <= 5 && reviews >= 50) {
    return { qualityLabel: 'Excellent', recommendationBadge: 'Highly Recommended', tone: 'excellent' }
  }
  if (r >= 4.6 && r < 4.8 && reviews >= 30) {
    return { qualityLabel: 'Very Strong', recommendationBadge: 'Recommended', tone: 'strong' }
  }
  if (r >= 4.4 && r < 4.6 && reviews >= 20) {
    return { qualityLabel: 'Good', recommendationBadge: 'Good Choice', tone: 'good' }
  }
  if (r >= 4.2 && r < 4.4 && reviews >= 15) {
    return { qualityLabel: 'Acceptable', recommendationBadge: 'Review Details', tone: 'acceptable' }
  }
  if (r < 4.2) {
    return { qualityLabel: 'Use Caution', recommendationBadge: 'Needs Review', tone: 'caution' }
  }
  return { qualityLabel: 'Acceptable', recommendationBadge: 'Review Details', tone: 'acceptable' }
}

/** Review-volume confidence tier. */
export function getVendorConfidenceTier(
  reviewCount: number | null | undefined,
): VendorConfidenceTier {
  const reviews = reviewCount ?? 0
  if (reviews >= 500) {
    return { label: 'Very High Confidence', tone: 'very-high' }
  }
  if (reviews >= 100) {
    return { label: 'High Confidence', tone: 'high' }
  }
  if (reviews >= 30) {
    return { label: 'Moderate Confidence', tone: 'moderate' }
  }
  if (reviews >= 10) {
    return { label: 'Limited History', tone: 'limited' }
  }
  return { label: 'New Vendor', tone: 'new' }
}

/** Distance-based coverage tier. */
export function getVendorDistanceTier(distanceMiles: number | null | undefined): VendorDistanceTier | null {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) return null
  const d = distanceMiles
  if (d < 10) {
    return { tierLabel: 'Local', recommendation: 'Preferred', dot: '🟢', tone: 'local' }
  }
  if (d < 20) {
    return { tierLabel: 'Nearby', recommendation: 'Strong Choice', dot: '🟢', tone: 'nearby' }
  }
  if (d < 35) {
    return { tierLabel: 'Extended', recommendation: 'Acceptable', dot: '🟡', tone: 'extended' }
  }
  if (d < 50) {
    return { tierLabel: 'Long Distance', recommendation: 'Use if necessary', dot: '🟠', tone: 'long' }
  }
  return { tierLabel: 'Outside Coverage', recommendation: 'Last Resort', dot: '🔴', tone: 'outside' }
}

const RATING_TIER_RANK: Record<VendorRatingTier['tone'], number> = {
  excellent: 0,
  strong: 1,
  good: 2,
  acceptable: 3,
  caution: 4,
}

const DISTANCE_TIER_RANK: Record<NonNullable<VendorDistanceTier>['tone'], number> = {
  local: 0,
  nearby: 1,
  extended: 2,
  long: 3,
  outside: 4,
}

export function compareExternalVendorRows(a: ExternalVendorDisplayRow, b: ExternalVendorDisplayRow): number {
  const distA = a.distanceTier ? DISTANCE_TIER_RANK[a.distanceTier.tone] : 99
  const distB = b.distanceTier ? DISTANCE_TIER_RANK[b.distanceTier.tone] : 99
  if (distA !== distB) return distA - distB
  const rateA = RATING_TIER_RANK[a.ratingTier.tone]
  const rateB = RATING_TIER_RANK[b.ratingTier.tone]
  if (rateA !== rateB) return rateA - rateB
  return (b.rating ?? 0) - (a.rating ?? 0)
}

export function enrichExternalVendorSuggestions(
  suggestions: ExternalVendorSuggestionDto[],
  issueCategory: string | null | undefined,
  locationLabel?: string | null,
): ExternalVendorDisplayRow[] {
  const fallbackTag = categoryTag(issueCategory)
  const tradeKey = demoTradeKey(issueCategory)
  const demoPool = DEMO_ENRICHMENT_BY_TRADE[tradeKey] ?? DEMO_ENRICHMENT_BY_TRADE.default
  const loc = locationLabel?.trim() ?? ''

  const rows = suggestions.map((s, index) => {
    const demo = demoPool[index % demoPool.length]
    const primarySource = s.sources[0] ?? 'mock'
    const useDemoOverlay =
      s.sources.every((src) => src === 'mock') ||
      (s.sources.length === 1 && s.sources[0] === 'netvendor' && !s.address && !s.phone)

    const rating = s.rating ?? (useDemoOverlay ? demo.rating : null)
    const reviewCount = s.reviewCount ?? (useDemoOverlay ? demo.reviewCount : null)

    const tags =
      s.tags && s.tags.length > 0
        ? s.tags
        : primarySource === 'netvendor' && s.priceLabel
          ? [fallbackTag, 'Compliant']
          : useDemoOverlay
            ? demo.tags
            : [fallbackTag]

    const distanceMiles =
      s.etaMinutes != null
        ? Math.max(0.5, s.etaMinutes / 18)
        : useDemoOverlay
          ? demo.distanceMiles
          : null

    return {
      ...s,
      rating,
      reviewCount,
      primarySource,
      distanceMiles,
      address: s.address ?? (useDemoOverlay ? localDemoAddress(loc, demo.address, index) : null),
      phone: s.phone ?? (useDemoOverlay ? demo.phone : null),
      website: s.website ?? (useDemoOverlay ? demo.website : null),
      tags,
      ratingTier: getVendorRatingTier(rating, reviewCount),
      confidenceTier: getVendorConfidenceTier(reviewCount),
      distanceTier: getVendorDistanceTier(distanceMiles),
    }
  })

  return rows.sort(compareExternalVendorRows)
}

export function formatSourceBadgeLabel(
  source: ExternalVendorDisplayRow['primarySource'],
): string {
  if (source === 'netvendor') return 'NetVendor'
  if (source === 'google') return 'Google'
  if (source === 'yelp') return 'Yelp'
  return 'Demo'
}
