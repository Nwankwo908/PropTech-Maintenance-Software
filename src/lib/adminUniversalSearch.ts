/**
 * Admin universal search — public API.
 * Heavy lifting: staged load + in-memory TTL cache, prefix index, worker search.
 */

import {
  normalizeAdminSearchQuery,
  scoreUniversalSearchMatch,
  searchAdminIndexLinear,
  searchWithPrefixIndex,
  buildSearchPrefixIndex,
  SEARCH_RESULT_CAP,
  type UniversalSearchCategory,
  type UniversalSearchItem,
} from '@/lib/adminUniversalSearchCore'
import {
  ADMIN_SEARCH_INVALIDATE_EVENT,
  ADMIN_SEARCH_INDEX_TTL_MS,
  ensureAdminSearchIndex,
  getCachedAdminSearchItems,
  hydrateAdminSearchResultDetails,
  invalidateAdminSearchIndex,
  prefetchAdminSearchIndex,
  queryAdminSearchIndex,
  searchCachedAdminIndex,
} from '@/lib/adminUniversalSearchCache'

export type { UniversalSearchCategory, UniversalSearchItem }

export {
  normalizeAdminSearchQuery,
  scoreUniversalSearchMatch,
  SEARCH_RESULT_CAP,
  ADMIN_SEARCH_INVALIDATE_EVENT,
  ADMIN_SEARCH_INDEX_TTL_MS,
  ensureAdminSearchIndex,
  getCachedAdminSearchItems,
  hydrateAdminSearchResultDetails,
  invalidateAdminSearchIndex,
  prefetchAdminSearchIndex,
  queryAdminSearchIndex,
  searchCachedAdminIndex,
  buildSearchPrefixIndex,
  searchWithPrefixIndex,
  searchAdminIndexLinear,
}

export type RecentSearchKind = 'record' | 'ask'

export type RecentSearchItem = {
  title: string
  href?: string
  kind: RecentSearchKind
  query: string
}

export type GroupedSearchResults = {
  category: UniversalSearchCategory
  label: string
  items: UniversalSearchItem[]
}

export const CATEGORY_META: Record<
  UniversalSearchCategory,
  { label: string; symbol: string }
> = {
  property: { label: 'Properties', symbol: '🏢' },
  unit: { label: 'Units', symbol: '🚪' },
  resident: { label: 'Residents', symbol: '👤' },
  vendor: { label: 'Vendors', symbol: '🔧' },
  work_order: { label: 'Work Orders', symbol: '🛠' },
  workflow: { label: 'Workflows', symbol: '⚙️' },
  conversation: { label: 'Conversations', symbol: '💬' },
  broadcast: { label: 'Broadcasts', symbol: '📣' },
  document: { label: 'Documents', symbol: '📄' },
  inspection: { label: 'Inspections', symbol: '🔍' },
  lease_renewal: { label: 'Lease Renewals', symbol: '📝' },
  rent_collection: { label: 'Rent Collection', symbol: '💵' },
  report: { label: 'Reports', symbol: '📊' },
}

/** Suggested Ask Ulo prompts from the unified search product brief. */
export const SUGGESTED_ASK_ULO_PROMPTS: readonly string[] = [
  'Which work orders are overdue?',
  'Show vendor verification status.',
  'Which residents have unpaid rent?',
  'What should I focus on today?',
  'Which properties have critical maintenance?',
  'Show upcoming lease renewals.',
]

const RECENT_SEARCH_MAX = 8
const RECENT_SEARCH_PREFIX = 'ulo.admin.universalSearch.recent.'

const CATEGORY_GROUP_ORDER: UniversalSearchCategory[] = [
  'property',
  'unit',
  'resident',
  'vendor',
  'work_order',
  'workflow',
  'conversation',
  'broadcast',
  'document',
  'inspection',
  'lease_renewal',
  'rent_collection',
  'report',
]

function isProperNameLikeQuery(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed.includes('?')) return false
  if (/^(who|what|which|how|why|when|where|show|list|find|tell me|give me)\b/i.test(trimmed)) {
    return false
  }
  if (
    /\b(overdue|trends?|attention|unpaid|critical|maintenance|workflow|vendor|resident|rent|lease)\b/i.test(
      trimmed,
    )
  ) {
    return false
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 3) return false

  const nameLike = words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))
  return nameLike
}

/** Detect natural-language Ask Ulo questions vs record navigation queries. */
export function looksLikeAskUloQuestion(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  if (isProperNameLikeQuery(trimmed)) return false

  if (trimmed.includes('?')) return true

  const lower = trimmed.toLowerCase()

  if (/^(who|what|which|how|why|when|where)\b/.test(lower)) return true
  if (/\b(show me|show|list|find|summarize|compare|rank|explain|tell me|give me)\b/.test(lower)) {
    return true
  }
  if (
    /\b(overdue|trends?|attention|prioriti[sz]e|unpaid|critical|recurring|stuck|blocked|escalated|waiting|missing|upcoming|happening|focus on|need(?:s)? my attention)\b/.test(
      lower,
    )
  ) {
    return true
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (
    words.length >= 3 &&
    /\b(are|is|have|has|need|needs|should|can|do|does|did|will|would|am|was|were)\b/i.test(trimmed)
  ) {
    return true
  }

  return false
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), waitMs)
  }
}

function recentStorageKey(landlordId: string): string {
  return `${RECENT_SEARCH_PREFIX}${landlordId}`
}

function sanitizeRecentItem(raw: unknown): RecentSearchItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const query = typeof row.query === 'string' ? row.query.trim() : ''
  const kind = row.kind === 'ask' ? 'ask' : row.kind === 'record' ? 'record' : null
  if (!title || !query || !kind) return null
  const href = typeof row.href === 'string' ? row.href.trim() : ''
  return {
    title,
    query,
    kind,
    href: href || undefined,
  }
}

export function loadRecentSearches(landlordId: string): RecentSearchItem[] {
  if (typeof window === 'undefined' || !landlordId.trim()) return []
  try {
    const raw = window.localStorage.getItem(recentStorageKey(landlordId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeRecentItem)
      .filter((item): item is RecentSearchItem => item != null)
      .slice(0, RECENT_SEARCH_MAX)
  } catch {
    return []
  }
}

export function pushRecentSearch(landlordId: string, item: RecentSearchItem): void {
  if (typeof window === 'undefined' || !landlordId.trim()) return
  const title = item.title.trim()
  const query = item.query.trim()
  if (!title || !query) return

  const next: RecentSearchItem = {
    title,
    query,
    kind: item.kind,
    href: item.href?.trim() || undefined,
  }

  const existing = loadRecentSearches(landlordId).filter(
    (entry) => entry.query.toLowerCase() !== query.toLowerCase(),
  )
  const merged = [next, ...existing].slice(0, RECENT_SEARCH_MAX)

  try {
    window.localStorage.setItem(recentStorageKey(landlordId), JSON.stringify(merged))
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Sync search helper (tests + fallback). Prefer `queryAdminSearchIndex` in UI
 * so work runs in the worker against a prefix index.
 */
export function searchAdminIndex(
  items: UniversalSearchItem[],
  query: string,
): UniversalSearchItem[] {
  const index = buildSearchPrefixIndex(items)
  return searchWithPrefixIndex(index, query)
}

export function groupSearchResults(items: UniversalSearchItem[]): GroupedSearchResults[] {
  const buckets = new Map<UniversalSearchCategory, UniversalSearchItem[]>()
  for (const item of items) {
    const list = buckets.get(item.category) ?? []
    list.push(item)
    buckets.set(item.category, list)
  }

  return CATEGORY_GROUP_ORDER.flatMap((category) => {
    const groupItems = buckets.get(category)
    if (!groupItems?.length) return []
    return [
      {
        category,
        label: CATEGORY_META[category].label,
        items: groupItems,
      },
    ]
  })
}

/** @deprecated Prefer ensureAdminSearchIndex — kept for callers/tests. */
export async function loadAdminSearchIndex(landlordId: string): Promise<UniversalSearchItem[]> {
  return ensureAdminSearchIndex(landlordId)
}
