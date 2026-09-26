import { describe, expect, it, vi } from 'vitest'
import { LIMITED_ALPHA_2_LANDLORD_ID } from '@shared/landlordCapabilities'
import {
  collectOnboardingImportTicketIds,
  ONBOARDING_IMPORT_SOURCE,
  runOnboardingStartPrep,
  type PurgeLeftoverImportOpsResult,
} from './purgeImportOps'
import {
  FAST_TRACK_HISTORICAL_ISSUE_DESTINATION,
  FAST_TRACK_UNMATCHED_EXPENSE_FATE,
  isUnmatchedExpenseDropped,
  shouldMintOpenTicketFromHistoricalIssue,
  shouldMintTicketFromExpenseLine,
} from './fastTrackTicketPolicy'

describe('Fast Track ticket policy (product decisions)', () => {
  it('routes historical issues to History only — never open tickets (unconditional)', () => {
    expect(FAST_TRACK_HISTORICAL_ISSUE_DESTINATION).toBe('maintenance_history_only')
    expect(
      shouldMintOpenTicketFromHistoricalIssue({
        description: 'Kitchen sink still leaking — needs plumber this week',
        priority: 'urgent',
        selected: true,
      }),
    ).toBe(false)
    expect(
      shouldMintOpenTicketFromHistoricalIssue({
        description: 'Completed roof repair last month',
        priority: 'low',
      }),
    ).toBe(false)
  })

  it('drops unmatched-vendor expense lines (not parked for matching)', () => {
    expect(FAST_TRACK_UNMATCHED_EXPENSE_FATE).toBe('dropped')
    expect(shouldMintTicketFromExpenseLine({ matchedVendorId: null })).toBe(false)
    expect(shouldMintTicketFromExpenseLine({ matchedVendorId: '' })).toBe(false)
    expect(isUnmatchedExpenseDropped({ matchedVendorId: undefined })).toBe(true)
    expect(shouldMintTicketFromExpenseLine({ matchedVendorId: 'vendor-1' })).toBe(true)
  })
})

describe('collectOnboardingImportTicketIds (lineage scope)', () => {
  it('collects import-tagged tickets/runs and ignores SMS tickets without import source', () => {
    const { ticketIds, runIds } = collectOnboardingImportTicketIds({
      workflowRuns: [
        {
          id: 'run-import-1',
          entity_id: 'ticket-import-1',
          metadata: { source: ONBOARDING_IMPORT_SOURCE },
        },
        {
          id: 'run-sms-1',
          entity_id: 'ticket-sms-1',
          metadata: { source: 'tenant_sms' },
        },
        {
          id: 'run-sms-2',
          entity_id: 'ticket-sms-2',
          metadata: {},
        },
      ],
      invoices: [
        {
          maintenance_request_id: 'ticket-expense-1',
          metadata: { source: ONBOARDING_IMPORT_SOURCE },
        },
        {
          maintenance_request_id: 'ticket-live-invoice',
          metadata: { source: 'vendor_portal' },
        },
      ],
      graphEvents: [
        {
          maintenance_request_id: 'ticket-import-graph',
          event_type: 'maintenance.imported',
          metadata: { source: ONBOARDING_IMPORT_SOURCE },
        },
      ],
    })

    expect(ticketIds.sort()).toEqual(
      ['ticket-expense-1', 'ticket-import-1', 'ticket-import-graph'].sort(),
    )
    expect(runIds).toEqual(['run-import-1'])
    expect(ticketIds).not.toContain('ticket-sms-1')
    expect(ticketIds).not.toContain('ticket-sms-2')
    expect(ticketIds).not.toContain('ticket-live-invoice')
  })
})

describe('runOnboardingStartPrep (decoupled from Start/Back wipe)', () => {
  it('still runs lineage purge when wipePortfolioSession is removed / throws', async () => {
    const purgeCalls: string[] = []
    const wipe = vi.fn(async () => {
      throw new Error('permission denied for table insight_scheduling_requests')
    })

    const result = await runOnboardingStartPrep(LIMITED_ALPHA_2_LANDLORD_ID, {
      wipePortfolioSession: wipe,
      purgeLeftoverImportOps: async (landlordId) => {
        purgeCalls.push(landlordId)
        return {
          ok: true,
          purgedTicketIds: ['ticket-import-1'],
          purgedRunIds: ['run-import-1'],
        } satisfies PurgeLeftoverImportOpsResult
      },
    })

    expect(purgeCalls).toEqual([LIMITED_ALPHA_2_LANDLORD_ID])
    expect(result.ok).toBe(true)
    expect(result.purgedTicketIds).toEqual(['ticket-import-1'])
    // Wipe must not be invoked by start prep — coupling was the original regression.
    expect(wipe).not.toHaveBeenCalled()
  })

  it('does not require wipePortfolioSession at all', async () => {
    let purged = false
    const result = await runOnboardingStartPrep(LIMITED_ALPHA_2_LANDLORD_ID, {
      purgeLeftoverImportOps: async () => {
        purged = true
        return { ok: true, purgedTicketIds: [], purgedRunIds: [] }
      },
    })
    expect(purged).toBe(true)
    expect(result.ok).toBe(true)
  })
})

describe('Fast Track Start → import regression (original failure shape)', () => {
  it('Start prep purges import leftovers then import policies mint zero open tickets', async () => {
    // (a) leftover Fast Track import tickets from a prior incomplete session
    const leftoverImportTicket = 'ticket-leftover-import'
    const leftoverImportRun = 'run-leftover-import'
    // (b) legitimate SMS ticket created around the same time — must survive
    const smsTicket = 'ticket-sms-live'

    const deletedTicketIds: string[] = []
    const survivingTicketIds = new Set([leftoverImportTicket, smsTicket])

    await runOnboardingStartPrep(LIMITED_ALPHA_2_LANDLORD_ID, {
      // Simulate a future edit that deletes/breaks the permission wipe path.
      wipePortfolioSession: undefined,
      purgeLeftoverImportOps: async () => {
        const lineage = collectOnboardingImportTicketIds({
          workflowRuns: [
            {
              id: leftoverImportRun,
              entity_id: leftoverImportTicket,
              metadata: { source: ONBOARDING_IMPORT_SOURCE },
            },
            {
              id: 'run-sms',
              entity_id: smsTicket,
              metadata: { source: 'tenant_sms', created_near: 'same_window' },
            },
          ],
          invoices: [],
          graphEvents: [],
        })
        for (const id of lineage.ticketIds) {
          deletedTicketIds.push(id)
          survivingTicketIds.delete(id)
        }
        return {
          ok: true,
          purgedTicketIds: lineage.ticketIds,
          purgedRunIds: lineage.runIds,
        }
      },
    })

    expect(deletedTicketIds).toEqual([leftoverImportTicket])
    expect(survivingTicketIds.has(smsTicket)).toBe(true)
    expect(survivingTicketIds.has(leftoverImportTicket)).toBe(false)

    // New Fast Track import with historical + unmatched expense → zero open tickets.
    const historicalIssues = [
      { description: 'Basement flooded last winter', priority: 'high', selected: true },
      { description: 'Outlet sparking in bedroom', priority: 'urgent', selected: true },
    ]
    const openFromHistorical = historicalIssues.filter((issue) =>
      shouldMintOpenTicketFromHistoricalIssue(issue),
    )
    const expenseLines = [
      { matchedVendorId: null as string | null },
      { matchedVendorId: 'vendor-flex' as string | null },
    ]
    const openFromUnmatchedExpenses = expenseLines.filter(
      (line) =>
        isUnmatchedExpenseDropped(line) === false &&
        shouldMintTicketFromExpenseLine(line) &&
        !line.matchedVendorId,
    )
    // Unmatched drop; matched expense becomes completed History ticket (not open).
    const openTicketsCreated =
      openFromHistorical.length + openFromUnmatchedExpenses.length

    expect(openTicketsCreated).toBe(0)
    expect(expenseLines.filter((l) => isUnmatchedExpenseDropped(l))).toHaveLength(1)
  })
})
