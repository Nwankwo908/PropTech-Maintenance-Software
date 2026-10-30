import { describe, expect, it } from 'vitest'
import {
  NEEDS_YOUR_RESPONSE_WAIT_MS,
  threadNeedsYourResponse,
} from '@/lib/communicationNeedsResponse'

const now = Date.parse('2026-10-30T12:00:00Z')
const inbound = (hoursAgo: number) => ({
  direction: 'inbound',
  createdAtMs: now - hoursAgo * 60 * 60 * 1000,
})
const outbound = (hoursAgo: number) => ({
  direction: 'outbound',
  createdAtMs: now - hoursAgo * 60 * 60 * 1000,
})

describe('threadNeedsYourResponse', () => {
  it('counts a tenant or vendor text that has waited 4 hours', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(4)],
        atMs: now,
      }),
    ).toBe(true)
    expect(
      threadNeedsYourResponse({
        conversationType: 'vendor_alert',
        closed: false,
        messages: [inbound(5)],
        atMs: now,
      }),
    ).toBe(true)
  })

  it('waits out the 4 hour window', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(3.9)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('drops the thread when you or Ulo reply', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'vendor_alert',
        closed: false,
        messages: [outbound(1), inbound(6)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('ignores closed threads and threads that are not with a tenant or vendor', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: true,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
    expect(
      threadNeedsYourResponse({
        conversationType: 'landlord_update',
        closed: false,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
    expect(
      threadNeedsYourResponse({
        conversationType: 'ai_copilot',
        closed: false,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('uses the same 4 hour wait at an earlier snapshot', () => {
    const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000
    expect(NEEDS_YOUR_RESPONSE_WAIT_MS).toBe(4 * 60 * 60 * 1000)
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(0), { direction: 'inbound', createdAtMs: fourWeeksAgo - NEEDS_YOUR_RESPONSE_WAIT_MS }],
        atMs: fourWeeksAgo,
      }),
    ).toBe(true)
  })
})
