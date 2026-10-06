import { getAdminNavSearchItems } from '@/lib/adminNavigation'
import {
  buildSearchPrefixIndex,
  searchWithPrefixIndex,
  type SearchPrefixIndex,
  type UniversalSearchItem,
} from '@/lib/adminUniversalSearchCore'
import {
  clearSearchWorkerIndex,
  searchAdminIndexAsync,
  setSearchWorkerIndex,
} from '@/lib/adminUniversalSearchWorkerBridge'
import {
  loadAdminSearchIndexHeavy,
  loadAdminSearchIndexLight,
  enrichSearchItemsDetail,
} from '@/lib/adminUniversalSearchLoad'

export const ADMIN_SEARCH_INVALIDATE_EVENT = 'ulo:admin-search-invalidate'
/** In-memory TTL — avoids sessionStorage stale-on-return while limiting refetch churn. */
export const ADMIN_SEARCH_INDEX_TTL_MS = 90_000

type CacheEntry = {
  landlordId: string
  items: UniversalSearchItem[]
  prefixIndex: SearchPrefixIndex
  loadedAt: number
  stage: 'light' | 'full'
  lightPromise?: Promise<UniversalSearchItem[]>
  heavyPromise?: Promise<UniversalSearchItem[]>
}

const cacheByLandlord = new Map<string, CacheEntry>()

function emitInvalidate(landlordId: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(ADMIN_SEARCH_INVALIDATE_EVENT, { detail: { landlordId } }),
    )
  } catch {
    // jsdom / private mode
  }
}

function publishIndex(entry: CacheEntry): void {
  entry.prefixIndex = buildSearchPrefixIndex(entry.items)
  setSearchWorkerIndex(entry.items)
}

export function getCachedAdminSearchItems(landlordId: string): UniversalSearchItem[] | null {
  const entry = cacheByLandlord.get(landlordId)
  if (!entry) return null
  if (Date.now() - entry.loadedAt > ADMIN_SEARCH_INDEX_TTL_MS) return null
  return entry.items
}

export function invalidateAdminSearchIndex(landlordId?: string): void {
  if (landlordId?.trim()) {
    cacheByLandlord.delete(landlordId.trim())
    clearSearchWorkerIndex()
    emitInvalidate(landlordId.trim())
    return
  }
  cacheByLandlord.clear()
  clearSearchWorkerIndex()
  emitInvalidate('')
}

function upsertEntry(
  landlordId: string,
  items: UniversalSearchItem[],
  stage: 'light' | 'full',
): CacheEntry {
  const entry: CacheEntry = {
    landlordId,
    items,
    prefixIndex: buildSearchPrefixIndex(items),
    loadedAt: Date.now(),
    stage,
  }
  cacheByLandlord.set(landlordId, entry)
  publishIndex(entry)
  return entry
}

async function ensureLight(landlordId: string): Promise<CacheEntry> {
  const existing = cacheByLandlord.get(landlordId)
  if (
    existing &&
    Date.now() - existing.loadedAt <= ADMIN_SEARCH_INDEX_TTL_MS &&
    existing.items.length > 0
  ) {
    return existing
  }
  if (existing?.lightPromise) {
    await existing.lightPromise
    return cacheByLandlord.get(landlordId) ?? upsertEntry(landlordId, [], 'light')
  }

  const lightPromise = (async () => {
    const nav = getAdminNavSearchItems() as UniversalSearchItem[]
    const light = await loadAdminSearchIndexLight(landlordId)
    return [...nav, ...light]
  })()

  cacheByLandlord.set(landlordId, {
    landlordId,
    items: existing?.items ?? [],
    prefixIndex: existing?.prefixIndex ?? buildSearchPrefixIndex([]),
    loadedAt: existing?.loadedAt ?? 0,
    stage: existing?.stage ?? 'light',
    lightPromise,
    heavyPromise: existing?.heavyPromise,
  })

  try {
    const items = await lightPromise
    return upsertEntry(landlordId, items, 'light')
  } finally {
    const entry = cacheByLandlord.get(landlordId)
    if (entry) entry.lightPromise = undefined
  }
}

async function ensureHeavy(landlordId: string): Promise<CacheEntry> {
  const base = await ensureLight(landlordId)
  if (base.stage === 'full' && Date.now() - base.loadedAt <= ADMIN_SEARCH_INDEX_TTL_MS) {
    return base
  }
  if (base.heavyPromise) {
    await base.heavyPromise
    return cacheByLandlord.get(landlordId) ?? base
  }

  const heavyPromise = loadAdminSearchIndexHeavy(landlordId)
  base.heavyPromise = heavyPromise
  try {
    const heavy = await heavyPromise
    const byId = new Map(base.items.map((item) => [item.id, item]))
    for (const item of heavy) byId.set(item.id, item)
    return upsertEntry(landlordId, [...byId.values()], 'full')
  } finally {
    const entry = cacheByLandlord.get(landlordId)
    if (entry) entry.heavyPromise = undefined
  }
}

/** Warm cache: light pass first (fast paint), then heavy types in the background. */
export async function ensureAdminSearchIndex(
  landlordId: string,
): Promise<UniversalSearchItem[]> {
  const id = landlordId.trim()
  if (!id) return getAdminNavSearchItems() as UniversalSearchItem[]

  const light = await ensureLight(id)
  void ensureHeavy(id).catch(() => {
    /* best-effort */
  })
  return light.items
}

export function prefetchAdminSearchIndex(landlordId: string): void {
  const id = landlordId.trim()
  if (!id || typeof window === 'undefined') return

  const run = () => {
    void ensureAdminSearchIndex(id).catch(() => {
      /* ignore */
    })
  }

  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
  ).requestIdleCallback

  if (typeof ric === 'function') {
    ric(run, { timeout: 2500 })
  } else {
    window.setTimeout(run, 400)
  }
}

export async function queryAdminSearchIndex(
  landlordId: string,
  query: string,
): Promise<{ results: UniversalSearchItem[]; timedMs: number; cache: 'warm' | 'cold' }> {
  const id = landlordId.trim()
  const warm = getCachedAdminSearchItems(id) != null
  await ensureAdminSearchIndex(id)
  const { results, timedMs } = await searchAdminIndexAsync(query)
  return { results, timedMs, cache: warm ? 'warm' : 'cold' }
}

/** Sync search against the in-memory prefix index (tests / fallback). */
export function searchCachedAdminIndex(
  landlordId: string,
  query: string,
): UniversalSearchItem[] {
  const entry = cacheByLandlord.get(landlordId.trim())
  if (!entry) return []
  return searchWithPrefixIndex(entry.prefixIndex, query)
}

export async function hydrateAdminSearchResultDetails(
  landlordId: string,
  items: UniversalSearchItem[],
): Promise<UniversalSearchItem[]> {
  const needs = items.filter((item) => item.detailLoaded === false)
  if (needs.length === 0) return items
  const enriched = await enrichSearchItemsDetail(
    landlordId,
    needs.map((item) => item.id),
  )
  if (enriched.size === 0) return items

  const entry = cacheByLandlord.get(landlordId.trim())
  if (entry) {
    entry.items = entry.items.map((item) => enriched.get(item.id) ?? item)
    publishIndex(entry)
  }

  return items.map((item) => enriched.get(item.id) ?? item)
}
