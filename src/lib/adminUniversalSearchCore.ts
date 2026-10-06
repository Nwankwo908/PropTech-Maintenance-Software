/**
 * Pure search scoring + prefix index (no Supabase / DOM).
 * Shared by the main thread and the search Web Worker.
 */

export type UniversalSearchCategory =
  | 'property'
  | 'unit'
  | 'resident'
  | 'vendor'
  | 'work_order'
  | 'workflow'
  | 'conversation'
  | 'broadcast'
  | 'document'
  | 'inspection'
  | 'lease_renewal'
  | 'rent_collection'
  | 'report'

export type UniversalSearchItem = {
  id: string
  category: UniversalSearchCategory
  title: string
  subtitle: string
  href: string
  keywords: string
  matchScore?: number
  /** False until richer subtitle/keywords are hydrated for displayed rows. */
  detailLoaded?: boolean
}

export const SEARCH_RESULT_CAP = 40
const PREFIX_MIN = 2
const PREFIX_MAX = 12

export type SearchPrefixIndex = {
  items: UniversalSearchItem[]
  /** prefix → item indices (deduped per prefix). */
  buckets: Map<string, number[]>
}

export type SearchQueryCache = {
  query: string
  results: UniversalSearchItem[]
}

export function normalizeAdminSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function scoreUniversalSearchMatch(
  item: Pick<UniversalSearchItem, 'title' | 'keywords'>,
  query: string,
): number {
  const normalized = normalizeAdminSearchQuery(query)
  if (!normalized) return 0

  const title = item.title.trim().toLowerCase()
  const keywords = item.keywords.trim().toLowerCase()

  if (title === normalized) return 100
  if (title.startsWith(normalized)) return 80
  if (title.includes(normalized)) return 60
  if (keywords.includes(normalized)) return 40

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length <= 1) return 0

  let tokenScore = 0
  for (const token of tokens) {
    if (token.length < 2) continue
    if (title === token) tokenScore = Math.max(tokenScore, 90)
    else if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 70)
    else if (title.includes(token)) tokenScore = Math.max(tokenScore, 50)
    else if (keywords.includes(token)) tokenScore = Math.max(tokenScore, 30)
  }
  return tokenScore
}

function addPrefix(buckets: Map<string, number[]>, prefix: string, idx: number): void {
  const list = buckets.get(prefix)
  if (!list) {
    buckets.set(prefix, [idx])
    return
  }
  if (list[list.length - 1] !== idx) list.push(idx)
}

function indexToken(buckets: Map<string, number[]>, token: string, idx: number): void {
  if (token.length < PREFIX_MIN) return
  const max = Math.min(token.length, PREFIX_MAX)
  for (let len = PREFIX_MIN; len <= max; len += 1) {
    addPrefix(buckets, token.slice(0, len), idx)
  }
}

/** Build once when the index loads; keystroke work then hits candidate sets. */
export function buildSearchPrefixIndex(items: UniversalSearchItem[]): SearchPrefixIndex {
  const buckets = new Map<string, number[]>()
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx]
    const haystack = `${item.title} ${item.keywords}`.toLowerCase()
    const tokens = haystack.split(/[^a-z0-9]+/).filter(Boolean)
    for (const token of tokens) {
      indexToken(buckets, token, idx)
    }
  }
  return { items, buckets }
}

function intersectSorted(a: number[], b: Set<number>): number[] {
  const out: number[] = []
  for (const idx of a) {
    if (b.has(idx)) out.push(idx)
  }
  return out
}

/**
 * Candidate indices for a query via prefix buckets.
 * Returns null when the query is too short to use the prefix map (caller may scan).
 */
export function candidateIndicesForQuery(
  index: SearchPrefixIndex,
  normalizedQuery: string,
): number[] | null {
  const tokens = normalizedQuery.split(' ').filter((t) => t.length >= PREFIX_MIN)
  if (tokens.length === 0) return null

  let current: number[] | null = null
  for (const token of tokens) {
    const key = token.slice(0, Math.min(token.length, PREFIX_MAX))
    const hits = index.buckets.get(key)
    if (!hits?.length) return []
    if (current == null) {
      current = hits
    } else {
      current = intersectSorted(current, new Set(hits))
      if (current.length === 0) return []
    }
  }
  return current ?? []
}

function rankItems(
  items: readonly UniversalSearchItem[],
  normalizedQuery: string,
): UniversalSearchItem[] {
  const ranked: UniversalSearchItem[] = []
  for (const item of items) {
    const matchScore = scoreUniversalSearchMatch(item, normalizedQuery)
    if (matchScore > 0) {
      ranked.push({ ...item, matchScore })
    }
  }
  ranked.sort((a, b) => {
    const scoreDiff = (b.matchScore ?? 0) - (a.matchScore ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    return a.title.localeCompare(b.title)
  })
  return ranked.slice(0, SEARCH_RESULT_CAP)
}

/**
 * Score only prefix candidates, or incrementally filter the previous result set
 * when the user is extending the prior query (typical typing).
 */
export function searchWithPrefixIndex(
  index: SearchPrefixIndex,
  query: string,
  previous?: SearchQueryCache | null,
): UniversalSearchItem[] {
  const normalized = normalizeAdminSearchQuery(query)
  if (!normalized) return []

  const prevNormalized = previous ? normalizeAdminSearchQuery(previous.query) : ''
  if (
    previous &&
    prevNormalized.length >= PREFIX_MIN &&
    normalized.startsWith(prevNormalized) &&
    previous.results.length > 0
  ) {
    return rankItems(previous.results, normalized)
  }

  const candidates = candidateIndicesForQuery(index, normalized)
  if (candidates == null) {
    // 1-char / tiny query: only check title prefix to stay cheap.
    const out: UniversalSearchItem[] = []
    for (const item of index.items) {
      if (item.title.toLowerCase().startsWith(normalized)) {
        out.push({ ...item, matchScore: 80 })
        if (out.length >= SEARCH_RESULT_CAP) break
      }
    }
    return out
  }

  const pool = candidates.map((idx) => index.items[idx]).filter(Boolean)
  return rankItems(pool, normalized)
}

/** Legacy linear scan (kept for benchmarks / fallback). */
export function searchAdminIndexLinear(
  items: readonly UniversalSearchItem[],
  query: string,
): UniversalSearchItem[] {
  const normalized = normalizeAdminSearchQuery(query)
  if (!normalized) return []
  return rankItems(items, normalized)
}
