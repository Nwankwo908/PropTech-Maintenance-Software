/**
 * A bare APPROVE applies only when this reply is tied to an open ask.
 * One pending estimate on the account is not that ask.
 */
export function bareEstimateApproval(input: {
  hasActiveAsk: boolean
  pendingCount: number
}): "apply" | "disambiguate" | "refuse" {
  if (input.pendingCount > 1) return "disambiguate"
  if (!input.hasActiveAsk) return "refuse"
  return "apply"
}
