import { describe, expect, it } from 'vitest'
import {
  averageResponseMinutesFromSmsThread,
  averageResponseMinutesFromStatusEvents,
  looksLikeVendorAcceptDeclineReply,
  looksLikeVendorDispatchAsk,
  responseRatePercentFromCounts,
  summarizeSmsDispatchResponse,
} from '@/lib/vendorAvgResponse'

describe('looksLikeVendorDispatchAsk', () => {
  it('matches initial job assignment asks', () => {
    expect(
      looksLikeVendorDispatchAsk(
        'Would you like to take this job? Reply YES WO-ABCD to accept or NO WO-ABCD to decline.',
      ),
    ).toBe(true)
  })

  it('matches estimate continuation asks', () => {
    expect(
      looksLikeVendorDispatchAsk(
        "Reply YES to accept the work order or NO if you're unable to take it.",
      ),
    ).toBe(true)
  })

  it('rejects unrelated outbound', () => {
    expect(looksLikeVendorDispatchAsk('Thanks — we confirmed Wed 9–12 with the resident.')).toBe(
      false,
    )
  })
})

describe('looksLikeVendorAcceptDeclineReply', () => {
  it('matches short YES/NO replies only', () => {
    expect(looksLikeVendorAcceptDeclineReply('YES')).toBe(true)
    expect(looksLikeVendorAcceptDeclineReply('YES WO-ABCD')).toBe(true)
    expect(looksLikeVendorAcceptDeclineReply('no, booked')).toBe(true)
    expect(looksLikeVendorAcceptDeclineReply('Okay')).toBe(false)
    expect(looksLikeVendorAcceptDeclineReply('Wed 10am')).toBe(false)
  })
})

describe('averageResponseMinutesFromStatusEvents', () => {
  it('averages notify → first accept/decline', () => {
    const avg = averageResponseMinutesFromStatusEvents({
      vendorId: 'v1',
      tickets: [
        {
          id: 't1',
          notifiedAtMs: Date.parse('2026-11-07T12:00:00.000Z'),
          assignedAtMs: null,
          createdAtMs: null,
        },
        {
          id: 't2',
          notifiedAtMs: Date.parse('2026-11-07T13:00:00.000Z'),
          assignedAtMs: null,
          createdAtMs: null,
        },
      ],
      events: [
        {
          ticketId: 't1',
          vendorId: 'v1',
          toStatus: 'accepted',
          createdAtMs: Date.parse('2026-11-07T12:15:00.000Z'),
        },
        {
          ticketId: 't2',
          vendorId: 'v1',
          toStatus: 'declined',
          createdAtMs: Date.parse('2026-11-07T13:45:00.000Z'),
        },
      ],
    })
    expect(avg).toBe(30)
  })
})

describe('averageResponseMinutesFromSmsThread', () => {
  it('pairs dispatch ask with the next YES/NO on the thread', () => {
    const avg = averageResponseMinutesFromSmsThread([
      {
        conversationId: 'c1',
        direction: 'outbound',
        body: 'Would you like to take this job? Reply YES WO-ABCD to accept or NO WO-ABCD to decline.',
        createdAtMs: Date.parse('2026-11-07T10:00:00.000Z'),
      },
      {
        conversationId: 'c1',
        direction: 'inbound',
        body: 'YES WO-ABCD',
        createdAtMs: Date.parse('2026-11-07T10:20:00.000Z'),
      },
    ])
    expect(avg).toBe(20)
  })
})

describe('responseRatePercentFromCounts', () => {
  it('returns null with no asks', () => {
    expect(responseRatePercentFromCounts(0, 0)).toBeNull()
  })

  it('returns 0% when asks got no YES/NO', () => {
    expect(responseRatePercentFromCounts(2, 0)).toBe(0)
  })

  it('returns reply share', () => {
    expect(responseRatePercentFromCounts(4, 3)).toBe(75)
  })
})

describe('summarizeSmsDispatchResponse', () => {
  it('counts unanswered job offers toward 0%', () => {
    const summary = summarizeSmsDispatchResponse([
      {
        conversationId: 'c1',
        direction: 'outbound',
        body: 'Would you like to take this job? Reply YES WO-ABCD to accept or NO WO-ABCD to decline.',
        createdAtMs: Date.parse('2026-11-07T10:00:00.000Z'),
      },
      {
        conversationId: 'c1',
        direction: 'outbound',
        body: 'Would you like to take this job? Reply YES WO-EF01 to accept or NO WO-EF01 to decline.',
        createdAtMs: Date.parse('2026-11-07T11:00:00.000Z'),
      },
    ])
    expect(summary.dispatchAskCount).toBe(2)
    expect(summary.replyPairCount).toBe(0)
    expect(responseRatePercentFromCounts(summary.dispatchAskCount, summary.replyPairCount)).toBe(0)
  })
})
