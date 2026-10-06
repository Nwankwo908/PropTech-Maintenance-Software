import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAskUloPendingPrompt,
  clearAskUloPromptAutoSent,
  peekAskUloPendingPrompt,
} from '@/lib/askUloPendingPrompt'
import { ASK_ULO_LAUNCH_EVENT } from '@/lib/launchAskUloFromSearch'

describe('launchAskUloFromSearch', () => {
  afterEach(() => {
    clearAskUloPendingPrompt()
    clearAskUloPromptAutoSent()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('lets AskUloProvider handle the launch when the event is canceled', async () => {
    const hrefWrites: string[] = []
    vi.stubGlobal('window', {
      location: {
        pathname: '/admin',
        search: '',
        origin: 'http://127.0.0.1:5173',
        get href() {
          return 'http://127.0.0.1:5173/admin'
        },
        set href(value: string) {
          hrefWrites.push(value)
        },
      },
      sessionStorage: {
        store: new Map<string, string>(),
        setItem(k: string, v: string) {
          this.store.set(k, v)
        },
        getItem(k: string) {
          return this.store.get(k) ?? null
        },
        removeItem(k: string) {
          this.store.delete(k)
        },
      },
      dispatchEvent(event: Event) {
        event.preventDefault()
        return false
      },
      CustomEvent: globalThis.CustomEvent,
    })

    const { launchAskUloFromSearch } = await import('@/lib/launchAskUloFromSearch')
    launchAskUloFromSearch('Which work orders are overdue?')

    expect(peekAskUloPendingPrompt()).toBe('Which work orders are overdue?')
    expect(hrefWrites).toHaveLength(0)
  })

  it('falls back to location.href when no provider handles the event', async () => {
    const hrefWrites: string[] = []
    vi.stubGlobal('window', {
      location: {
        pathname: '/admin',
        search: '',
        origin: 'http://127.0.0.1:5173',
        get href() {
          return 'http://127.0.0.1:5173/admin'
        },
        set href(value: string) {
          hrefWrites.push(value)
        },
      },
      sessionStorage: {
        store: new Map<string, string>(),
        setItem(k: string, v: string) {
          this.store.set(k, v)
        },
        getItem(k: string) {
          return this.store.get(k) ?? null
        },
        removeItem(k: string) {
          this.store.delete(k)
        },
      },
      dispatchEvent(event: Event) {
        // Default: not canceled — hard navigation fallback.
        return true
      },
      CustomEvent: globalThis.CustomEvent,
    })

    const { launchAskUloFromSearch } = await import('@/lib/launchAskUloFromSearch')
    launchAskUloFromSearch('Which work orders are overdue?')

    expect(peekAskUloPendingPrompt()).toBe('Which work orders are overdue?')
    expect(hrefWrites[0]).toContain('askUlo=1')
    expect(hrefWrites[0]).toContain('askUloDock=1')
    const askQ = new URL(hrefWrites[0]).searchParams.get('askUloQ')
    expect(askQ).toBe('Which work orders are overdue?')
    expect(ASK_ULO_LAUNCH_EVENT).toBe('ulo-ask-ulo-launch')
  })
})
