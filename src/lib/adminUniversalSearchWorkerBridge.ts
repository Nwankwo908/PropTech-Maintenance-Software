import {
  buildSearchPrefixIndex,
  searchWithPrefixIndex,
  type SearchPrefixIndex,
  type SearchQueryCache,
  type UniversalSearchItem,
} from '@/lib/adminUniversalSearchCore'
import type {
  SearchWorkerInMessage,
  SearchWorkerOutMessage,
} from '@/lib/adminUniversalSearch.worker'

type PendingSearch = {
  resolve: (value: { results: UniversalSearchItem[]; timedMs: number }) => void
  reject: (reason?: unknown) => void
}

let worker: Worker | null = null
let workerFailed = false
let mainPrefix: SearchPrefixIndex | null = null
let mainPrevious: SearchQueryCache | null = null
let requestSeq = 0
const pending = new Map<number, PendingSearch>()

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined' || workerFailed) return null
  try {
    const next = new Worker(
      new URL('./adminUniversalSearch.worker.ts', import.meta.url),
      { type: 'module' },
    )
    next.onmessage = (event: MessageEvent<SearchWorkerOutMessage>) => {
      const msg = event.data
      if (msg.type !== 'searchResult') return
      const entry = pending.get(msg.requestId)
      if (!entry) return
      pending.delete(msg.requestId)
      entry.resolve({ results: msg.results, timedMs: msg.timedMs })
    }
    next.onerror = () => {
      workerFailed = true
      worker?.terminate()
      worker = null
      for (const [, entry] of pending) {
        entry.reject(new Error('search worker failed'))
      }
      pending.clear()
    }
    return next
  } catch {
    workerFailed = true
    return null
  }
}

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (!worker) worker = createWorker()
  return worker
}

export function setSearchWorkerIndex(items: UniversalSearchItem[]): void {
  mainPrefix = buildSearchPrefixIndex(items)
  mainPrevious = null
  const w = getWorker()
  if (!w) return
  const message: SearchWorkerInMessage = { type: 'setIndex', items }
  w.postMessage(message)
}

export function clearSearchWorkerIndex(): void {
  mainPrefix = null
  mainPrevious = null
  for (const [, entry] of pending) {
    entry.resolve({ results: [], timedMs: 0 })
  }
  pending.clear()
  if (worker) {
    worker.terminate()
    worker = null
  }
}

function searchOnMain(query: string): { results: UniversalSearchItem[]; timedMs: number } {
  const started = performance.now()
  if (!mainPrefix) return { results: [], timedMs: 0 }
  const results = searchWithPrefixIndex(mainPrefix, query, mainPrevious)
  mainPrevious = { query, results }
  return { results, timedMs: performance.now() - started }
}

/** Run search off the main thread when a Worker is available; sync fallback otherwise. */
export function searchAdminIndexAsync(
  query: string,
): Promise<{ results: UniversalSearchItem[]; timedMs: number }> {
  const trimmed = query.trim()
  if (!trimmed) return Promise.resolve({ results: [], timedMs: 0 })

  const w = getWorker()
  if (!w || !mainPrefix) {
    return Promise.resolve(searchOnMain(query))
  }

  const requestId = ++requestSeq
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    const message: SearchWorkerInMessage = { type: 'search', requestId, query }
    w.postMessage(message)
    // Safety: if the worker never answers, fall back.
    window.setTimeout(() => {
      if (!pending.has(requestId)) return
      pending.delete(requestId)
      resolve(searchOnMain(query))
    }, 800)
  })
}
