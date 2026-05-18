/**
 * CORS for admin Edge calls from the browser (e.g. localhost → *.supabase.co).
 * Use `Access-Control-Allow-Headers: *` so preflight always matches whatever the
 * browser lists in `Access-Control-Request-Headers` (avoids subtle casing /
 * extra-header mismatches vs a fixed allow-list).
 */
export const adminEdgeCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}
