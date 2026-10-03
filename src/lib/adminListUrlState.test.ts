import { describe, expect, it } from 'vitest'
import {
  listScrollKey,
  mutateSearchParams,
  readCsvSet,
  readStringParam,
  writeCsvSet,
  writeStringParam,
} from './adminListUrlState'

describe('adminListUrlState', () => {
  it('reads and writes csv sets sorted and omits empty', () => {
    const params = new URLSearchParams()
    writeCsvSet(params, 'filters', ['critical', 'maintenance'])
    expect(params.get('filters')).toBe('critical,maintenance')
    expect(Array.from(readCsvSet(params, 'filters'))).toEqual(['critical', 'maintenance'])

    writeCsvSet(params, 'filters', [])
    expect(params.has('filters')).toBe(false)
  })

  it('omits default string params', () => {
    const params = new URLSearchParams('q=hello')
    writeStringParam(params, 'q', '  ')
    expect(params.has('q')).toBe(false)
    writeStringParam(params, 'who', 'all', 'all')
    expect(params.has('who')).toBe(false)
    writeStringParam(params, 'who', 'tenant', 'all')
    expect(params.get('who')).toBe('tenant')
    expect(readStringParam(params, 'who', 'all')).toBe('tenant')
  })

  it('mutates a copy of search params', () => {
    const current = new URLSearchParams('q=a')
    const next = mutateSearchParams(current, (p) => {
      p.set('run', 'abc')
    })
    expect(current.get('run')).toBeNull()
    expect(next.get('run')).toBe('abc')
    expect(next.get('q')).toBe('a')
  })

  it('excludes panel params from scroll keys', () => {
    expect(listScrollKey('/admin/workflows', '?filters=critical&run=abc')).toBe(
      '/admin/workflows?filters=critical',
    )
    expect(listScrollKey('/admin/communication', '?thread=t1&who=tenant')).toBe(
      '/admin/communication?who=tenant',
    )
  })
})
