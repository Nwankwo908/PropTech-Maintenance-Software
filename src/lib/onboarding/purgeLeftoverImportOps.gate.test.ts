import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITED_ALPHA_2_LANDLORD_ID } from '@shared/landlordCapabilities'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('@/lib/activeLandlord', () => ({
  getActiveLandlordId: () => LIMITED_ALPHA_2_LANDLORD_ID,
  DEMO_LANDLORD_ID: 'demo-0000-0000-0000-000000000001',
}))

describe('purgeLeftoverOnboardingImportOps gate + lineage delete', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('skips purge for non-onboarding landlords (no deletes)', async () => {
    const { purgeLeftoverOnboardingImportOps } = await import('./purgeImportOps')
    const result = await purgeLeftoverOnboardingImportOps(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    expect(result.purgedTicketIds).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('deletes only import-lineage tickets for onboarding landlords', async () => {
    const deleted: Array<{ table: string; ids?: string[] }> = []

    fromMock.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = vi.fn(() => self())
      chain.eq = vi.fn(() => self())
      chain.in = vi.fn((col: string, ids: string[]) => {
        if (typeof chain._pendingDelete === 'boolean' && chain._pendingDelete) {
          deleted.push({ table, ids })
          return Promise.resolve({ error: null })
        }
        // select().in() for graph events
        return self()
      })
      chain.delete = vi.fn(() => {
        chain._pendingDelete = true
        return self()
      })
      // Terminal for select chains
      Object.defineProperty(chain, 'then', {
        get() {
          return undefined
        },
      })

      if (table === 'workflow_runs') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: 'run-import',
                  entity_id: 'ticket-import',
                  metadata: { source: 'onboarding_import' },
                },
                {
                  id: 'run-sms',
                  entity_id: 'ticket-sms',
                  metadata: { source: 'tenant_sms' },
                },
              ],
              error: null,
            }),
          }),
          delete: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => {
                deleted.push({ table: 'workflow_runs', ids })
                return { error: null }
              },
            }),
          }),
        }
      }
      if (table === 'maintenance_invoices') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
          delete: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => {
                deleted.push({ table: 'maintenance_invoices', ids })
                return { error: null }
              },
            }),
          }),
        }
      }
      if (table === 'operations_graph_events') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'vendor_status_events') {
        return {
          delete: () => ({
            in: async (_col: string, ids: string[]) => {
              deleted.push({ table: 'vendor_status_events', ids })
              return { error: null }
            },
          }),
        }
      }
      if (table === 'workflow_events') {
        return {
          delete: () => ({
            in: async (_col: string, ids: string[]) => {
              deleted.push({ table: 'workflow_events', ids })
              return { error: null }
            },
          }),
        }
      }
      if (table === 'maintenance_requests') {
        return {
          delete: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => {
                deleted.push({ table: 'maintenance_requests', ids })
                return { error: null }
              },
            }),
          }),
        }
      }
      return chain
    })

    const { purgeLeftoverOnboardingImportOps } = await import('./purgeImportOps')
    const result = await purgeLeftoverOnboardingImportOps(LIMITED_ALPHA_2_LANDLORD_ID)

    expect(result.ok).toBe(true)
    expect(result.skipped).toBeUndefined()
    expect(result.purgedTicketIds).toEqual(['ticket-import'])
    expect(result.purgedRunIds).toEqual(['run-import'])

    const ticketDelete = deleted.find((d) => d.table === 'maintenance_requests')
    expect(ticketDelete?.ids).toEqual(['ticket-import'])
    expect(ticketDelete?.ids).not.toContain('ticket-sms')
  })
})
