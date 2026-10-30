import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { computeCommunicationInboxKpis } from '@/lib/communicationInboxKpis'
import type { InboxKpiConversation, InboxKpiMessage } from '@/lib/communicationInboxKpis'
import {
  communicationResponseRateDelta,
  computeCommunicationResponseRate,
} from '@/lib/communicationResponseRate'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const FOUR_WEEKS = 28 * DAY
const now = Date.parse('2026-10-30T16:00:00.000Z')
const recentStart = now - FOUR_WEEKS
const previousStart = now - 2 * FOUR_WEEKS

function conversation(
  id: string,
  conversationType: string,
  status: string,
  createdAtMs: number,
  updatedAtMs: number,
): InboxKpiConversation {
  return { id, conversationType, status, createdAtMs, updatedAtMs }
}

function message(
  conversationId: string,
  direction: string,
  createdAtMs: number,
  providerStatus = 'delivered',
): InboxKpiMessage {
  return { conversationId, direction, createdAtMs, providerStatus }
}

/**
 * Known threads for the four Messages cards.
 * Needs your response: tenant/vendor wrote last, and nobody replied for 4 hours.
 * Unread: latest message is inbound on an open thread, unless it was already opened.
 * Failed deliveries: provider statuses that did not send.
 * Response rate: the 24-hour reply aggregate, stored as the card receives it.
 */
function knownInbox() {
  const conversations = [
    conversation('a', 'resident_intake', 'open', recentStart - 10 * DAY, now),
    conversation('b', 'vendor_alert', 'open', now - 20 * DAY, now),
    conversation('c', 'resident_intake', 'open', now - 60 * DAY, now),
    conversation('d', 'resident_intake', 'closed', now - 70 * DAY, now - 60 * DAY),
    conversation('e', 'landlord_update', 'open', now - 3 * DAY, now),
    conversation('f', 'resident_intake', 'open', now - 12 * DAY, now),
  ]
  const messages = [
    message('a', 'inbound', now - 2 * DAY),
    message('a', 'outbound', now - 2 * DAY + HOUR),
    message('a', 'outbound', now - DAY, 'failed'),
    message('a', 'inbound', now - 5 * HOUR),
    message('b', 'inbound', now - 10 * HOUR),
    message('b', 'outbound', now - 9 * HOUR, 'delivered'),
    message('c', 'outbound', now - 30 * DAY, 'undelivered'),
    message('c', 'inbound', recentStart - 5 * HOUR),
    message('d', 'inbound', now - 10 * HOUR),
    message('e', 'inbound', now - 10 * HOUR),
    message('f', 'outbound', now - 10 * DAY, 'bounced'),
    message('f', 'inbound', now - 2 * HOUR),
  ]
  const rateMessages = [
    { id: 'r1-in', conversationId: 'rate-1', direction: 'inbound', createdAtMs: now - 2 * DAY },
    { id: 'r1-out', conversationId: 'rate-1', direction: 'outbound', createdAtMs: now - 2 * DAY + HOUR },
    { id: 'r2-in', conversationId: 'rate-2', direction: 'inbound', createdAtMs: now - 2 * HOUR },
    { id: 'r3-in', conversationId: 'rate-3', direction: 'inbound', createdAtMs: now - 40 * DAY },
    {
      id: 'r3-out',
      conversationId: 'rate-3',
      direction: 'outbound',
      createdAtMs: now - 40 * DAY + HOUR,
    },
  ]
  const recent = computeCommunicationResponseRate(rateMessages, { fromMs: recentStart, toMs: now })
  const previous = computeCommunicationResponseRate(rateMessages, {
    fromMs: previousStart,
    toMs: recentStart,
  })
  return computeCommunicationInboxKpis({
    conversations,
    messages,
    nowMs: now,
    responseRate: recent.responseRatePct,
    responseRateDelta: communicationResponseRateDelta(recent, previous),
    isUnread: (row) => row.activityLooksUnread && row.conversationId !== 'f',
  })
}

function busyInbox(conversationCount = 2000, messageCount = 5000) {
  const conversations: InboxKpiConversation[] = []
  for (let i = 0; i < conversationCount; i += 1) {
    const type = i % 11 === 0 ? 'landlord_update' : i % 3 === 0 ? 'vendor_alert' : 'resident_intake'
    const status = i % 17 === 0 ? 'closed' : 'open'
    conversations.push(
      conversation(String(i), type, status, now - (40 + (i % 20)) * DAY, now - (i % 10) * HOUR),
    )
  }
  const messages: InboxKpiMessage[] = []
  for (let i = 0; i < messageCount; i += 1) {
    const conversationId = String(i % conversationCount)
    const direction = i % 4 === 0 ? 'outbound' : 'inbound'
    const providerStatus = i % 23 === 0 ? 'failed' : i % 29 === 0 ? 'undelivered' : 'sent'
    messages.push(message(conversationId, direction, now - (i % 80) * DAY - (i % 12) * HOUR, providerStatus))
  }
  return { conversations, messages }
}

describe('Messages KPI wiring', () => {
  it('counts all four cards from the same threads', () => {
    const kpis = knownInbox()
    expect(kpis.needsYourResponse).toBe(2)
    expect(kpis.needsYourResponseDelta).toBe(1)
    expect(kpis.unreadMessages).toBe(3)
    expect(kpis.unreadDelta).toBe(3)
    expect(kpis.failedDeliveries).toBe(3)
    expect(kpis.failedDelta).toBe(1)
    expect(kpis.responseRate).toBe(50)
    expect(kpis.responseRateDelta).toBe(-50)
  })

  it('stays fast at the Messages query caps of 2,000 threads and 5,000 texts', () => {
    const inbox = busyInbox()
    const read = new Set(['1', '2', '3'])
    const run = () =>
      computeCommunicationInboxKpis({
        conversations: inbox.conversations,
        messages: inbox.messages,
        nowMs: now,
        responseRate: 72,
        responseRateDelta: -4,
        isUnread: (row) => row.activityLooksUnread && !read.has(row.conversationId),
      })

    const warm = run()
    expect(warm.needsYourResponse).toBeGreaterThan(0)
    expect(warm.needsYourResponse).toBeLessThanOrEqual(inbox.conversations.length)
    expect(warm.unreadMessages).toBeGreaterThanOrEqual(0)
    expect(warm.unreadMessages).toBeLessThanOrEqual(inbox.conversations.length)
    expect(warm.failedDeliveries).toBeGreaterThan(0)
    expect(warm.responseRate).toBe(72)
    expect(warm.responseRateDelta).toBe(-4)
    expect(Number.isFinite(warm.needsYourResponseDelta)).toBe(true)
    expect(Number.isFinite(warm.unreadDelta)).toBe(true)
    expect(Number.isFinite(warm.failedDelta)).toBe(true)

    const samples: number[] = []
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now()
      const kpis = run()
      samples.push(performance.now() - start)
      expect(kpis.needsYourResponse).toBe(warm.needsYourResponse)
      expect(kpis.unreadMessages).toBe(warm.unreadMessages)
      expect(kpis.failedDeliveries).toBe(warm.failedDeliveries)
      expect(kpis.responseRate).toBe(72)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
    expect(p95).toBeLessThan(50)
  })
})
