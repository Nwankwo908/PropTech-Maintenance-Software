const REQUEST_REF = /^[0-9A-F]{8,32}$/i

/** Short resident ref when it is unique. Otherwise the ticket id. */
export function findVendorTicketToken(
  ticketId: string,
  requestRef?: string | null,
): string {
  const ref = (requestRef ?? "").trim()
  if (REQUEST_REF.test(ref)) return ref.toUpperCase()
  return ticketId.trim()
}

export function isUuidTicketToken(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  )
}

export function isResidentRequestRefToken(value: string): boolean {
  const token = value.trim()
  return REQUEST_REF.test(token) && !isUuidTicketToken(token)
}
