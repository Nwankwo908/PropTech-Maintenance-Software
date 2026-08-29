/** Parse an optional dollar amount from a form field. */
export function parseOptionalUsdAmount(raw: string): number | null {
  const digits = raw.replace(/[^\d.]/g, '')
  if (!digits) return null
  const n = Number(digits)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}
