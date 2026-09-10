/**
 * Canonical Home Data Graph facts.
 * Provider adapters (ATTOM, manual, …) map into this shape.
 * `rentcast` remains a stored source_provider id for historical rows; it is not ingested.
 * Do not put vendor-specific field names on the snapshot.
 */

export const HOME_DATA_PROVIDERS = ['rentcast', 'attom', 'manual'] as const
export type HomeDataProviderId = (typeof HOME_DATA_PROVIDERS)[number]

export function parseHomeDataProviderId(value: string | null | undefined): HomeDataProviderId {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === 'attom' || raw === 'manual' || raw === 'rentcast') return raw
  return 'attom'
}

export type HomeDataFacts = {
  estimatedValue: number | null
  estimatedValueLow: number | null
  estimatedValueHigh: number | null
  estimatedRent: number | null
  estimatedRentLow: number | null
  estimatedRentHigh: number | null
  propertyType: string | null
  bedrooms: number | null
  bathrooms: number | null
  livingAreaSqft: number | null
  lotSizeSqft: number | null
  yearBuilt: number | null
  unitCount: number | null
  hasGarage: boolean | null
  garageSpaces: number | null
  garageType: string | null
  hasPool: boolean | null
  poolType: string | null
  heating: string | null
  cooling: string | null
  lastSalePrice: number | null
  lastSaleDate: string | null
  taxYear: number | null
  propertyTaxAnnual: number | null
  assessedValue: number | null
  latitude: number | null
  longitude: number | null
  photoUrls: string[]
}

/** Adapter output before persist. Graph columns never store vendor field names. */
export type HomeDataIngestResult = {
  provider: HomeDataProviderId
  providerRecordId: string | null
  facts: HomeDataFacts
  raw: unknown
}

export type HomeDataGraphSnapshot = HomeDataFacts & {
  propertyId: string
  landlordId: string
  sourceProvider: string
  sourceRecordId: string | null
  fetchedAt: string
  /** True after an ingest that requested a rent estimate (even if none was returned). */
  rentLookupComplete: boolean
}

export const HOME_DATA_STALE_MS = 24 * 60 * 60 * 1000

export function emptyHomeDataFacts(): HomeDataFacts {
  return {
    estimatedValue: null,
    estimatedValueLow: null,
    estimatedValueHigh: null,
    estimatedRent: null,
    estimatedRentLow: null,
    estimatedRentHigh: null,
    propertyType: null,
    bedrooms: null,
    bathrooms: null,
    livingAreaSqft: null,
    lotSizeSqft: null,
    yearBuilt: null,
    unitCount: null,
    hasGarage: null,
    garageSpaces: null,
    garageType: null,
    hasPool: null,
    poolType: null,
    heating: null,
    cooling: null,
    lastSalePrice: null,
    lastSaleDate: null,
    taxYear: null,
    propertyTaxAnnual: null,
    assessedValue: null,
    latitude: null,
    longitude: null,
    photoUrls: [],
  }
}

export function parseHomeDataPhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const url = item.trim()
    if (!url.startsWith('https://') || seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= 24) break
  }
  return out
}

export function homeDataHasFacts(facts: HomeDataFacts): boolean {
  return Object.values(facts).some((value) => {
    if (Array.isArray(value)) return value.length > 0
    return value != null && value !== ''
  })
}

export function homeDataHasVisuals(facts: Pick<HomeDataFacts, 'photoUrls' | 'latitude' | 'longitude'>): boolean {
  if (facts.photoUrls.length > 0) return true
  return facts.latitude != null && facts.longitude != null
}

export function homeDataNeedsProviderRefresh(
  snapshot: HomeDataGraphSnapshot | null,
  now = Date.now(),
): boolean {
  if (!snapshot || !homeDataHasFacts(snapshot)) return true
  if (isHomeDataStale(snapshot.fetchedAt, now)) return true
  if (!homeDataHasVisuals(snapshot)) return true
  return snapshot.rentLookupComplete !== true
}

export function isHomeDataStale(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return true
  const ts = new Date(fetchedAt).getTime()
  if (Number.isNaN(ts)) return true
  return now - ts > HOME_DATA_STALE_MS
}

export function formatHomeDataMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatHomeDataNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export function formatHomeDataSqft(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatHomeDataNumber(value)} sq ft`
}

export function formatHomeDataDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatHomeDataGarage(facts: HomeDataFacts): string {
  if (facts.hasGarage === false) return 'None'
  const parts: string[] = []
  if (facts.garageSpaces != null && Number.isFinite(facts.garageSpaces)) {
    parts.push(`${formatHomeDataNumber(facts.garageSpaces)} space${facts.garageSpaces === 1 ? '' : 's'}`)
  }
  if (facts.garageType?.trim()) parts.push(facts.garageType.trim())
  if (parts.length > 0) return parts.join(' · ')
  if (facts.hasGarage === true) return 'Yes'
  return '—'
}

export function formatHomeDataPool(facts: HomeDataFacts): string {
  if (facts.hasPool === false) return 'None'
  if (facts.poolType?.trim()) return facts.poolType.trim()
  if (facts.hasPool === true) return 'Yes'
  return '—'
}

export function formatHomeDataHvac(heating: string | null, cooling: string | null): string {
  const heat = heating?.trim() || ''
  const cool = cooling?.trim() || ''
  if (!heat && !cool) return '—'
  if (heat && cool) return `Heat: ${heat} · Cool: ${cool}`
  if (heat) return `Heat: ${heat}`
  return `Cool: ${cool}`
}

export function formatHomeDataSale(facts: HomeDataFacts): string {
  const price = formatHomeDataMoney(facts.lastSalePrice)
  const date = formatHomeDataDate(facts.lastSaleDate)
  if (price === '—' && date === '—') return '—'
  if (price === '—') return date
  if (date === '—') return price
  return `${price} · ${date}`
}

export function formatHomeDataTaxes(facts: HomeDataFacts): string {
  const tax = formatHomeDataMoney(facts.propertyTaxAnnual)
  const assessed = formatHomeDataMoney(facts.assessedValue)
  const year = facts.taxYear != null ? String(facts.taxYear) : ''
  if (tax === '—' && assessed === '—') return '—'
  const bits: string[] = []
  if (tax !== '—') bits.push(year ? `${tax} (${year})` : tax)
  if (assessed !== '—') bits.push(`Assessed ${assessed}`)
  return bits.join(' · ')
}

export function formatHomeDataValue(facts: HomeDataFacts): string {
  const mid = formatHomeDataMoney(facts.estimatedValue)
  if (mid === '—') return '—'
  if (facts.estimatedValueLow != null && facts.estimatedValueHigh != null) {
    return `${mid} (${formatHomeDataMoney(facts.estimatedValueLow)}–${formatHomeDataMoney(facts.estimatedValueHigh)})`
  }
  return mid
}

export function formatHomeDataRent(facts: HomeDataFacts): string {
  const mid = formatHomeDataMoney(facts.estimatedRent)
  if (mid === '—') return '—'
  const range =
    facts.estimatedRentLow != null && facts.estimatedRentHigh != null
      ? ` (${formatHomeDataMoney(facts.estimatedRentLow)}–${formatHomeDataMoney(facts.estimatedRentHigh)})`
      : ''
  return `${mid}/mo${range}`
}

export function formatHomeDataRange(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  const a = formatHomeDataMoney(low ?? null)
  const b = formatHomeDataMoney(high ?? null)
  if (a === '—' && b === '—') return '—'
  if (a === '—') return b
  if (b === '—') return a
  return `${a}–${b}`
}

export type HomeDataGraphRow = {
  property_id: string
  landlord_id: string
  estimated_value: number | string | null
  estimated_value_low: number | string | null
  estimated_value_high: number | string | null
  estimated_rent: number | string | null
  estimated_rent_low: number | string | null
  estimated_rent_high: number | string | null
  rent_lookup_complete?: boolean | null
  property_type: string | null
  bedrooms: number | string | null
  bathrooms: number | string | null
  living_area_sqft: number | string | null
  lot_size_sqft: number | string | null
  year_built: number | null
  unit_count: number | null
  has_garage: boolean | null
  garage_spaces: number | string | null
  garage_type: string | null
  has_pool: boolean | null
  pool_type: string | null
  heating: string | null
  cooling: string | null
  last_sale_price: number | string | null
  last_sale_date: string | null
  tax_year: number | null
  property_tax_annual: number | string | null
  assessed_value: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  photo_urls: unknown
  source_provider: string
  source_record_id: string | null
  fetched_at: string
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function homeDataSnapshotFromRow(row: HomeDataGraphRow): HomeDataGraphSnapshot {
  return {
    propertyId: row.property_id,
    landlordId: row.landlord_id,
    estimatedValue: num(row.estimated_value),
    estimatedValueLow: num(row.estimated_value_low),
    estimatedValueHigh: num(row.estimated_value_high),
    estimatedRent: num(row.estimated_rent),
    estimatedRentLow: num(row.estimated_rent_low),
    estimatedRentHigh: num(row.estimated_rent_high),
    propertyType: row.property_type,
    bedrooms: num(row.bedrooms),
    bathrooms: num(row.bathrooms),
    livingAreaSqft: num(row.living_area_sqft),
    lotSizeSqft: num(row.lot_size_sqft),
    yearBuilt: row.year_built,
    unitCount: row.unit_count,
    hasGarage: row.has_garage,
    garageSpaces: num(row.garage_spaces),
    garageType: row.garage_type,
    hasPool: row.has_pool,
    poolType: row.pool_type,
    heating: row.heating,
    cooling: row.cooling,
    lastSalePrice: num(row.last_sale_price),
    lastSaleDate: row.last_sale_date,
    taxYear: row.tax_year,
    propertyTaxAnnual: num(row.property_tax_annual),
    assessedValue: num(row.assessed_value),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    photoUrls: parseHomeDataPhotoUrls(row.photo_urls),
    sourceProvider: row.source_provider,
    sourceRecordId: row.source_record_id,
    fetchedAt: row.fetched_at,
    rentLookupComplete: row.rent_lookup_complete === true,
  }
}

export function homeDataFactsToRow(facts: HomeDataFacts): Record<string, unknown> {
  return {
    estimated_value: facts.estimatedValue,
    estimated_value_low: facts.estimatedValueLow,
    estimated_value_high: facts.estimatedValueHigh,
    estimated_rent: facts.estimatedRent,
    estimated_rent_low: facts.estimatedRentLow,
    estimated_rent_high: facts.estimatedRentHigh,
    property_type: facts.propertyType,
    bedrooms: facts.bedrooms,
    bathrooms: facts.bathrooms,
    living_area_sqft: facts.livingAreaSqft,
    lot_size_sqft: facts.lotSizeSqft,
    year_built: facts.yearBuilt,
    unit_count: facts.unitCount,
    has_garage: facts.hasGarage,
    garage_spaces: facts.garageSpaces,
    garage_type: facts.garageType,
    has_pool: facts.hasPool,
    pool_type: facts.poolType,
    heating: facts.heating,
    cooling: facts.cooling,
    last_sale_price: facts.lastSalePrice,
    last_sale_date: facts.lastSaleDate,
    tax_year: facts.taxYear,
    property_tax_annual: facts.propertyTaxAnnual,
    assessed_value: facts.assessedValue,
    latitude: facts.latitude,
    longitude: facts.longitude,
    photo_urls: facts.photoUrls,
  }
}
