import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Supabase Docker bundling cannot resolve imports outside supabase/functions/.
 * Keep the Edge-vendored pure module identical to the shared source of truth.
 */
describe('insightInspectorScheduling edge parity', () => {
  it('matches shared/portfolioIntelligence (full module, not a stub)', () => {
    const root = resolve(import.meta.dirname, '../..')
    const sharedPath = resolve(
      root,
      'shared/portfolioIntelligence/insightInspectorScheduling.ts',
    )
    const edgePath = resolve(
      root,
      'supabase/functions/_shared/portfolioIntelligence/insightInspectorScheduling.ts',
    )
    const shared = readFileSync(sharedPath, 'utf8')
    const edge = readFileSync(edgePath, 'utf8')

    // Strip twin-path header comments so body must match.
    const stripHeader = (src: string) =>
      src.replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '').trim()

    expect(stripHeader(edge)).toBe(stripHeader(shared))
    expect(stripHeader(edge)).toContain('decideInsightInspectorScheduling')
    expect(stripHeader(edge)).toContain('entersInspectorSchedulingFlow')
    expect(stripHeader(edge)).toContain('listFreeInspectorsForDay')
    expect(stripHeader(edge).length).toBeGreaterThan(2000)
  })
})
