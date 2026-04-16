/** Bearer token is a Supabase session JWT (three dot-separated segments). */
export function bearerLooksLikeJwt(token: string): boolean {
  const parts = token.split(".")
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

/** `vendors.portal_api_key` values (and URL `k` when used as portal key) are UUIDs. */
export const PORTAL_API_KEY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
