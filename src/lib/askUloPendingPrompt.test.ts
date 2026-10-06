import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAskUloPendingPrompt,
  clearAskUloPromptAutoSent,
  consumeAskUloPromptForAutoSend,
  finishAskUloAutoSend,
  isAskUloAutoSendInFlight,
  peekAskUloPendingPrompt,
  stashAskUloPendingPrompt,
  takeAskUloPendingPrompt,
  wasAskUloPromptAutoSent,
} from '@/lib/askUloPendingPrompt'

describe('askUloPendingPrompt', () => {
  afterEach(() => {
    clearAskUloPendingPrompt()
    clearAskUloPromptAutoSent()
  })

  it('peeks without clearing so Strict Mode remounts keep the prompt', () => {
    stashAskUloPendingPrompt('  What needs attention?  ')
    expect(peekAskUloPendingPrompt()).toBe('What needs attention?')
    expect(peekAskUloPendingPrompt()).toBe('What needs attention?')
    clearAskUloPendingPrompt()
    expect(peekAskUloPendingPrompt()).toBeNull()
  })

  it('take still clears for callers that want one-shot read', () => {
    stashAskUloPendingPrompt('Show overdue work orders')
    expect(takeAskUloPendingPrompt()).toBe('Show overdue work orders')
    expect(takeAskUloPendingPrompt()).toBeNull()
  })

  it('ignores blank prompts', () => {
    stashAskUloPendingPrompt('   ')
    expect(peekAskUloPendingPrompt()).toBeNull()
  })

  it('consumeAskUloPromptForAutoSend claims a prompt only once', () => {
    const q = 'Which work orders are overdue?'
    expect(consumeAskUloPromptForAutoSend(q)).toBe(q)
    expect(wasAskUloPromptAutoSent(q)).toBe(true)
    expect(isAskUloAutoSendInFlight()).toBe(true)
    expect(peekAskUloPendingPrompt()).toBeNull()
    expect(consumeAskUloPromptForAutoSend(q)).toBeNull()
    finishAskUloAutoSend()
    expect(isAskUloAutoSendInFlight()).toBe(false)
    expect(consumeAskUloPromptForAutoSend(q)).toBeNull()
  })
})
