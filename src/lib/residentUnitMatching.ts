/**
 * Same rules as `supabase/functions/submit-maintenance-request/index.ts`
 * for email/unit comparison when resolving a resident for maintenance tickets.
 */

/** Email comparison: trim + lowercase (case-insensitive matching). */
export function normalizeEmail(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * Unit comparison: ignore case, "unit"/"apt" labels, #, spaces, and punctuation.
 * e.g. "Unit 5A" → "5a", "#5-A" → "5a"
 */
export function normalizeUnitForMatch(v: string | null | undefined): string {
  let s = (v ?? '').trim().toLowerCase()
  s = s.replace(/#/g, '')
  s = s.replace(/\b(unit|apt)\b/g, '')
  s = s.replace(/[^a-z0-9]/g, '')
  return s
}

/** True when `public.users.unit` has no matchable value (same notion as ticket lookup). */
export function isUnassignedUnitForTicketMatch(unit: string | null | undefined): boolean {
  return normalizeUnitForMatch(unit) === ''
}
