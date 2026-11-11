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
/** Browser and user calls must use a session. The shared secret is not authorization. */
export function adminReassignSecretAuthorized(_req: Request): boolean {
  return false
}
