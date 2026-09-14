/**
 * Public client IDs (same values Google/Clarity put in the browser snippet).
 * Vite inlines VITE_* at build time — if the host env is unset, production
 * would otherwise inject empty strings and never load the tags.
 */
export const DEFAULT_GA4_MEASUREMENT_ID = 'G-V3TZ9DBCGX'
export const DEFAULT_CLARITY_PROJECT_ID = 'yctaghhr6q'

export function resolveGa4MeasurementId(): string {
  return (import.meta.env.VITE_GA4_MEASUREMENT_ID ?? '').trim() || DEFAULT_GA4_MEASUREMENT_ID
}

export function resolveClarityProjectId(): string {
  return (import.meta.env.VITE_CLARITY_PROJECT_ID ?? '').trim() || DEFAULT_CLARITY_PROJECT_ID
}
