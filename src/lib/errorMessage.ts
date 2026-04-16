/**
 * Unwraps Supabase PostgREST errors and standard Errors for UI display.
 * PostgREST errors are plain objects with `message` / `details`, not `instanceof Error`.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error == null) return fallback
  if (typeof error === 'string') return error || fallback
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object') {
    const o = error as { message?: unknown; details?: unknown }
    if (typeof o.message === 'string' && o.message.length > 0) return o.message
    if (typeof o.details === 'string' && o.details.length > 0) return o.details
  }
  return fallback
}
