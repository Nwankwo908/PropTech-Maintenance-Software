/**
 * Landlord SMS when a vendor submits an estimate that needs approval.
 */
import {
  appendLandlordAskTail,
  landlordApproveDeclineReplyHint,
  landlordAskOpening,
  landlordAskSummaryLine,
} from "./landlordAskSms.ts"

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function buildLandlordEstimateApprovalSms(input: {
  vendorName: string
  workOrderRef: string
  unit?: string | null
  locationLabel?: string | null
  issueHeadline?: string | null
  issueCategory?: string | null
  propertyType?: string | null
  totalCost: number
  partsCost: number
  laborCost: number
  exceedsEscalationThreshold?: boolean
  approveUrl?: string | null
  rejectUrl?: string | null
  landlordFirstName?: string | null
}): string {
  const vendor = input.vendorName.trim() || "A vendor"
  const opening = landlordAskOpening(input.landlordFirstName, "estimate needs approval")
  const summary = landlordAskSummaryLine({
    locationLabel: input.locationLabel,
    unit: input.unit,
    propertyType: input.propertyType,
    issueHeadline: input.issueHeadline,
    issueCategory: input.issueCategory,
  })

  const lines = [opening]
  if (summary) lines.push("", summary)
  lines.push(
    "",
    `${vendor} submitted an estimate of ${money(input.totalCost)}.`,
    `Parts ${money(input.partsCost)} · labor ${money(input.laborCost)}.`,
  )
  if (input.exceedsEscalationThreshold) {
    lines.push(
      "",
      "This amount is above your usual review threshold — please take a look soon.",
    )
  }
  lines.push("", landlordApproveDeclineReplyHint())

  const approve = input.approveUrl?.trim() ?? ""
  const reject = input.rejectUrl?.trim() ?? ""
  if (approve) {
    lines.push("", `Or tap Approve: ${approve}`)
    if (reject) lines.push(`Decline: ${reject}`)
  } else {
    lines.push("", "Or open the admin dashboard to review this estimate.")
  }

  return appendLandlordAskTail(lines, {
    workOrderRef: input.workOrderRef,
  })
}
