/** Who may receive a landlord pick batch, and who may answer it. */

function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

/** True when this destination is one of the landlord/ops numbers. */
export function landlordPickRecipientAllowed(
  phone: string | null | undefined,
  opsPhones: Array<string | null | undefined>,
): boolean {
  const target = phoneDigits(phone)
  if (target.length < 10) return false
  return opsPhones.some((ops) => phoneDigits(ops) === target)
}

/**
 * A resident or vendor label may answer only when the sender is the batch
 * recipient (ops phone mislabeled as a resident). Anyone else is refused.
 */
export function landlordPickReplyMayExecute(input: {
  identityType: string
  fromPhone: string | null | undefined
  recipientPhone: string | null | undefined
}): boolean {
  const from = phoneDigits(input.fromPhone)
  const recipient = phoneDigits(input.recipientPhone)
  const same = from.length >= 10 && from === recipient
  const type = input.identityType.trim().toLowerCase()
  if (type === "resident" || type === "vendor") return same
  return same
}
