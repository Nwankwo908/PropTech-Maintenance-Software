/**
 * Shared UUID check for onboarding form rows that map to DB primary keys
 * (vendors, residents). Temp client ids are not UUIDs.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPersistedOnboardingRowId(id: string): boolean {
  return UUID_RE.test(id)
}
