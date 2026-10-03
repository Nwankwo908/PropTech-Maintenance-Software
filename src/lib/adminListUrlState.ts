/**
 * Admin list chrome (filters / search / sort / tabs / panel ids) as URL search params.
 * Incidental filter changes use replace; panel open uses push (see callers).
 */

export function readCsvSet(params: URLSearchParams, key: string): Set<string> {
  const raw = params.get(key)?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
}

export function writeCsvSet(
  params: URLSearchParams,
  key: string,
  values: Iterable<string>,
): void {
  const list = Array.from(values)
    .map((v) => v.trim())
    .filter(Boolean)
    .sort()
  if (list.length === 0) params.delete(key)
  else params.set(key, list.join(','))
}

export function readStringParam(
  params: URLSearchParams,
  key: string,
  fallback = '',
): string {
  return params.get(key)?.trim() ?? fallback
}

export function writeStringParam(
  params: URLSearchParams,
  key: string,
  value: string,
  omitWhen = '',
): void {
  const next = value.trim()
  if (!next || next === omitWhen) params.delete(key)
  else params.set(key, next)
}

export function mutateSearchParams(
  current: URLSearchParams,
  mutate: (next: URLSearchParams) => void,
): URLSearchParams {
  const next = new URLSearchParams(current)
  mutate(next)
  return next
}

/** Params that identify an open panel/modal — excluded from scroll restore keys when desired. */
export const ADMIN_PANEL_PARAM_KEYS = ['run', 'thread'] as const

export function listScrollKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  for (const key of ADMIN_PANEL_PARAM_KEYS) params.delete(key)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
