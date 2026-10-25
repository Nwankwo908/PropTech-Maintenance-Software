import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NoInspectorAvailableModal } from './NoInspectorAvailableModal'

describe('NoInspectorAvailableModal', () => {
  it('names the property and offers Find external vendor', () => {
    const html = renderToStaticMarkup(
      createElement(NoInspectorAvailableModal, {
        open: true,
        building: '123 Main',
        targetDay: '2026-10-26',
        onClose: () => undefined,
        onFindExternal: () => undefined,
      }),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('No inspector available for 123 Main on Mon, Oct 26')
    expect(html).toContain('Find external vendor')
  })

  it('stays closed until an inspection has no inspector', () => {
    const html = renderToStaticMarkup(
      createElement(NoInspectorAvailableModal, {
        open: false,
        building: '123 Main',
        targetDay: '2026-10-26',
        onClose: () => undefined,
        onFindExternal: () => undefined,
      }),
    )
    expect(html).toBe('')
  })
})
