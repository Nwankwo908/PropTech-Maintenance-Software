import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISMISSED_ATTENTION_IDS,
  isNeedsAttentionDismissed,
  type DismissedAttentionIds,
} from './dismissNeedsAttention'

describe('isNeedsAttentionDismissed', () => {
  const dismissed: DismissedAttentionIds = {
    ticketIds: new Set(['ticket-1']),
    runIds: new Set(['run-1']),
  }

  it('keeps items that were not removed', () => {
    expect(
      isNeedsAttentionDismissed(EMPTY_DISMISSED_ATTENTION_IDS, {
        ticketId: 'ticket-1',
        runId: 'run-1',
      }),
    ).toBe(false)
    expect(
      isNeedsAttentionDismissed(dismissed, { ticketId: 'ticket-2', runId: 'run-2' }),
    ).toBe(false)
  })

  it('hides SLA cards after the ticket is deleted from the queue', () => {
    expect(isNeedsAttentionDismissed(dismissed, { ticketId: 'ticket-1' })).toBe(true)
  })

  it('hides escalated vendor-needed cards after the run is deleted', () => {
    expect(isNeedsAttentionDismissed(dismissed, { runId: 'run-1' })).toBe(true)
  })
})
