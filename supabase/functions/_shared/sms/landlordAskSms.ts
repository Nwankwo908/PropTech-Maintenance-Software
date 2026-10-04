/**
 * Shared framing for landlord-facing SMS asks (vendor choice, estimate,
 * invoice, attention). Summary leads; WO code trails as a lightweight ref.
 */
import { formatLocationWithOptionalUnit } from "../properties/unitLabelDisplay.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"

export function landlordAskOpening(
  landlordFirstName: string | null | undefined,
  reason: string,
): string {
  const first = landlordFirstName?.trim()
  const why = reason.trim() || "needs your attention"
  return first ? `Hi ${first} — ${why}` : `Hi — ${why}`
}

/** Property / unit · issue category (or headline). */
export function landlordAskSummaryLine(input: {
  locationLabel?: string | null
  unit?: string | null
  propertyType?: string | null
  issueCategory?: string | null
  issueHeadline?: string | null
  tradeLabel?: string | null
}): string {
  const loc =
    input.locationLabel?.trim() ||
    formatLocationWithOptionalUnit({
      unitLabel: input.unit,
      propertyType: input.propertyType,
    }) ||
    ""
  const category =
    input.issueHeadline?.trim() ||
    input.issueCategory?.trim() ||
    input.tradeLabel?.trim() ||
    ""
  if (loc && category) return `${loc} · ${category}`
  if (loc) return loc
  if (category) return category
  return ""
}

export function landlordAskRefLine(workOrderRef: string | null | undefined): string {
  const wo = (workOrderRef ?? "").trim()
  if (!wo) return ""
  const normalized = /^WO-/i.test(wo) ? wo.toUpperCase() : formatWorkOrderRef(wo)
  return `Ref: ${normalized}`
}

/** Optional address/WO for multi-pending threads — bare replies still work with one ask. */
export const LANDLORD_MULTI_PENDING_REPLY_HINT =
  "if you have more than one pending, include the address"

export function landlordNumberedChoiceReplyHint(count: number): string {
  if (count <= 0) return ""
  if (count === 1) {
    return `Reply 1 — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
  }
  if (count === 2) {
    return `Reply 1 or 2 — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
  }
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${
    nums[nums.length - 1]
  } — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
}

export function landlordYesChoiceReplyHint(vendorName: string): string {
  const name = vendorName.trim() || "them"
  return `Reply YES to send the job to ${name} — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
}

export function landlordApproveDeclineReplyHint(): string {
  return `Reply APPROVE to let them continue with the repair, or DECLINE if you need a revised estimate — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
}

export function landlordYesNoPaidReplyHint(): string {
  return `Reply YES if paid, or NO if not yet — ${LANDLORD_MULTI_PENDING_REPLY_HINT}`
}

/** Extract first WO-XXXX token from a landlord reply. */
export function extractWorkOrderRefFromReply(body: string): string | null {
  const m = body.match(/\bWO-([A-Za-z0-9]{4})\b/i)
  if (!m?.[1]) return null
  return `WO-${m[1].toUpperCase()}`
}

/**
 * True when the reply mentions this ask's property/address (or WO already matched).
 * Used to disambiguate bare numbered replies across multiple pending asks.
 */
export function replyMentionsLandlordAskLocation(
  body: string,
  locationLabel: string | null | undefined,
): boolean {
  const loc = (locationLabel ?? "").trim().toLowerCase()
  if (!loc) return false
  const normalized = body
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) return false
  if (normalized.includes(loc)) return true
  // Street number + first street token (e.g. "563 Springdale" from full label).
  const tokens = loc
    .split(/[\s·,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^(unit|apt|suite|#)$/i.test(t))
  if (tokens.length >= 2) {
    const pair = `${tokens[0]} ${tokens[1]}`
    if (normalized.includes(pair)) return true
  }
  return tokens.some((t) => t.length >= 4 && normalized.includes(t))
}

export function appendLandlordAskTail(lines: string[], input: {
  adminUrl?: string | null
  workOrderRef?: string | null
}): string {
  const out = [...lines]
  const adminUrl = input.adminUrl?.trim() ?? ""
  if (adminUrl) {
    out.push("", "View details:", adminUrl)
  }
  const ref = landlordAskRefLine(input.workOrderRef)
  if (ref) {
    out.push("", ref)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}
