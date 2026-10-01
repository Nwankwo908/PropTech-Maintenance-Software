import { describe, expect, it } from 'vitest'
import {
  communicationResponseRateDelta,
  computeCommunicationResponseRate,
  MESSAGE_RESPONSE_RATE_TOOLTIP,
  VENDOR_JOB_ACCEPTANCE_TOOLTIP,
} from '@/lib/communicationResponseRate'

describe('communicationResponseRate client exports', () => {
  it('keeps Messages Response rate and Vendor Response as distinct copy', () => {
    expect(MESSAGE_RESPONSE_RATE_TOOLTIP).toContain('within 24 hours')
    expect(MESSAGE_RESPONSE_RATE_TOOLTIP.toLowerCase()).toContain('message replies')
    expect(MESSAGE_RESPONSE_RATE_TOOLTIP.toLowerCase()).toContain('vendors accepted')
    expect(VENDOR_JOB_ACCEPTANCE_TOOLTIP.toLowerCase()).toContain('pending accept')
    expect(VENDOR_JOB_ACCEPTANCE_TOOLTIP.toLowerCase()).toContain('messages response')
    expect(MESSAGE_RESPONSE_RATE_TOOLTIP).not.toEqual(VENDOR_JOB_ACCEPTANCE_TOOLTIP)
  })

  it('delta is null when either window has no inbounds', () => {
    const withData = computeCommunicationResponseRate(
      [
        {
          id: 'i1',
          conversationId: 'c1',
          direction: 'inbound',
          createdAtMs: 1_000,
        },
        {
          id: 'o1',
          conversationId: 'c1',
          direction: 'outbound',
          createdAtMs: 2_000,
        },
      ],
      { fromMs: 0, toMs: 10_000 },
    )
    const empty = computeCommunicationResponseRate([], { fromMs: 0, toMs: 10_000 })
    expect(communicationResponseRateDelta(withData, empty)).toBeNull()
    expect(communicationResponseRateDelta(empty, withData)).toBeNull()
  })
})
