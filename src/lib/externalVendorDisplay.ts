import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import { isDemoAccountActive } from '@/lib/activeLandlord'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { isDemoExternalVendorName } from '@shared/externalVendor/demoVendorNames'

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

function categoryTag(issueCategory: string | null | undefined): string {
  if (!String(issueCategory ?? '').trim()) return 'Maintenance'
  return formatVendorTradeLabel(issueCategory, { emptyLabel: 'Maintenance' })
}

function isMockOnlySuggestion(suggestion: ExternalVendorSuggestionDto): boolean {
  if (isDemoExternalVendorName(suggestion.name)) return true
  const sources = suggestion.sources ?? []
  return sources.length === 0 || sources.every((src) => src === 'mock')
}

function isDemoProviderNotice(notice: string | null | undefined): boolean {
  if (!notice?.trim()) return false
  return /\b(demo|mock)\b/i.test(notice)
}

/** Alpha / real accounts never show mock vendor names. Demo account keeps them. */
export function sanitizeExternalVendorDiscoveryForAccount<T extends ExternalVendorSuggestionDto>(input: {
  suggestions: T[]
  providersUsed?: string[]
  notice?: string | null
}): {
  suggestions: T[]
  providersUsed: string[]
  notice: string | null
} {
  if (isDemoAccountActive()) {
    return {
      suggestions: input.suggestions,
      providersUsed: input.providersUsed ?? [],
      notice: input.notice ?? null,
    }
  }
  return {
    suggestions: input.suggestions.filter((row) => !isMockOnlySuggestion(row)),
    providersUsed: (input.providersUsed ?? []).filter((p) => p !== 'mock'),
    notice: isDemoProviderNotice(input.notice) ? null : input.notice ?? null,
  }
}

export function buildExternalSearchQueryLabel(
  issueCategory: string | null | undefined,
  areaLabel: string,
): string {
  const trade = categoryTag(issueCategory).replace(/\s+maintenance$/i, '')
  const loc = areaLabel.trim()
  return loc ? `${trade} repair · ${loc} · within 50 mi` : `${trade} repair · within 50 mi`
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
  _locationLabel?: string | null,
): ExternalVendorDisplayRow[] {
  const fallbackTag = categoryTag(issueCategory)

  const rows = suggestions.map((s) => {
    const primarySource = s.sources[0] ?? 'mock'
    const rating = s.rating ?? null
    const reviewCount = s.reviewCount ?? null

    const tags =
      s.tags && s.tags.length > 0
        ? s.tags
        : primarySource === 'thumbtack' && s.priceLabel
          ? [fallbackTag, /licensed/i.test(s.priceLabel) ? 'Licensed' : 'Thumbtack']
          : [fallbackTag]

    const distanceMiles =
      s.etaMinutes != null ? Math.max(0.5, s.etaMinutes / 18) : null

    return {
      ...s,
      rating,
      reviewCount,
      primarySource,
      distanceMiles,
      address: s.address ?? null,
      phone: s.phone ?? null,
      website: s.website ?? null,
      tags,
      ratingTier: getVendorRatingTier(rating, reviewCount),
      confidenceTier: getVendorConfidenceTier(reviewCount),
      distanceTier: getVendorDistanceTier(distanceMiles),
    }
  })

  return rows.sort(compareExternalVendorRows)
}
