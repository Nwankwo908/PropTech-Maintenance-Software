import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  landlordMaySendText,
  replyToMessageIdFromPayload,
  unansweredLandlordTopics,
  type NeedsResponseMessage,
} from '@/lib/communicationNeedsResponse'

const MESSAGE_CAP = 2000

/**
 * A full landlord thread at the Messages query cap.
 * Some older asks are answered by a later direct reply, not by the next text.
 */
function longThread(): { messages: NeedsResponseMessage[]; stillWaiting: string; cleared: string[] } {
  const messages: NeedsResponseMessage[] = []
  for (let index = 0; index < MESSAGE_CAP; index += 1) {
    const asks = index % 5 === 0
    messages.push({
      id: `m-${index}`,
      direction: index % 7 === 6 ? 'inbound' : 'outbound',
      createdAtMs: index + 1,
      text: asks ? `Reply YES to item ${index}.` : 'Your setup is complete.',
    })
  }
  const cleared = ['m-0', 'm-100', 'm-500', 'm-1500']
  cleared.forEach((id, offset) => {
    messages.push({
      id: `reply-${id}`,
      direction: 'outbound',
      createdAtMs: MESSAGE_CAP + offset + 1,
      text: 'Yes, that one.',
      replyToMessageId: replyToMessageIdFromPayload({ reply_to_message_id: id }),
    })
  })
  return { messages, stillWaiting: 'm-35', cleared }
}

describe('direct reply to an older message', () => {
  it('clears only the message that was selected, on a 2,000 text thread', () => {
    const thread = longThread()
    const run = () => unansweredLandlordTopics(thread.messages)
    const topics = run()
    const ids = new Set(topics.map((topic) => topic.messageId))

    for (const id of thread.cleared) expect(ids.has(id)).toBe(false)
    expect(ids.has(thread.stillWaiting)).toBe(true)
    expect(ids.has('m-40')).toBe(false)
    expect(topics[0]?.messageId).toBe(thread.stillWaiting)

    const samples: number[] = []
    for (let sample = 0; sample < 30; sample += 1) {
      const start = performance.now()
      const again = run()
      samples.push(performance.now() - start)
      expect(again).toHaveLength(topics.length)
      expect(again.map((topic) => topic.messageId).join(',')).toBe(
        topics.map((topic) => topic.messageId).join(','),
      )
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
    expect(p95).toBeLessThan(50)
  })
})

const NEXT_ASK = 'Who should take the photos?'
const CONFIRMATION = "We'll send this now and handle the rest."

/**
 * Answered asks fill the thread up to the query cap, then one ask is still open.
 * Ulo must not send another ask until the landlord answers that one.
 */
function threadWithOneOpenAsk(): NeedsResponseMessage[] {
  const messages: NeedsResponseMessage[] = []
  let at = 1
  while (messages.length + 3 <= MESSAGE_CAP - 1) {
    const n = messages.length
    messages.push(
      {
        id: `ask-${n}`,
        direction: 'outbound',
        createdAtMs: at,
        text: `Reply YES to send item ${n}.`,
      },
      {
        id: `note-${n}`,
        direction: 'outbound',
        createdAtMs: at + 1,
        text: CONFIRMATION,
      },
      {
        id: `yes-${n}`,
        direction: 'inbound',
        createdAtMs: at + 2,
        text: 'Yes',
      },
    )
    at += 3
  }
  messages.push({
    id: 'open-ask',
    direction: 'outbound',
    createdAtMs: at,
    text: 'Reply YES to send this to Ivanhomesolutions and we will handle the rest.',
  })
  return messages
}

describe('Ulo does not ask again before the landlord answers', () => {
  it('holds the next ask on a 2,000 text thread and allows it after the reply', () => {
    const waiting = threadWithOneOpenAsk()
    expect(waiting.length).toBeLessThanOrEqual(MESSAGE_CAP)
    expect(landlordMaySendText(waiting, NEXT_ASK)).toBe(false)
    expect(landlordMaySendText(waiting, CONFIRMATION)).toBe(true)

    const answered: NeedsResponseMessage[] = [
      ...waiting,
      {
        id: 'yes-open',
        direction: 'inbound',
        createdAtMs: (waiting[waiting.length - 1]?.createdAtMs ?? 0) + 1,
        text: 'Yes',
      },
    ]
    expect(landlordMaySendText(answered, NEXT_ASK)).toBe(true)

    const samples: number[] = []
    for (let sample = 0; sample < 30; sample += 1) {
      const start = performance.now()
      const holdAsk = landlordMaySendText(waiting, NEXT_ASK)
      const allowNote = landlordMaySendText(waiting, CONFIRMATION)
      const allowAfterYes = landlordMaySendText(answered, NEXT_ASK)
      samples.push(performance.now() - start)
      expect(holdAsk).toBe(false)
      expect(allowNote).toBe(true)
      expect(allowAfterYes).toBe(true)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
    expect(p95, `p95 ${p95.toFixed(2)}ms`).toBeLessThan(50)
  })
})