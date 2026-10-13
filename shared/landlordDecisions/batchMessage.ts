/** Landlord-facing batch SMS. No opt-out keywords in the body. */

export const LANDLORD_PICK_BATCH_LIMIT = 5
export const LANDLORD_PICK_BATCH_COOLDOWN_MS = 10 * 60 * 1000

export type LandlordPickBatchItem = {
  displayId: number
  unitLabel?: string | null
  issue: string
  vendorName: string
  windowLabel?: string | null
  costLow?: number | null
  costHigh?: number | null
}

function money(amount: number): string {
  return `$${Math.round(amount)}`
}

export function formatEstimateRange(
  costLow?: number | null,
  costHigh?: number | null,
): string {
  const low = costLow == null || Number.isNaN(costLow) ? null : costLow
  const high = costHigh == null || Number.isNaN(costHigh) ? null : costHigh
  if (low == null && high == null) return ""
  if (low != null && high != null && Math.round(low) !== Math.round(high)) {
    return `est ${money(low)}-${Math.round(high)}`
  }
  return `est ${money(low ?? high!)}`
}

export function formatLandlordPickBatchLine(item: LandlordPickBatchItem): string {
  const place = [item.unitLabel?.trim(), item.issue.trim()].filter(Boolean).join(" ")
  const head = `#${item.displayId} ${place}`.trim()
  const vendorWindow = [item.vendorName.trim(), item.windowLabel?.trim()].filter(Boolean).join(" ")
  const estimate = formatEstimateRange(item.costLow, item.costHigh)
  return [head, vendorWindow, estimate].filter(Boolean).join(" - ")
}

export function buildLandlordPickBatchSms(
  items: LandlordPickBatchItem[],
  overflowCount = 0,
): string {
  const shown = items.slice(0, LANDLORD_PICK_BATCH_LIMIT)
  const count = shown.length
  const noun = count === 1 ? "request needs" : "requests need"
  const lines = [
    `Ulo: ${count} ${noun} your decision`,
    "",
    ...shown.map(formatLandlordPickBatchLine),
  ]
  const extra = overflowCount > 0 ? overflowCount : Math.max(0, items.length - shown.length)
  if (extra > 0) {
    lines.push("", `+${extra} more after these`)
  }
  lines.push(
    "",
    "Reply like: 101 yes, 103 snooze fri, 104 skip. Or YES ALL.",
  )
  return lines.join("\n")
}

export function landlordPickBatchShouldQueue(
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (!lastSentAt) return false
  return now.getTime() - lastSentAt.getTime() < LANDLORD_PICK_BATCH_COOLDOWN_MS
}

/** True when a YES ALL reply lands within 10 minutes of a batch that replaced another. */
export function yesAllNeedsConfirm(input: {
  yesAll: boolean
  latestBatchCreatedAt: Date
  previousSupersededAt: Date | null
  confirmAlreadyRequested: boolean
  now: Date
}): boolean {
  if (!input.yesAll || input.confirmAlreadyRequested || !input.previousSupersededAt) {
    return false
  }
  const age = input.now.getTime() - input.latestBatchCreatedAt.getTime()
  return age >= 0 && age < LANDLORD_PICK_BATCH_COOLDOWN_MS
}
