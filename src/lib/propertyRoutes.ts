import { isDemoAccountActive } from '@/lib/activeLandlord'

/** URL-safe building identifier for /admin/properties/:buildingSlug routes. */
export function buildingDetailPath(
  building: string,
  tab?: 'overview' | 'units' | 'residents' | 'workflows' | 'conversations' | 'vendors' | 'analytics',
): string {
  const base = `/admin/properties/${encodeURIComponent(building)}`
  if (tab && tab !== 'overview') return `${base}?tab=${tab}`
  return base
}

export function propertyResidentDetailPath(building: string, residentId: string): string {
  return `${buildingDetailPath(building)}/residents/${encodeURIComponent(residentId)}`
}

export function parseBuildingSlug(slug: string | undefined): string | null {
  if (!slug?.trim()) return null
  try {
    return decodeURIComponent(slug)
  } catch {
    return null
  }
}

export type PropertyBuildingMeta = {
  addressLine: string | null
  yearBuilt: number | null
}

/** Showcase addresses for demo portfolio buildings (Figma reference data). */
const DEMO_BUILDING_META: Record<string, PropertyBuildingMeta> = {
  'Oakwood Apartments': { addressLine: '812 Oakwood Ave, Portland, OR', yearBuilt: 2014 },
  'Pine Ridge': { addressLine: '220 Pine Ridge Dr, Portland, OR', yearBuilt: 2008 },
  'Cedar Court': { addressLine: '45 Cedar Court Ln, Beaverton, OR', yearBuilt: 2011 },
  'Maple Heights': { addressLine: '901 Maple Heights Blvd, Hillsboro, OR', yearBuilt: 2016 },
  'Birch Tower': { addressLine: '12 Birch Tower Way, Portland, OR', yearBuilt: 2019 },
  'Willow Park': { addressLine: '330 Willow Park Rd, Gresham, OR', yearBuilt: 2005 },
}

export function resolvePropertyBuildingMeta(
  building: string,
  onboardingProperties: Array<{
    name?: string
    streetAddress?: string
    city?: string
    state?: string
    zipCode?: string
    yearBuilt?: number | string | null
  }>,
): PropertyBuildingMeta {
  const fromOnboarding = onboardingProperties.find(
    (p) => p.name?.trim().toLowerCase() === building.trim().toLowerCase(),
  )
  if (fromOnboarding) {
    const parts = [
      fromOnboarding.streetAddress?.trim(),
      [fromOnboarding.city, fromOnboarding.state].filter(Boolean).join(', '),
      fromOnboarding.zipCode?.trim(),
    ].filter(Boolean)
    const yearRaw = fromOnboarding.yearBuilt
    const yearBuilt =
      typeof yearRaw === 'number' && Number.isFinite(yearRaw)
        ? yearRaw
        : typeof yearRaw === 'string' && yearRaw.trim()
          ? Number(yearRaw)
          : null
    return {
      addressLine: parts.length > 0 ? parts.join(' ') : null,
      yearBuilt: yearBuilt != null && Number.isFinite(yearBuilt) ? yearBuilt : null,
    }
  }

  // Never decorate New Landlord / default portfolios with showcase addresses.
  if (!isDemoAccountActive()) {
    return { addressLine: null, yearBuilt: null }
  }

  return DEMO_BUILDING_META[building] ?? { addressLine: null, yearBuilt: null }
}

export function formatPropertySubtitle(meta: PropertyBuildingMeta, unitCount: number): string {
  if (meta.addressLine && meta.yearBuilt != null) {
    return `${meta.addressLine} · Built ${meta.yearBuilt}`
  }
  if (meta.addressLine) return meta.addressLine
  if (meta.yearBuilt != null) return `Built ${meta.yearBuilt} · ${unitCount} units`
  return `${unitCount} unit${unitCount === 1 ? '' : 's'} in portfolio`
}
