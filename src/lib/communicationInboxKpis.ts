import { threadNeedsYourResponse } from '@/lib/communicationNeedsResponse'

/** Statuses that are finished and drop out of Needs your response and Unread. */
export const COMMUNICATION_CLOSED_STATUSES = new Set([
  'completed',
  'resolved',
  'closed',
  'scheduled',
  'cancelled',
])

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

export type InboxKpiConversation = {
  id: string
  status: string
  conversationType: string
  createdAtMs: number
  updatedAtMs: number
}

export type InboxKpiMessage = {
  conversationId: string
  direction: string
  providerStatus: string
  createdAtMs: number
}

export type CommunicationInboxKpis = {
  needsYourResponse: number
  unreadMessages: number
  failedDeliveries: number
  responseRate: number | null
  needsYourResponseDelta: number | null
  unreadDelta: number | null
  failedDelta: number | null
  responseRateDelta: number | null
}

function isFailedDelivery(providerStatus: string): boolean {
  const status = providerStatus.toLowerCase()
  if (!status) return false
  return (
    status.includes('fail') ||
    status.includes('undeliver') ||
    status.includes('bounce') ||
    status.includes('reject') ||
    status === 'error'
  )
}

function wasOpenAt(conv: InboxKpiConversation, atMs: number): boolean {
  if (conv.createdAtMs > atMs) return false
  if (!COMMUNICATION_CLOSED_STATUSES.has(conv.status)) return true
  return conv.updatedAtMs > atMs
}

function latestDirectionAt(messages: InboxKpiMessage[] | undefined, atMs: number): string | null {
  if (!messages?.length) return null
  for (const message of messages) {
    if (message.createdAtMs <= atMs) return message.direction
  }
  return null
}

function snapshotAt(
  conversations: InboxKpiConversation[],
  messagesByConv: Map<string, InboxKpiMessage[]>,
  atMs: number,
): { unread: number; needsYourResponse: number } {
  let unread = 0
  let needsYourResponse = 0
  for (const conv of conversations) {
    if (!wasOpenAt(conv, atMs)) continue
    if (latestDirectionAt(messagesByConv.get(conv.id), atMs) === 'inbound') unread += 1
    if (
      threadNeedsYourResponse({
        conversationType: conv.conversationType,
        closed: false,
        messages: messagesByConv.get(conv.id),
        atMs,
      })
    ) {
      needsYourResponse += 1
    }
  }
  return { unread, needsYourResponse }
}

function failedInWindow(messages: InboxKpiMessage[], startMs: number, endMs: number): number {
  let count = 0
  for (const message of messages) {
    if (message.createdAtMs < startMs || message.createdAtMs >= endMs) continue
    if (isFailedDelivery(message.providerStatus)) count += 1
  }
  return count
}

/** Group newest first so the first message at or before a time is the latest one. */
function groupMessagesNewestFirst(messages: InboxKpiMessage[]): Map<string, InboxKpiMessage[]> {
  const grouped = new Map<string, InboxKpiMessage[]>()
  for (const message of messages) {
    if (!message.conversationId) continue
    const bucket = grouped.get(message.conversationId)
    if (bucket) bucket.push(message)
    else grouped.set(message.conversationId, [message])
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => b.createdAtMs - a.createdAtMs)
  }
  return grouped
}

/**
 * The four Messages KPIs from one landlord's conversation and message sample.
 * Response rate is the database aggregate passed in, not recomputed from the sample.
 */
export function computeCommunicationInboxKpis(input: {
  conversations: InboxKpiConversation[]
  messages: InboxKpiMessage[]
  nowMs: number
  responseRate: number | null
  responseRateDelta: number | null
  isUnread: (row: {
    conversationId: string
    lastActivityMs: number
    activityLooksUnread: boolean
  }) => boolean
}): CommunicationInboxKpis {
  const messagesByConv = groupMessagesNewestFirst(input.messages)
  const recentStart = input.nowMs - FOUR_WEEKS_MS
  const previousStart = input.nowMs - 2 * FOUR_WEEKS_MS

  let failedDeliveries = 0
  for (const message of input.messages) {
    if (isFailedDelivery(message.providerStatus)) failedDeliveries += 1
  }

  let needsYourResponse = 0
  let unreadMessages = 0
  for (const conv of input.conversations) {
    const closed = COMMUNICATION_CLOSED_STATUSES.has(conv.status)
    const latest = messagesByConv.get(conv.id)?.[0]
    if (
      threadNeedsYourResponse({
        conversationType: conv.conversationType,
        closed,
        messages: messagesByConv.get(conv.id),
        atMs: input.nowMs,
      })
    ) {
      needsYourResponse += 1
    }
    const lastActivityMs = latest?.createdAtMs ?? 0
    const activityLooksUnread = latest?.direction === 'inbound' && !closed
    if (
      input.isUnread({
        conversationId: conv.id,
        lastActivityMs,
        activityLooksUnread,
      })
    ) {
      unreadMessages += 1
    }
  }

  const currentSnapshot = snapshotAt(input.conversations, messagesByConv, input.nowMs)
  const previousSnapshot = snapshotAt(input.conversations, messagesByConv, recentStart)

  return {
    needsYourResponse,
    unreadMessages,
    failedDeliveries,
    responseRate: input.responseRate,
    needsYourResponseDelta: currentSnapshot.needsYourResponse - previousSnapshot.needsYourResponse,
    unreadDelta: currentSnapshot.unread - previousSnapshot.unread,
    failedDelta:
      failedInWindow(input.messages, recentStart, input.nowMs) -
      failedInWindow(input.messages, previousStart, recentStart),
    responseRateDelta: input.responseRateDelta,
  }
}
