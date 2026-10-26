/** Landlord-facing batch SMS. No opt-out keywords in the body. */

import { formatUnitReference } from "../properties/unitLabelDisplay.ts"

export const LANDLORD_PICK_BATCH_LIMIT = 5
export const LANDLORD_PICK_BATCH_COOLDOWN_MS = 10 * 60 * 1000

export type LandlordPickTicketClass = "reactive" | "proactive"

export type LandlordPickBatchItem = {
  displayId: number
  unitLabel?: string | null
  issue: string
  vendorName: string
  windowLabel?: string | null
  costLow?: number | null
  costHigh?: number | null
  room?: string | null
  propertyAddress?: string | null
  propertyType?: string | null
  ticketClass?: LandlordPickTicketClass | null
  /** One quick-fix line. Ignored when the batch has more than one item. */
  selfFixLine?: string | null
}

export type LandlordPickBatchSmsOptions = {
  /** When the landlord has more than one property, each line includes the address. */
  propertyCount?: number
}

const ROOM_PREFIX =
  /^(bedroom|bathroom|kitchen|basement|laundry|living room)\b/i

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

function roomFromItem(item: LandlordPickBatchItem): string {
  const explicit = item.room?.trim()
  if (explicit) return explicit.toLowerCase()
  const match = item.issue.trim().match(ROOM_PREFIX)
  return match?.[1]?.toLowerCase() ?? ""
}

/** "{issue} — Unit {unit} ({room})". Single-family homes omit the unit. */
export function formatLandlordPickPlace(
  item: LandlordPickBatchItem,
  includeAddress = false,
): string {
  const issue = item.issue.trim() || "Repair"
  const unit = formatUnitReference(item.unitLabel, item.propertyType)
  const room = roomFromItem(item)
  let place = issue
  if (unit && room) place = `${issue} — ${unit} (${room})`
  else if (unit) place = `${issue} — ${unit}`
  else if (room) place = `${issue} (${room})`
  const address = includeAddress ? item.propertyAddress?.trim() ?? "" : ""
  if (address) place = `${place} at ${address}`
  return place
}

export function formatLandlordPickBatchLine(
  item: LandlordPickBatchItem,
  includeAddress = false,
): string {
  const head = `#${item.displayId} ${formatLandlordPickPlace(item, includeAddress)}`.trim()
  const vendorWindow = [item.vendorName.trim(), item.windowLabel?.trim()]
    .filter(Boolean)
    .join(" · ")
  const estimate = formatEstimateRange(item.costLow, item.costHigh)
  return [head, vendorWindow, estimate].filter(Boolean).join(" - ")
}

function singleAskReply(
  _ticketClass: LandlordPickTicketClass | null | undefined,
): string {
  return "Reply YES to approve or NO to decline."
}

function singleAskSms(item: LandlordPickBatchItem, includeAddress: boolean): string {
  const issue = item.issue.trim() || "Repair"
  const unit = formatUnitReference(item.unitLabel, item.propertyType)
  const address = includeAddress ? item.propertyAddress?.trim() ?? "" : ""
  let where = ""
  if (address && unit) where = ` at ${address}, ${unit}`
  else if (address) where = ` at ${address}`
  else if (unit) where = `, ${unit}`
  const vendorLine = [
    item.vendorName.trim(),
    item.windowLabel?.trim(),
    formatEstimateRange(item.costLow, item.costHigh),
  ].filter(Boolean).join(" · ")
  const tip = item.selfFixLine?.trim()
  return [
    `Ulo: Approval needed: ${issue}${where}.`,
    vendorLine,
    tip,
    singleAskReply(item.ticketClass),
  ].filter(Boolean).join("\n")
}

function exampleFromShown(shown: LandlordPickBatchItem[]): string {
  const first = shown[0]?.displayId
  const second = shown[1]?.displayId
  if (first == null || second == null) return ""
  return `Reply like: ${first} yes, ${second} no. Or YES ALL.`
}

export function buildLandlordPickBatchSms(
  items: LandlordPickBatchItem[],
  overflowCount = 0,
  options?: LandlordPickBatchSmsOptions,
): string {
  const shown = items.slice(0, LANDLORD_PICK_BATCH_LIMIT)
  const includeAddress = (options?.propertyCount ?? 1) > 1
  if (shown.length === 1) {
    return singleAskSms(shown[0]!, includeAddress)
  }
  const count = shown.length
  const noun = count === 1 ? "request needs" : "requests need"
  const lines = [
    `Ulo: ${count} ${noun} your decision`,
    "",
    ...shown.map((item) => formatLandlordPickBatchLine(item, includeAddress)),
  ]
  const extra = overflowCount > 0 ? overflowCount : Math.max(0, items.length - shown.length)
  if (extra > 0) {
    lines.push("", `+${extra} more after these`)
  }
  const example = exampleFromShown(shown)
  if (example) lines.push("", example)
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
