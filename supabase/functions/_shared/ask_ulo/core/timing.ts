/** Timing metadata only: never accept questions, answers, account IDs or errors. */
export function createAskUloTiming(
  now: () => number = () => performance.now(),
  sink: (event: unknown) => void = (event) => console.info(JSON.stringify(event)),
  requestedTraceId?: string | null,
) {
  const start = now()
  const stagesMs: Record<string, number> = {}
  const active = new Map<symbol, { stage: string; at: number }>()
  const traceId = requestedTraceId && /^[0-9a-f-]{36}$/i.test(requestedTraceId) ? requestedTraceId : crypto.randomUUID()
  return {
    traceId,
    measureSync<T>(stage: string, task: () => T): T {
      const at = now()
      try { return task() }
      finally { stagesMs[stage] = (stagesMs[stage] ?? 0) + now() - at }
    },
    async measure<T>(stage: string, task: () => T | Promise<T>): Promise<T> {
      const at = now()
      const token = Symbol(stage)
      active.set(token, { stage, at })
      try { return await task() }
      finally { active.delete(token); stagesMs[stage] = (stagesMs[stage] ?? 0) + now() - at }
    },
    snapshot() {
      const current = { ...stagesMs }
      for (const { stage, at } of active.values()) current[stage] = (current[stage] ?? 0) + now() - at
      return { traceId, totalMs: now() - start, stagesMs: current, stagesInFlight: [...new Set([...active.values()].map(v => v.stage))] }
    },
    emit(status: number) {
      const timing = this.snapshot()
      sink({ event: 'ask_ulo.request_timing', schemaVersion: 1, status, ...timing })
      return timing
    },
  }
}
export type AskUloTiming = ReturnType<typeof createAskUloTiming>
