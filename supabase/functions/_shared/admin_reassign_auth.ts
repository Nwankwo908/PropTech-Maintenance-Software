/**
 * Hosted Supabase validates `Authorization` as a JWT; a hex admin secret there
 * returns 401 before the function runs. Callers should send the secret in
 * `x-admin-reassign-secret` and use anon JWT in `Authorization` + `apikey`.
 * Legacy: `Authorization: Bearer <ADMIN_REASSIGN_SECRET>` (e.g. curl / local serve).
 *
 * **401 `{ error: "Unauthorized" }` from the handler** means this function returned
 * false: after trim, `x-admin-reassign-secret` !== `ADMIN_REASSIGN_SECRET`, and the
 * Bearer token is not the legacy admin secret (e.g. it is the anon JWT). Fix by
 * aligning Dashboard Edge secrets with `VITE_ADMIN_REASSIGN_SECRET`.
 */
export function adminReassignSecretAuthorized(req: Request): boolean {
  const expected = Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()
  if (!expected) return false

  const fromCustom = req.headers.get("x-admin-reassign-secret")?.trim()
  if (fromCustom === expected) return true

  const h = req.headers.get("Authorization")?.trim()
  if (h?.toLowerCase().startsWith("bearer ")) {
    const t = h.slice(7).trim()
    if (t === expected) return true
  }
  return false
}
