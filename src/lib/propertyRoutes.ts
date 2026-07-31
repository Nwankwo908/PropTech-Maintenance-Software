import { isDemoAccountActive } from '@/lib/activeLandlord'
import { type PropertyRecord, propertyRecordToAddressLine } from '@/lib/properties'

const PROPERTY_ID_SLUG_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PropertyRouteSlug =
  | { kind: 'id'; value: string }
  | { kind: 'name'; value: string }

/** True when the URL segment is a canonical properties.id UUID. */
export function isPropertyIdSlug(slug: string): boolean {
  return PROPERTY_ID_SLUG_RE.test(slug.trim())
}

/** Parse /admin/properties/:slug — UUID id or legacy building name. */
export function parsePropertyRouteSlug(slug: string | undefined): PropertyRouteSlug | null {
  if (!slug?.trim()) return null
  try {
    const decoded = decodeURIComponent(slug.trim())
    if (isPropertyIdSlug(decoded)) {
      return { kind: 'id', value: decoded }
    }
    return { kind: 'name', value: decoded }
  } catch {
    return null
  }
}

/** Canonical admin property detail URL — uses stable properties.id. */
export function propertyDetailPath(
  propertyId: string,
  tab?:
    | 'overview'
    | 'details'
    | 'units'
    | 'residents'
    | 'workflows'
    | 'conversations'
    | 'vendors'
    | 'analytics',
): string {
  const base = `/admin/properties/${encodeURIComponent(propertyId)}`
  if (tab && tab !== 'overview') return `${base}?tab=${tab}`
  return base
}

/** @deprecated Prefer propertyDetailPath(propertyId). Accepts id or legacy building name. */
export function buildingDetailPath(
  buildingOrPropertyId: string,
  tab?:
    | 'overview'
    | 'details'
    | 'units'
    | 'residents'
    | 'workflows'
    | 'conversations'
    | 'vendors'
    | 'analytics',
): string {
  return propertyDetailPath(buildingOrPropertyId, tab)
}

export function propertyResidentDetailPath(propertyId: string, residentId: string): string {
  return `${propertyDetailPath(propertyId)}/residents/${encodeURIComponent(residentId)}`
}

/** @deprecated Prefer parsePropertyRouteSlug */
export function parseBuildingSlug(slug: string | undefined): string | null {
  const parsed = parsePropertyRouteSlug(slug)
  if (!parsed) return null
  return parsed.value
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
  canonicalProperty?: PropertyRecord | null,
): PropertyBuildingMeta {
  if (canonicalProperty) {
    return {
      addressLine: propertyRecordToAddressLine(canonicalProperty),
      yearBuilt: canonicalProperty.yearBuilt,
    }
  }

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
