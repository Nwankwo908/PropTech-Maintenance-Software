/**
 * Whether a second inbound may attach to the draft already stored for this
 * conversation. A different trade, or an explicit new request, stays separate.
 * Same-trade follow-ups reuse the open draft. This is not text-similarity merge.
 */
export function isExplicitSeparateRequest(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  return /^(separate|different|new)\b/i.test(text) ||
    /\b(separate problem|different (?:issue|problem)|new (?:issue|problem|request)|none of (?:these|those|them))\b/i
      .test(text)
}

export function shouldReuseIntakeDraft(input: {
  separateRequest: boolean
  existingCategory: string | null
  incomingCategory: string | null
}): boolean {
  if (input.separateRequest) return false
  const existing = input.existingCategory?.trim().toLowerCase() || ""
  const incoming = input.incomingCategory?.trim().toLowerCase() || ""
  if (!existing || !incoming) return true
  return existing === incoming
}
