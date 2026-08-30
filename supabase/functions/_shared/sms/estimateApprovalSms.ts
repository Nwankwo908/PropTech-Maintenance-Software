/**
 * Landlord SMS when a vendor submits an estimate that needs approval.
 */

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function buildLandlordEstimateApprovalSms(input: {
  vendorName: string
  workOrderRef: string
  unit?: string | null
  totalCost: number
  partsCost: number
  laborCost: number
  exceedsEscalationThreshold?: boolean
  approveUrl?: string | null
  rejectUrl?: string | null
  landlordFirstName?: string | null
}): string {
  const vendor = input.vendorName.trim() || "A vendor"
  const wo = input.workOrderRef.trim() || "this work order"
  const unit = input.unit?.trim() ?? ""
  const unitBit = unit ? ` (${unit})` : ""
  const first = input.landlordFirstName?.trim()
  const greeting = first ? `Hi ${first},` : "Hi,"

  const lines = [
    greeting,
    "",
    "This is Ulo.",
    "",
    `${vendor} submitted an estimate of ${money(input.totalCost)} for work order ${wo}${unitBit}.`,
    `Parts ${money(input.partsCost)} · labor ${money(input.laborCost)}.`,
  ]
  if (input.exceedsEscalationThreshold) {
    lines.push("", "This amount is above your usual review threshold — please take a look soon.")
  }
  lines.push(
    "",
    "Reply APPROVE to let them continue with the repair, or DECLINE if you need a revised estimate.",
  )
  const approve = input.approveUrl?.trim() ?? ""
  const reject = input.rejectUrl?.trim() ?? ""
  if (approve) {
    lines.push("", `Or tap Approve: ${approve}`)
    if (reject) lines.push(`Decline: ${reject}`)
  } else {
    lines.push("", "Or open the admin dashboard to review this estimate.")
  }
  return lines.join("\n")
}
