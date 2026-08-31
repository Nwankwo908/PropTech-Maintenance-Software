import { formatVendorTradeLabel } from "../maintenance/vendorTrades.ts"

export type ThumbtackOutreachJobContext = {
  propertyAddress?: string | null
  jobCategory?: string | null
  issueSummary?: string | null
  urgency?: string | null
  timeframe?: string | null
}

export function formatThumbtackJobCategoryLabel(
  raw: string | null | undefined,
): string {
  return formatVendorTradeLabel(raw, { emptyLabel: "maintenance" })
}

export function formatThumbtackUrgencyLabel(
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").trim().toLowerCase()
  if (!v) return null
  if (v === "emergency" || v === "critical") return "emergency"
  if (v === "urgent" || v === "high") return "urgent"
  if (v === "normal" || v === "standard" || v === "medium" || v === "low") {
    return "standard priority"
  }
  return raw!.trim()
}

/** Suggested first message for a Thumbtack pro. Landlord can edit before send. */
export function buildThumbtackVendorOutreachMessage(
  ctx: ThumbtackOutreachJobContext,
): string {
  const address = ctx.propertyAddress?.trim() || "this property"
  const category = formatThumbtackJobCategoryLabel(ctx.jobCategory)
  const lines = [
    `Hi, I manage a property at ${address} and have a ${category} request that needs service. Are you available to take this job?`,
  ]
  const summary = ctx.issueSummary?.trim()
  if (summary) {
    const clipped = summary.length > 280 ? `${summary.slice(0, 277).trimEnd()}…` : summary
    lines.push("", `Issue: ${clipped}`)
  }
  const urgency = formatThumbtackUrgencyLabel(ctx.urgency)
  if (urgency) lines.push(`Urgency: ${urgency}.`)
  const timeframe = ctx.timeframe?.trim()
  if (timeframe) lines.push(`Preferred timing: ${timeframe}.`)
  return lines.join("\n")
}
