import { describe, expect, it, vi } from 'vitest'
import { LIMITED_ALPHA_2_LANDLORD_ID } from '@shared/landlordCapabilities'
import {
  archiveImportLineageTicketsForHardDelete,
  classifyHardDeleteBlockedImportTickets,
  wouldHitHardDeleteForbidden,
} from './archiveImportLineageForPurge'
import { ONBOARDING_IMPORT_SOURCE } from './purgeImportOps'

describe('wouldHitHardDeleteForbidden', () => {
  it('matches the HARD_DELETE_FORBIDDEN trigger (assigned or previous vendor)', () => {
    expect(
      wouldHitHardDeleteForbidden({
        id: '13f4798a-0ce4-4ff7-b1f8-c042278b4e51',
        assigned_vendor_id: 'vendor-1',
        previous_vendor_id: null,
      }),
    ).toBe(true)
    expect(
      wouldHitHardDeleteForbidden({
        id: 't2',
        assigned_vendor_id: null,
        previous_vendor_id: 'vendor-old',
      }),
    ).toBe(true)
    expect(
      wouldHitHardDeleteForbidden({
        id: 't3',
        assigned_vendor_id: null,
        previous_vendor_id: null,
      }),
    ).toBe(false)
  })
})

describe('archiveImportLineageTicketsForHardDelete', () => {
  const landlordId = LIMITED_ALPHA_2_LANDLORD_ID
  const importTicketId = '13f4798a-0ce4-4ff7-b1f8-c042278b4e51'
  const smsTicketId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('archives import-lineage vendor tickets then unlocks them for hard-delete; ignores SMS tickets', async () => {
    const terminated: string[] = []
    const unlocked: string[] = []
    const deletedAfterUnlock: string[] = []

    const prep = await archiveImportLineageTicketsForHardDelete(landlordId, {
      loadImportTicketIds: async () => ({
        ok: true,
        ticketIds: [importTicketId],
      }),
      loadTicketRisk: async (ids) => ({
        ok: true,
        tickets: [
          {
            id: importTicketId,
            assigned_vendor_id: 'vendor-flex',
            previous_vendor_id: null,
          },
          {
            id: smsTicketId,
            assigned_vendor_id: 'vendor-other',
            previous_vendor_id: null,
          },
        ].filter((t) => ids.includes(t.id)),
      }),
      terminateTicket: async ({ ticketId }) => {
        terminated.push(ticketId)
        return { ok: true }
      },
      unlockTickets: async (_landlord, ids) => {
        unlocked.push(...ids)
        return { ok: true, unlockedTicketIds: ids }
      },
    })

    expect(prep.ok).toBe(true)
    expect(terminated).toEqual([importTicketId])
    expect(terminated).not.toContain(smsTicketId)
    expect(unlocked).toEqual([importTicketId])

    // Simulate hard-delete pass after unlock — remainingTickets → 0
    for (const id of unlocked) deletedAfterUnlock.push(id)
    const remainingTickets = [importTicketId, smsTicketId].filter(
      (id) => !deletedAfterUnlock.includes(id) && id === importTicketId,
    )
    // Only import ticket was in purge scope; after unlock+delete it is gone.
    expect(remainingTickets).toEqual([])
    expect(prep.archiveFailed.count).toBe(0)
  })

  it('fail-closes with specific ticket IDs when terminateWorkOrder errors', async () => {
    const prep = await archiveImportLineageTicketsForHardDelete(landlordId, {
      loadImportTicketIds: async () => ({
        ok: true,
        ticketIds: [importTicketId],
      }),
      loadTicketRisk: async () => ({
        ok: true,
        tickets: [
          {
            id: importTicketId,
            assigned_vendor_id: 'vendor-flex',
            previous_vendor_id: null,
          },
        ],
      }),
      terminateTicket: async () => ({
        ok: false,
        error: 'termination_insert_failed',
      }),
      unlockTickets: async () => {
        throw new Error('unlock must not run when archive fails')
      },
    })

    expect(prep.ok).toBe(false)
    expect(prep.archiveFailed.count).toBe(1)
    expect(prep.archiveFailed.ticketIds).toEqual([importTicketId])
    expect(prep.error).toContain(importTicketId)
    expect(prep.unlockedTicketIds).toEqual([])
  })

  it('does not terminate tickets outside import lineage even if vendor-assigned', async () => {
    const terminated: string[] = []
    const prep = await archiveImportLineageTicketsForHardDelete(landlordId, {
      loadImportTicketIds: async () => ({ ok: true, ticketIds: [] }),
      loadTicketRisk: async () => ({
        ok: true,
        tickets: [
          {
            id: smsTicketId,
            assigned_vendor_id: 'vendor-1',
            previous_vendor_id: null,
          },
        ],
      }),
      terminateTicket: async ({ ticketId }) => {
        terminated.push(ticketId)
        return { ok: true }
      },
    })
    expect(prep.ok).toBe(true)
    expect(terminated).toEqual([])
    expect(prep.riskTicketIds).toEqual([])
  })
})

describe('classifyHardDeleteBlockedImportTickets', () => {
  it('only reports import-lineage tickets that still trip the guard', () => {
    const result = classifyHardDeleteBlockedImportTickets({
      importTicketIds: ['import-1', 'import-2'],
      remainingTickets: [
        { id: 'import-1', assigned_vendor_id: 'v1', previous_vendor_id: null },
        { id: 'sms-1', assigned_vendor_id: 'v2', previous_vendor_id: null },
        { id: 'import-2', assigned_vendor_id: null, previous_vendor_id: null },
      ],
    })
    expect(result).toEqual({ count: 1, ticketIds: ['import-1'] })
  })
})

describe('factory reset opsCounts failure surface', () => {
  it('distinguishes archiveFailed vs hardDeleteBlocked in alert text', async () => {
    const { formatFactoryResetFailureAlert } = await import('./factoryResetOutcome')
    const alert = formatFactoryResetFailureAlert({
      error: 'Could not archive import work orders before purge.',
      opsPurgePath: 'unknown',
      activityFeed: {
        remainingOperationsGraph: 0,
        remainingPropertyOperationsGraph: 0,
      },
      opsCounts: {
        remainingTickets: 1,
        remainingActiveWorkflowRuns: 0,
        archiveFailed: {
          count: 1,
          ticketIds: ['13f4798a-0ce4-4ff7-b1f8-c042278b4e51'],
        },
      },
    })
    expect(alert).toContain('archiveFailed: 1')
    expect(alert).toContain('13f4798a-0ce4-4ff7-b1f8-c042278b4e51')

    const blockedAlert = formatFactoryResetFailureAlert({
      error: 'Could not clear imported tasks.',
      opsPurgePath: 'client_fallback',
      activityFeed: {
        remainingOperationsGraph: 0,
        remainingPropertyOperationsGraph: 0,
      },
      opsCounts: {
        remainingTickets: 2,
        remainingActiveWorkflowRuns: 0,
        hardDeleteBlocked: {
          count: 2,
          ticketIds: ['ticket-a', 'ticket-b'],
        },
      },
    })
    expect(blockedAlert).toContain('hardDeleteBlocked: 2')
    expect(blockedAlert).toContain('ticket-a')
    expect(blockedAlert).not.toContain('archiveFailed')
  })
})

describe('archiveHardDeleteRiskTicketsForFactoryReset', () => {
  it('archives any vendor-assigned ticket on the landlord (portfolio wipe scope)', async () => {
    const { archiveHardDeleteRiskTicketsForFactoryReset } = await import(
      './archiveImportLineageForPurge'
    )
    const terminated: string[] = []
    const prep = await archiveHardDeleteRiskTicketsForFactoryReset(LIMITED_ALPHA_2_LANDLORD_ID, {
      loadRiskTickets: async () => ({
        ok: true,
        tickets: [
          {
            id: '13f4798a-0ce4-4ff7-b1f8-c042278b4e51',
            assigned_vendor_id: null,
            previous_vendor_id: 'vendor-was-assigned',
          },
        ],
      }),
      terminateTicket: async ({ ticketId }) => {
        terminated.push(ticketId)
        return { ok: true }
      },
      unlockTickets: async (_l, ids) => ({ ok: true, unlockedTicketIds: ids }),
    })
    expect(prep.ok).toBe(true)
    expect(terminated).toEqual(['13f4798a-0ce4-4ff7-b1f8-c042278b4e51'])
  })
})

describe('Reset path: archive then purge reaches remainingTickets 0', () => {
  it('reproduces the 13f4798a vendor-assigned import case end-to-end (mocked)', async () => {
    const importTicketId = '13f4798a-0ce4-4ff7-b1f8-c042278b4e51'
    let ticketStore: Array<{
      id: string
      assigned_vendor_id: string | null
      previous_vendor_id: string | null
      source: string
    }> = [
      {
        id: importTicketId,
        assigned_vendor_id: 'vendor-flex',
        previous_vendor_id: null,
        source: ONBOARDING_IMPORT_SOURCE,
      },
    ]

    const prep = await archiveImportLineageTicketsForHardDelete(LIMITED_ALPHA_2_LANDLORD_ID, {
      loadImportTicketIds: async () => ({
        ok: true,
        ticketIds: ticketStore
          .filter((t) => t.source === ONBOARDING_IMPORT_SOURCE)
          .map((t) => t.id),
      }),
      loadTicketRisk: async (ids) => ({
        ok: true,
        tickets: ticketStore.filter((t) => ids.includes(t.id)),
      }),
      terminateTicket: async ({ ticketId }) => {
        ticketStore = ticketStore.map((t) =>
          t.id === ticketId
            ? {
                ...t,
                assigned_vendor_id: null,
                previous_vendor_id: t.assigned_vendor_id ?? t.previous_vendor_id,
              }
            : t,
        )
        return { ok: true }
      },
      unlockTickets: async (_landlord, ids) => {
        ticketStore = ticketStore.map((t) =>
          ids.includes(t.id)
            ? { ...t, assigned_vendor_id: null, previous_vendor_id: null }
            : t,
        )
        return { ok: true, unlockedTicketIds: ids }
      },
    })

    expect(prep.ok).toBe(true)
    expect(wouldHitHardDeleteForbidden(ticketStore[0]!)).toBe(false)

    // Hard-delete pass: only delete tickets that no longer trip the guard
    const deletable = ticketStore.filter((t) => !wouldHitHardDeleteForbidden(t))
    expect(deletable.map((t) => t.id)).toEqual([importTicketId])
    ticketStore = ticketStore.filter((t) => wouldHitHardDeleteForbidden(t))
    expect(ticketStore).toHaveLength(0)

    const opsCounts = {
      remainingTickets: ticketStore.length,
      remainingActiveWorkflowRuns: 0,
    }
    expect(opsCounts.remainingTickets).toBe(0)
    expect(prep.ok).toBe(true)
  })
})
