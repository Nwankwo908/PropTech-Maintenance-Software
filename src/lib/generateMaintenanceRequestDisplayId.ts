const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Unique reference shown to the resident after each successful submit (e.g. `MNT-847291-K3P9`). */
export function generateMaintenanceRequestDisplayId(): string {
  const numeric = String(Math.floor(100000 + Math.random() * 900000))
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += ALPHANUM.charAt(Math.floor(Math.random() * ALPHANUM.length))
  }
  return `MNT-${numeric}-${suffix}`
}
