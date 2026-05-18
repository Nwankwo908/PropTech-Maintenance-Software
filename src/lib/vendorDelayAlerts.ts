/**
 * When to show “vendor delayed” AI alternative UI for tickets in `pending_accept`.
 * Dev: 0 ms so local testing works without waiting.
 */
export function vendorPendingDelayThresholdMs(): number {
  const raw = import.meta.env.VITE_VENDOR_DELAY_AI_MS?.trim()
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return import.meta.env.DEV ? 0 : 60 * 60 * 1000
}

export const VENDOR_AUTO_REASSIGN_MS = 48 * 60 * 60 * 1000

export function isVendorPendingAcceptDelayed(
  vendorWorkStatus: string | null | undefined,
  assignedAtIso: string | null | undefined,
): boolean {
  const st = (vendorWorkStatus ?? '').trim().toLowerCase()
  if (st !== 'pending_accept') return false
  const threshold = vendorPendingDelayThresholdMs()
  if (!assignedAtIso?.trim()) return threshold === 0
  const t = new Date(assignedAtIso).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t >= threshold
}

export function vendorAutoReassignDeadlineLabel(
  assignedAtIso: string | null | undefined,
): string | null {
  if (!assignedAtIso?.trim()) return null
  const t = new Date(assignedAtIso).getTime()
  if (Number.isNaN(t)) return null
  const d = new Date(t + VENDOR_AUTO_REASSIGN_MS)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
