/// <reference lib="webworker" />

import {
  buildSearchPrefixIndex,
  searchWithPrefixIndex,
  type SearchPrefixIndex,
  type SearchQueryCache,
  type UniversalSearchItem,
} from './adminUniversalSearchCore'

export type SearchWorkerInMessage =
  | { type: 'setIndex'; items: UniversalSearchItem[] }
  | {
      type: 'search'
      requestId: number
      query: string
    }

export type SearchWorkerOutMessage =
  | { type: 'ready' }
  | {
      type: 'searchResult'
      requestId: number
      results: UniversalSearchItem[]
      timedMs: number
    }

let prefixIndex: SearchPrefixIndex | null = null
let previous: SearchQueryCache | null = null

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<SearchWorkerInMessage>) => {
  const msg = event.data
  if (msg.type === 'setIndex') {
    prefixIndex = buildSearchPrefixIndex(msg.items)
    previous = null
    ctx.postMessage({ type: 'ready' } satisfies SearchWorkerOutMessage)
    return
  }

  if (msg.type === 'search') {
    const started = performance.now()
    const results =
      prefixIndex != null
        ? searchWithPrefixIndex(prefixIndex, msg.query, previous)
        : []
    previous = { query: msg.query, results }
    const timedMs = performance.now() - started
    ctx.postMessage({
      type: 'searchResult',
      requestId: msg.requestId,
      results,
      timedMs,
    } satisfies SearchWorkerOutMessage)
  }
}
