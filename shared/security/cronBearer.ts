/**
 * Cron bearer decision. Missing server secret fails closed.
 * The caller passes the first configured secret; an empty value is not a pass.
 */
export function cronBearerMatches(
  configuredSecret: string | null | undefined,
  authorizationHeader: string | null | undefined,
): boolean {
  const secret = configuredSecret?.trim() ?? ''
  if (!secret) return false
  const header = authorizationHeader?.trim() ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return false
  return header.slice(7).trim() === secret
}
