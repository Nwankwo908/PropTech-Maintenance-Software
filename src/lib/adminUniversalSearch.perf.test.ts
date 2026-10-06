import { describe, expect, it } from 'vitest'
import {
  buildSearchPrefixIndex,
  searchAdminIndexLinear,
  searchWithPrefixIndex,
  type UniversalSearchItem,
} from '@/lib/adminUniversalSearchCore'

function makeBusyIndex(count = 1600): UniversalSearchItem[] {
  const categories = [
    'property',
    'unit',
    'resident',
    'vendor',
    'work_order',
    'workflow',
  ] as const
  const items: UniversalSearchItem[] = []
  for (let i = 0; i < count; i += 1) {
    const category = categories[i % categories.length]
    const name = `${category} item ${i} maple avenue suite ${i % 50}`
    items.push({
      id: `${category}:${i}`,
      category,
      title: name,
      subtitle: `Subtitle ${i}`,
      href: `/admin/${category}/${i}`,
      keywords: `${name} keyword${i % 17} building${i % 40}`,
      detailLoaded: true,
    })
  }
  // Guaranteed match targets for the typed sequence.
  items.push({
    id: 'resident:target',
    category: 'resident',
    title: 'Jordan Maple',
    subtitle: '14 Maple Ave',
    href: '/admin/residents/target',
    keywords: 'jordan maple resident tenant',
    detailLoaded: true,
  })
  return items
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

describe('adminUniversalSearch performance (busy ~1.6k index)', () => {
  const items = makeBusyIndex(1600)
  const prefix = buildSearchPrefixIndex(items)
  const sequence = ['j', 'jo', 'jor', 'jord', 'jordan']

  it('prefix/incremental search is much cheaper than full linear re-score per keystroke', () => {
    const linearSamples: number[] = []
    const prefixSamples: number[] = []

    // Warm
    searchAdminIndexLinear(items, 'jordan')
    searchWithPrefixIndex(prefix, 'jordan')

    for (let run = 0; run < 25; run += 1) {
      let prev: { query: string; results: UniversalSearchItem[] } | null = null
      let linearTotal = 0
      let prefixTotal = 0

      for (const q of sequence) {
        const a0 = performance.now()
        searchAdminIndexLinear(items, q)
        linearTotal += performance.now() - a0

        const b0 = performance.now()
        const results = searchWithPrefixIndex(prefix, q, prev)
        prefixTotal += performance.now() - b0
        prev = { query: q, results }
      }

      linearSamples.push(linearTotal)
      prefixSamples.push(prefixTotal)
    }

    const linearMed = median(linearSamples)
    const prefixMed = median(prefixSamples)

    // Report for the task: before/after keystroke-sequence timing.
    // eslint-disable-next-line no-console
    console.log(
      `[admin search perf] keystroke sequence ${sequence.join('→')} on ${items.length} items — ` +
        `linear(median)=${linearMed.toFixed(3)}ms prefix+incremental(median)=${prefixMed.toFixed(3)}ms ` +
        `speedup≈${(linearMed / Math.max(prefixMed, 0.001)).toFixed(1)}x`,
    )

    expect(prefixMed).toBeLessThan(linearMed)
    // Soft bound: prefix path should stay under a few ms for this synthetic set.
    expect(prefixMed).toBeLessThan(12)
  })

  it('continuation queries only re-score the previous match set', () => {
    const first = searchWithPrefixIndex(prefix, 'jordan')
    expect(first.length).toBeGreaterThan(0)

    const t0 = performance.now()
    const second = searchWithPrefixIndex(prefix, 'jordan m', {
      query: 'jordan',
      results: first,
    })
    const elapsed = performance.now() - t0

    expect(second.every((item) => (item.matchScore ?? 0) > 0)).toBe(true)
    expect(elapsed).toBeLessThan(3)
  })
})
