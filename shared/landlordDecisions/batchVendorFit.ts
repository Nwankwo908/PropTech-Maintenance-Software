import { vendorTradeMatchesForDispatch } from "../maintenance/vendorTrades.ts"

export type PickBatchVendorProposal = {
  matched: boolean
  vendorName: string
  windowLabel: string | null
  vendorId: string | null
}

/**
 * A pick-batch line may name a vendor only when their trade fits the ticket.
 * A mismatch is not proposed — the line says a vendor is still needed.
 */
export function pickBatchVendorProposal(input: {
  vendorId?: string | null
  vendorName: string
  vendorCategory?: string | null
  issueCategory?: string | null
  windowLabel?: string | null
}): PickBatchVendorProposal {
  const matched = vendorTradeMatchesForDispatch(
    input.vendorCategory,
    input.issueCategory,
  )
  if (!matched) {
    return {
      matched: false,
      vendorName: "needs a vendor",
      windowLabel: null,
      vendorId: null,
    }
  }
  const vendorId = input.vendorId?.trim() || null
  return {
    matched: true,
    vendorName: input.vendorName.trim() || "your vendor",
    windowLabel: input.windowLabel?.trim() || null,
    vendorId,
  }
}
