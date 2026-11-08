/**
 * Routine jobs require landlord selection before any vendor is contacted.
 * AI-dispatch settings do not authorize pre-approval availability probes.
 * Emergencies retain their existing outreach policy.
 */

export function shouldHoldRoutineVendorOutreach(input: {
  allowAiDispatch: boolean
  emergency: boolean
  landlordAcknowledged: boolean
}): boolean {
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
