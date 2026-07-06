import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'

export type ExternalVendorDisplayRow = ExternalVendorSuggestionDto & {
  distanceMiles: number | null
  address: string | null
  phone: string | null
  website: string | null
  tags: string[]
  primarySource: ExternalVendorSuggestionDto['sources'][number] | 'mock'
}

const DEMO_ENRICHMENT: Array<{
  distanceMiles: number
  address: string
  phone: string
  website: string
  tags: string[]
}> = [
  {
    distanceMiles: 1.2,
    address: '840 N. Clark St, Chicago, IL',
    phone: '(312) 555-0182',
    website: 'allcityplumbing.com',
    tags: ['Plumbing', 'Drain Cleaning', 'Emergency'],
  },
  {
    distanceMiles: 2.1,
    address: '1504 W. Division St, Chicago, IL',
    phone: '(312) 555-0047',
    website: 'rapidfixchi.com',
    tags: ['Plumbing', 'HVAC', 'General Maintenance'],
  },
  {
    distanceMiles: 3.4,
    address: '2200 S. Michigan Ave, Chicago, IL',
    phone: '(312) 555-0219',
    website: 'proflowmech.com',
    tags: ['Plumbing', 'Pipe Repair'],
  },
]

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
  return `${trade} repair · ${loc} · within 5 mi`
}

export function enrichExternalVendorSuggestions(
  suggestions: ExternalVendorSuggestionDto[],
  issueCategory: string | null | undefined,
): ExternalVendorDisplayRow[] {
  const fallbackTag = categoryTag(issueCategory)
  return suggestions.map((s, index) => {
    const demo = DEMO_ENRICHMENT[index % DEMO_ENRICHMENT.length]
    const primarySource = s.sources[0] ?? 'mock'
    const useDemoOverlay =
      s.sources.every((src) => src === 'mock') ||
      (s.sources.length === 1 && s.sources[0] === 'netvendor' && !s.address && !s.phone)

    const tags =
      s.tags && s.tags.length > 0
        ? s.tags
        : primarySource === 'netvendor' && s.priceLabel
          ? [fallbackTag, 'Compliant']
          : useDemoOverlay
            ? demo.tags
            : [fallbackTag]

    return {
      ...s,
      primarySource,
      distanceMiles:
        s.etaMinutes != null
          ? Math.max(0.5, s.etaMinutes / 18)
          : useDemoOverlay
            ? demo.distanceMiles
            : null,
      address: s.address ?? (useDemoOverlay ? demo.address : null),
      phone: s.phone ?? (useDemoOverlay ? demo.phone : null),
      website: s.website ?? (useDemoOverlay ? demo.website : null),
      tags,
    }
  })
}

export function formatSourceBadgeLabel(
  source: ExternalVendorDisplayRow['primarySource'],
): string {
  if (source === 'netvendor') return 'NetVendor'
  if (source === 'google') return 'Google'
  if (source === 'yelp') return 'Yelp'
  return 'Demo'
}
