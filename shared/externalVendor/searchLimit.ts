/** How many external vendors Find External Vendor asks Thumbtack for. */
export const EXTERNAL_VENDOR_SEARCH_LIMIT = 10

/** Thumbtack businesses/search max per request. */
export const EXTERNAL_VENDOR_SEARCH_MAX = 30

/** Coverage window shown in the rail and sent as search metadata. */
export const EXTERNAL_VENDOR_SEARCH_RADIUS_MILES = 50

export function clampExternalVendorSearchLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return EXTERNAL_VENDOR_SEARCH_LIMIT
  return Math.max(1, Math.min(EXTERNAL_VENDOR_SEARCH_MAX, Math.floor(raw)))
}
