import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortfolioInsightFinding, SynthesizedInsightCard } from '@shared/portfolioIntelligence'

const fetchAdminEdgeFunction = vi.fn()

vi.mock('@/api/adminReassignVendor', () => ({
  adminEdgeInvokeHeaders: () => ({}),
  fetchAdminEdgeFunction: (...args: unknown[]) => fetchAdminEdgeFunction(...args),
}))

const store = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  },
})

const { readCachedPropertyInsightCards, synthesizePropertyInsightsCached } = await import(
  '@/api/synthesizePropertyInsights'
)

const LANDLORD = 'landlord-1'

function finding(requestCount: number): PortfolioInsightFinding {
  return {
    tag: 'RISK',
    text: `${requestCount} plumbing requests at Oak`,
    score: 80,
    building: 'Oak',
    requestCount,
    ticketIds: ['t1'],
  }
}

function card(text: string): SynthesizedInsightCard {
  return { id: 'c1', text, mode: 'openai' } as SynthesizedInsightCard
}

function respondWith(body: unknown) {
  fetchAdminEdgeFunction.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  })
}

function synthesize(findings: PortfolioInsightFinding[]) {
  return synthesizePropertyInsightsCached({ url: 'https://x', secret: 's', landlordId: LANDLORD, findings })
}

describe('synthesizePropertyInsightsCached', () => {
  beforeEach(() => {
    store.clear()
    fetchAdminEdgeFunction.mockReset()
  })

  it('reuses saved cards while the findings are unchanged', async () => {
    respondWith({ mode: 'openai', cards: [card('Inspect Oak plumbing')] })
    await synthesize([finding(3)])
    const again = await synthesize([finding(3)])

    expect(fetchAdminEdgeFunction).toHaveBeenCalledTimes(1)
    expect(again.cards[0]?.text).toBe('Inspect Oak plumbing')
    expect(readCachedPropertyInsightCards(LANDLORD, [finding(3)])?.[0]?.text).toBe(
      'Inspect Oak plumbing',
    )
  })

  it('regenerates when the numbers change', async () => {
    respondWith({ mode: 'openai', cards: [card('3 requests')] })
    respondWith({ mode: 'openai', cards: [card('4 requests')] })
    await synthesize([finding(3)])
    const next = await synthesize([finding(4)])

    expect(fetchAdminEdgeFunction).toHaveBeenCalledTimes(2)
    expect(next.cards[0]?.text).toBe('4 requests')
    expect(readCachedPropertyInsightCards(LANDLORD, [finding(3)])).toBeNull()
  })

  it('shares one request across concurrent loads', async () => {
    respondWith({ mode: 'openai', cards: [card('once')] })
    await Promise.all([synthesize([finding(5)]), synthesize([finding(5)])])
    expect(fetchAdminEdgeFunction).toHaveBeenCalledTimes(1)
  })

  it('does not save fallback results', async () => {
    respondWith({ mode: 'fallback', cards: [card('plain')] })
    respondWith({ mode: 'openai', cards: [card('ai')] })
    await synthesize([finding(6)])
    expect(readCachedPropertyInsightCards(LANDLORD, [finding(6)])).toBeNull()
    await synthesize([finding(6)])
    expect(fetchAdminEdgeFunction).toHaveBeenCalledTimes(2)
  })
})
