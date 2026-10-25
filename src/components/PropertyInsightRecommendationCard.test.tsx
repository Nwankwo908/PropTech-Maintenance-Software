import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SynthesizedInsightCard } from '@shared/portfolioIntelligence/types'
import { PropertyInsightRecommendationCard } from './AdminOverviewDashboard'

const card: SynthesizedInsightCard = {
  id: 'card-1',
  sourceTags: ['RECURRING ISSUES'],
  tag: 'RECURRING ISSUES',
  text: 'Plumbing issues keep occurring in 123 Main. Schedule a diagnostic before the next leak.',
  aggregateText: 'Plumbing issues keep occurring in 123 Main.',
  summary: 'Repeat plumbing leaks',
  urgency: 80,
  confidence: 90,
  actionType: 'schedule_inspection',
  actionLabel: 'Schedule inspection',
  ticketIds: ['t1'],
  ticketSummaries: [{ id: 't1', description: 'Kitchen sink leak' }],
  unitId: null,
  unitLabel: '1',
  categoryLabel: 'Plumbing',
  building: '123 Main',
  requestCount: 3,
  responseRate: null,
  assignedCount: null,
  mode: 'openai',
}

function renderCard(override: Partial<SynthesizedInsightCard> = {}) {
  return renderToStaticMarkup(
    createElement(PropertyInsightRecommendationCard, {
      card: { ...card, ...override },
      scheduling: null,
      onAction: () => undefined,
      onViewDetails: () => undefined,
      onFindExternal: () => undefined,
      actionBusy: false,
    }),
  )
}

describe('PropertyInsightRecommendationCard', () => {
  it('shows the address and a complete summary, and keeps the metrics and actions', () => {
    const html = renderCard()
    expect(html).toMatch(/<p[^>]*>123 Main · Repeat plumbing<\/p>/)
    expect(html).not.toContain('Repeat plumbing leaks')
    expect(html).not.toContain('Schedule a diagnostic')
    expect(html).not.toContain('Unit 1')
    expect(html).toContain('3 Plumbing Requests')
    expect(html).toContain('Last 60 Days')
    expect(html).toContain('Schedule inspection')
    expect(html).toContain('View details')
  })

  it('omits an invented single-family unit used as the address', () => {
    const html = renderCard({ building: 'Unit 1', unitLabel: '1' })
    expect(html).not.toContain('Unit 1')
    expect(html).toContain('Repeat plumbing')
  })
})
