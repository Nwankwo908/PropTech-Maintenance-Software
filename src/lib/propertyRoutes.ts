import { type PropertyRecord, propertyRecordToAddressLine } from '@/lib/properties'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { adminNavPath } from '@/lib/adminNavigation'

const PROPERTY_ID_SLUG_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

/** Build building name → properties.id for admin links. */
export function buildPropertyIdByBuilding(
  properties: Array<{ id: string; name: string }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const property of properties) {
    const name = property.name.trim()
    if (!name) continue
    map.set(normalizeBuildingKey(name), property.id)
  }
  return map
}

/** Prefer stable property id; fall back to legacy building-name slug when id unknown. */
export function propertyDetailPathForBuilding(
  buildingName: string,
  propertyIdByBuilding: ReadonlyMap<string, string>,
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
  const propertyId = propertyIdByBuilding.get(normalizeBuildingKey(buildingName))
  return propertyDetailPath(propertyId ?? buildingName, tab)
}

export function propertyResidentDetailPathForBuilding(
  buildingName: string,
  residentId: string,
  propertyIdByBuilding: ReadonlyMap<string, string>,
): string {
  const propertyId = propertyIdByBuilding.get(normalizeBuildingKey(buildingName))
  return propertyResidentDetailPath(propertyId ?? buildingName, residentId)
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
  const base = `${adminNavPath('properties')}/${encodeURIComponent(propertyId)}`
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
  /** When false, skip onboarding JSON (post-complete / canonical-only callers). */
  allowOnboardingFallback = true,
): PropertyBuildingMeta {
  if (canonicalProperty) {
    return {
      addressLine: propertyRecordToAddressLine(canonicalProperty),
      yearBuilt: canonicalProperty.yearBuilt,
    }
  }

  if (!allowOnboardingFallback) {
    return { addressLine: null, yearBuilt: null }
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

  return { addressLine: null, yearBuilt: null }
}

export function formatPropertySubtitle(meta: PropertyBuildingMeta, unitCount: number): string {
  if (meta.addressLine && meta.yearBuilt != null) {
    return `${meta.addressLine} · Built ${meta.yearBuilt}`
  }
  if (meta.addressLine) return meta.addressLine
  if (meta.yearBuilt != null) return `Built ${meta.yearBuilt} · ${unitCount} units`
  return `${unitCount} unit${unitCount === 1 ? '' : 's'} in portfolio`
}
