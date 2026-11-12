/** Shared browser preflight policy for admin Edge functions.
 * Authorization must be named explicitly: the CORS wildcard does not cover it.
 * The legacy header remains allowed during the reviewed compatibility rollout;
 * allowing a header does not grant permission to perform an action.
 */
export const adminEdgeCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-ulo-access-token, x-admin-reassign-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}
