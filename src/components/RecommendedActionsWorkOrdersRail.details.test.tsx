import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecommendedActionsWorkOrdersRail } from './RecommendedActionsWorkOrdersRail'

describe('recommended action details', () => {
  it('shows the address once, then the issue and recommended action', () => {
    const html = renderToStaticMarkup(
      createElement(RecommendedActionsWorkOrdersRail, {
        open: true,
        title: 'Recurring Issues',
        subtitle: '123 Main',
        mainIssue: 'Repeated kitchen sink leaks.',
        recommendedAction:
          'Schedule a plumbing inspection to identify the cause and prevent repeat repairs.',
        items: [
          {
            id: 'wo-1',
            title: 'Kitchen sink leak',
            summary: 'Under the cabinet',
            context: '123 Main · Unit 4B',
            categoryLabel: 'Plumbing',
            statusLabel: 'Open',
            critical: false,
          },
        ],
        onClose: () => undefined,
        onSelect: () => undefined,
      }),
    )
    expect(html.match(/123 Main/g)).toHaveLength(1)
    expect(html).toContain('Main issue')
    expect(html).toContain('Repeated kitchen sink leaks.')
    expect(html).toContain('Recommended action')
    expect(html).toContain(
      'Schedule a plumbing inspection to identify the cause and prevent repeat repairs.',
    )
    expect(html).toContain('Unit 4B')
    expect(html).toContain('Kitchen sink leak')
    expect(html).toContain('Close')
    expect(html).not.toContain('Plumbing issues keep occurring')
  })
})
