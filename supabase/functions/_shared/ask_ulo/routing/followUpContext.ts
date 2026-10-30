import type { AskUloHistoryMessage } from '../core/types.ts'
import { isDailyPrioritiesQuestion } from '../tools/ops/dailyPrioritiesDetect.ts'

/** Resolve dependent follow-ups from user turns, never instructions in model replies. */
export function resolveFollowUpQuestion(question: string, history: AskUloHistoryMessage[] = []): string {
  const q = question.trim()
  if (/\b(?:that|same|this) (?:property|building)\b/i.test(q)) {
    const prior = history.filter(m => m.role === 'user').at(-1)?.content ?? ''
    const place = prior.match(/\b(?:at|for|in)\s+(.+?)(?:[?.!]|$)/i)?.[1]?.trim()
    if (place && !/\b(?:that|same|this) (?:property|building)\b/i.test(place)) {
      return q.replace(/\b(?:that|same|this) (?:property|building)\b/i, place)
    }
  }
  if (!/\b(which one|which of (?:these|those)|what about (?:that|those)|why (?:that|this) one)\b/i.test(q)) return q
  if (/\b(vendors?|residents?|tenants?|leases?|rents?|properties|buildings?)\b/i.test(q)) return q
  const prior = history.filter((m) => m.role === 'user').at(-1)?.content ?? ''
  if (isDailyPrioritiesQuestion(prior) || /\b(repairs?|work\s*orders?|maintenance)\b/i.test(prior)) {
    return `Prioritize the open work orders: ${q}`
  }
  if (/\bvendors?\b/i.test(prior)) {
    const metric = /\b(respond|response|speed|slow)\b/i.test(prior) ? ' by response time' : ''
    return `Among the vendors${metric}: ${q}`
  }
  return q
}
