import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/adminUniversalSearchLoad', () => ({
  loadAdminSearchIndexLight: vi.fn(async () => [
    {
      id: 'resident:1',
      category: 'resident',
      title: 'Alex River',
      subtitle: 'Resident',
      href: '/admin/residents/1',
      keywords: 'alex river resident',
      detailLoaded: true,
    },
  ]),
  loadAdminSearchIndexHeavy: vi.fn(async () => [
    {
      id: 'work-order:9',
      category: 'work_order',
      title: 'Unit 2 – Sink leak',
      subtitle: 'Maintenance',
      href: '/admin/requests?q=sink',
      keywords: 'sink leak work order',
      detailLoaded: false,
    },
  ]),
  enrichSearchItemsDetail: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/adminNavigation', () => ({
  getAdminNavSearchItems: () => [
    {
      id: 'nav-overview',
      category: 'report',
      title: 'Overview',
      subtitle: 'Dashboard',
      href: '/admin',
      keywords: 'overview dashboard',
    },
  ],
}))

vi.mock('@/lib/adminUniversalSearchWorkerBridge', async () => {
  const core = await import('@/lib/adminUniversalSearchCore')
  let prefix: ReturnType<typeof core.buildSearchPrefixIndex> | null = null
  let previous: { query: string; results: core.UniversalSearchItem[] } | null = null
  return {
    setSearchWorkerIndex: (items: core.UniversalSearchItem[]) => {
      prefix = core.buildSearchPrefixIndex(items)
      previous = null
    },
    clearSearchWorkerIndex: () => {
      prefix = null
      previous = null
    },
    searchAdminIndexAsync: async (query: string) => {
      const started = performance.now()
      if (!prefix) return { results: [], timedMs: 0 }
      const results = core.searchWithPrefixIndex(prefix, query, previous)
      previous = { query, results }
      return { results, timedMs: performance.now() - started }
    },
  }
})

describe('adminUniversalSearchCache', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { invalidateAdminSearchIndex } = await import('@/lib/adminUniversalSearchCache')
    invalidateAdminSearchIndex()
  })

  it('reports cold then warm ensure/query timings', async () => {
    const {
      ensureAdminSearchIndex,
      getCachedAdminSearchItems,
      queryAdminSearchIndex,
      invalidateAdminSearchIndex,
    } = await import('@/lib/adminUniversalSearchCache')

    invalidateAdminSearchIndex('landlord-a')
    expect(getCachedAdminSearchItems('landlord-a')).toBeNull()

    const coldStart = performance.now()
    const cold = await queryAdminSearchIndex('landlord-a', 'alex')
    const coldOpenMs = performance.now() - coldStart

    expect(cold.cache).toBe('cold')
    expect(cold.results.some((r) => r.title.includes('Alex'))).toBe(true)

    const warmStart = performance.now()
    const warm = await queryAdminSearchIndex('landlord-a', 'alex')
    const warmOpenMs = performance.now() - warmStart

    expect(warm.cache).toBe('warm')
    expect(getCachedAdminSearchItems('landlord-a')).not.toBeNull()

    // eslint-disable-next-line no-console
    console.log(
      `[admin search perf] dropdown-open-to-first-results — cold=${coldOpenMs.toFixed(2)}ms ` +
        `warm=${warmOpenMs.toFixed(2)}ms searchWorkerMs cold/warm=${cold.timedMs.toFixed(3)}/${warm.timedMs.toFixed(3)}`,
    )

    expect(warmOpenMs).toBeLessThanOrEqual(coldOpenMs + 5)
    await ensureAdminSearchIndex('landlord-a')
  })
})
