/** Simulated extract progress while vision analysis is in flight (no server %). */

const EXTRACT_DURATION_MS = 20_000
const EXTRACT_CEILING = 97

export function inspectionExtractPercent(
  elapsedMs: number,
  durationMs = EXTRACT_DURATION_MS,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  const t = elapsedMs / Math.max(1, durationMs)
  return Math.min(EXTRACT_CEILING, Math.round((1 - Math.exp(-2.2 * t)) * EXTRACT_CEILING))
}

export function clampExtractDisplayPercent(percent: number, complete: boolean): number {
  if (complete) return 100
  if (!Number.isFinite(percent)) return 0
  return Math.min(EXTRACT_CEILING, Math.max(0, Math.round(percent)))
}
