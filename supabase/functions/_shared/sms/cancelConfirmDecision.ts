/**
 * A cancel keyword can identify a request. It cannot close one.
 * Naming the request after Ulo asked which one is the confirmation.
 * Any other cancel phrase waits for YES.
 */
export type CancelConfirmDecision = "close" | "ask_which" | "ask_yes" | "decline"

export function decideCancelConfirm(input: {
  whichRequestConfirmed: boolean
  awaitingYes: boolean
  affirmative: boolean
  negative: boolean
  identifiableCount: number
  hasNamedTicket: boolean
  hasTicket: boolean
}): CancelConfirmDecision {
  if (input.awaitingYes && input.negative) return "decline"
  if (input.whichRequestConfirmed && input.hasTicket) return "close"
  if (input.awaitingYes && input.affirmative && input.hasTicket) return "close"
  if (
    input.hasTicket &&
    !input.whichRequestConfirmed &&
    !input.hasNamedTicket &&
    input.identifiableCount > 1
  ) {
    return "ask_which"
  }
  return "ask_yes"
}
