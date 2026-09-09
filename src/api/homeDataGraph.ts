import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'
import {
  emptyHomeDataFacts,
  homeDataSnapshotFromRow,
  parseHomeDataPhotoUrls,
  type HomeDataGraphRow,
  type HomeDataGraphSnapshot,
} from '@shared/homeDataGraph'

export type SyncHomeDataGraphOk = {
  snapshot: HomeDataGraphSnapshot | null
  refreshed: boolean
  configured: boolean
  lookupError: string | null
}

export function resolveSyncHomeDataGraphUrl(): string | null {
  const explicit = import.meta.env.VITE_SYNC_HOME_DATA_GRAPH_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/sync-home-data-graph`
  return null
}

function snapshotFromUnknown(raw: unknown): HomeDataGraphSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.property_id === 'string' && row.property_id.trim()) {
    return homeDataSnapshotFromRow(row as HomeDataGraphRow)
  }
  const propertyId = typeof row.propertyId === 'string' ? row.propertyId : ''
  const landlordId = typeof row.landlordId === 'string' ? row.landlordId : ''
  if (!propertyId || !landlordId) return null
  const facts = emptyHomeDataFacts()
  const num = (key: keyof typeof facts): number | null => {
    const v = row[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.replace(/[$,]/g, ''))
      if (Number.isFinite(n)) return n
    }
    return null
  }
  const str = (key: string): string | null =>
    typeof row[key] === 'string' && String(row[key]).trim() ? String(row[key]) : null
  const bool = (key: string): boolean | null =>
    typeof row[key] === 'boolean' ? (row[key] as boolean) : null
  return {
    ...facts,
    propertyId,
    landlordId,
    estimatedValue: num('estimatedValue'),
    estimatedValueLow: num('estimatedValueLow'),
    estimatedValueHigh: num('estimatedValueHigh'),
    estimatedRent: num('estimatedRent'),
    estimatedRentLow: num('estimatedRentLow'),
    estimatedRentHigh: num('estimatedRentHigh'),
    propertyType: str('propertyType'),
    bedrooms: num('bedrooms'),
    bathrooms: num('bathrooms'),
    livingAreaSqft: num('livingAreaSqft'),
    lotSizeSqft: num('lotSizeSqft'),
    yearBuilt: num('yearBuilt'),
    unitCount: num('unitCount'),
    hasGarage: bool('hasGarage'),
    garageSpaces: num('garageSpaces'),
    garageType: str('garageType'),
    hasPool: bool('hasPool'),
    poolType: str('poolType'),
    heating: str('heating'),
    cooling: str('cooling'),
    lastSalePrice: num('lastSalePrice'),
    lastSaleDate: str('lastSaleDate'),
    taxYear: num('taxYear'),
    propertyTaxAnnual: num('propertyTaxAnnual'),
    assessedValue: num('assessedValue'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    photoUrls: parseHomeDataPhotoUrls(row.photoUrls),
    sourceProvider: str('sourceProvider') ?? '',
    sourceRecordId: str('sourceRecordId'),
    fetchedAt: str('fetchedAt') ?? new Date().toISOString(),
    rentLookupComplete: row.rentLookupComplete === true,
  }
}

export async function postSyncHomeDataGraph(input: {
  url: string
  secret: string
  propertyId: string
  landlordId: string
  address: string
  force?: boolean
}): Promise<SyncHomeDataGraphOk> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(input.secret.trim()),
    body: JSON.stringify({
      propertyId: input.propertyId.trim(),
      landlordId: input.landlordId.trim(),
      address: input.address.trim(),
      force: input.force === true,
    }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Property data: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Property data failed (${res.status})`
    if (res.status === 401 && String(err.error ?? '').toLowerCase() === 'unauthorized') {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  const parsed = body as {
    snapshot?: unknown
    refreshed?: unknown
    configured?: unknown
    lookupError?: unknown
  }
  return {
    snapshot: snapshotFromUnknown(parsed.snapshot),
    refreshed: parsed.refreshed === true,
    configured: parsed.configured !== false,
    lookupError:
      typeof parsed.lookupError === 'string' && parsed.lookupError.trim()
        ? parsed.lookupError
        : null,
  }
}
