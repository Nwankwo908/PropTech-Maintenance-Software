import { describe, expect, it } from 'vitest'
import { mutateSearchParams, writeCsvSet, writeStringParam } from './adminListUrlState'
import { parsePropertyDetailTab, propertyDetailPath } from './propertyRoutes'

describe('admin panel / list URL persistence contracts', () => {
  it('Active Tasks: opening a run pushes run while keeping filters', () => {
    const list = new URLSearchParams('filters=critical,maintenance')
    const withPanel = mutateSearchParams(list, (next) => {
      next.set('run', 'run-abc')
    })
    expect(withPanel.get('run')).toBe('run-abc')
    expect(withPanel.get('filters')).toBe('critical,maintenance')
    expect(list.get('run')).toBeNull()
  })

  it('Active Tasks: closing a run clears run and keeps filters', () => {
    const open = new URLSearchParams('filters=lease&run=run-abc')
    const closed = mutateSearchParams(open, (next) => {
      next.delete('run')
    })
    expect(closed.get('run')).toBeNull()
    expect(closed.get('filters')).toBe('lease')
  })

  it('Messages: opening a thread pushes thread while keeping who/lane', () => {
    const list = new URLSearchParams('who=tenant&lane=onboarding')
    writeStringParam(list, 'who', 'tenant', 'all')
    const withPanel = mutateSearchParams(list, (next) => {
      next.set('thread', 'conv-1')
    })
    expect(withPanel.get('thread')).toBe('conv-1')
    expect(withPanel.get('who')).toBe('tenant')
    expect(withPanel.get('lane')).toBe('onboarding')
  })

  it('filter writes omit defaults so URLs stay shareable and clean', () => {
    const params = new URLSearchParams()
    writeCsvSet(params, 'filters', ['maintenance'])
    writeStringParam(params, 'q', '  Acme  ')
    writeStringParam(params, 'sort', 'desc', 'desc')
    writeStringParam(params, 'who', 'all', 'all')
    writeStringParam(params, 'lane', 'request', 'request')
    expect(params.toString()).toBe('filters=maintenance&q=Acme')
  })

  it('Property Intelligence: ?tab=details is shareable via propertyDetailPath', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(propertyDetailPath(id, 'details')).toBe(
      `/admin/properties/${id}?tab=details`,
    )
    expect(parsePropertyDetailTab('details')).toBe('details')
    expect(parsePropertyDetailTab(null)).toBe('overview')
  })
})
