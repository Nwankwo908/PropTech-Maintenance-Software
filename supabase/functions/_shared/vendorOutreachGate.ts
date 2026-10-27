/**
 * When a landlord turns off AI dispatch, routine jobs wait for their approval
 * before any vendor is texted. Emergencies and accounts that still allow
 * dispatch keep the existing outreach path.
 */

export function shouldHoldRoutineVendorOutreach(input: {
  allowAiDispatch: boolean
  emergency: boolean
  landlordAcknowledged: boolean
}): boolean {
  if (input.allowAiDispatch) return false
  if (input.emergency) return false
  if (input.landlordAcknowledged) return false
  return true
}

/**
 * A second approval must not send another job text once the vendor was notified.
 * The first approval still notifies when the vendor is chosen but not yet texted.
 */
export function vendorNotifyAlreadyCovered(input: {
  existingVendorId: string | null
  preferVendorId: string | null
  alreadyNotified: boolean
  landlordAcknowledged: boolean
}): boolean {
  const existing = input.existingVendorId?.trim() || ""
  if (!existing) return false
  const prefer = input.preferVendorId?.trim() || ""
  const firstNotifyStillDue =
    input.landlordAcknowledged === true &&
    prefer.length > 0 &&
    prefer === existing &&
    input.alreadyNotified !== true
  return !firstNotifyStillDue
}
