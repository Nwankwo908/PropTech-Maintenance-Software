import { describe, expect, it } from 'vitest'
import {
  COMMUNICATION_RESPONSE_WINDOW_MS,
  communicationResponseRateDelta,
  computeCommunicationResponseRate,
  type CommunicationResponseMessage,
} from './communicationResponseRate.ts'

const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function msg(
  partial: Partial<CommunicationResponseMessage> &
    Pick<CommunicationResponseMessage, 'id' | 'direction' | 'createdAtMs'>,
): CommunicationResponseMessage {
  return {
    conversationId: 'conv-1',
    ...partial,
  }
}

describe('computeCommunicationResponseRate', () => {
  it('counts an inbound with a same-thread outbound reply as answered', () => {
    const result = computeCommunicationResponseRate(
      [
        msg({ id: 'i1', direction: 'inbound', createdAtMs: NOW - 2 * HOUR }),
        msg({ id: 'o1', direction: 'outbound', createdAtMs: NOW - 1 * HOUR }),
      ],
      { fromMs: NOW - 24 * HOUR, toMs: NOW },
    )
    expect(result).toEqual({
      totalInbounds: 1,
      answeredInbounds: 1,
      responseRatePct: 100,
    })
  })

  it('excludes outbound-only threads from numerator and denominator', () => {
    const result = computeCommunicationResponseRate(
      [
        msg({
          id: 'auto',
          conversationId: 'probe-only',
          direction: 'outbound',
          createdAtMs: NOW - HOUR,
        }),
      ],
      { fromMs: NOW - 24 * HOUR, toMs: NOW },
    )
    expect(result).toEqual({
      totalInbounds: 0,
      answeredInbounds: 0,
      responseRatePct: null,
    })
  })

  it('counts an inbound with no reply within the window as unanswered', () => {
    const result = computeCommunicationResponseRate(
      [
        msg({ id: 'i1', direction: 'inbound', createdAtMs: NOW - 30 * HOUR }),
        // Reply arrives after 24h window
        msg({
          id: 'o1',
          direction: 'outbound',
          createdAtMs: NOW - 30 * HOUR + COMMUNICATION_RESPONSE_WINDOW_MS + HOUR,
        }),
      ],
      {
        fromMs: NOW - 48 * HOUR,
        toMs: NOW,
        windowMs: COMMUNICATION_RESPONSE_WINDOW_MS,
      },
    )
    expect(result.totalInbounds).toBe(1)
    expect(result.answeredInbounds).toBe(0)
    expect(result.responseRatePct).toBe(0)
  })

  it('does not let a later outbound count as a reply once a next inbound has started', () => {
    const result = computeCommunicationResponseRate(
      [
        msg({ id: 'i1', direction: 'inbound', createdAtMs: NOW - 3 * HOUR }),
        msg({ id: 'i2', direction: 'inbound', createdAtMs: NOW - 2 * HOUR }),
        msg({ id: 'o1', direction: 'outbound', createdAtMs: NOW - 1 * HOUR }),
      ],
      { fromMs: NOW - 24 * HOUR, toMs: NOW },
    )
    // i1 unanswered (outbound is after i2); i2 answered
    expect(result.totalInbounds).toBe(2)
    expect(result.answeredInbounds).toBe(1)
    expect(result.responseRatePct).toBe(50)
  })

  it('is identical for 10 vs 10,000 messages (no client-side cap in algorithm)', () => {
    const base: CommunicationResponseMessage[] = [
      msg({ id: 'i1', direction: 'inbound', createdAtMs: NOW - 2 * HOUR }),
      msg({ id: 'o1', direction: 'outbound', createdAtMs: NOW - 1 * HOUR }),
    ]
    const padded: CommunicationResponseMessage[] = [...base]
    for (let i = 0; i < 9998; i += 1) {
      // Old outbound-only noise in other threads — must not affect the rate.
      padded.push(
        msg({
          id: `noise-${i}`,
          conversationId: `noise-${i % 50}`,
          direction: 'outbound',
          createdAtMs: NOW - 40 * HOUR - i,
        }),
      )
    }
    const small = computeCommunicationResponseRate(base, {
      fromMs: NOW - 24 * HOUR,
      toMs: NOW,
    })
    const large = computeCommunicationResponseRate(padded, {
      fromMs: NOW - 24 * HOUR,
      toMs: NOW,
    })
    expect(large).toEqual(small)
    expect(large.responseRatePct).toBe(100)
  })

  it('uses the same formula for snapshot and trend when windows match', () => {
    const messages = [
      msg({ id: 'i1', direction: 'inbound', createdAtMs: NOW - 2 * HOUR }),
      msg({ id: 'o1', direction: 'outbound', createdAtMs: NOW - 1 * HOUR }),
      msg({
        id: 'i-old',
        conversationId: 'conv-2',
        direction: 'inbound',
        createdAtMs: NOW - 30 * 24 * HOUR,
      }),
    ]
    const fromMs = NOW - 28 * 24 * HOUR
    const recent = computeCommunicationResponseRate(messages, { fromMs, toMs: NOW })
    const sameWindowAgain = computeCommunicationResponseRate(messages, {
      fromMs,
      toMs: NOW,
    })
    expect(sameWindowAgain.responseRatePct).toBe(recent.responseRatePct)
    expect(communicationResponseRateDelta(recent, sameWindowAgain)).toBe(0)
  })
})
