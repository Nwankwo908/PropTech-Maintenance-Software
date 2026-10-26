/**
 * Tenant-facing request reference.
 * The first 8 hex characters match refs already texted (for example 30A0B8CC).
 * A longer prefix is used only when that short ref is already taken.
 */

const HEX = /[^0-9a-f]/gi

export function ticketIdHex(ticketId: string): string {
  return ticketId.replace(HEX, "").toUpperCase()
}

export function residentRequestRefCandidates(ticketId: string): string[] {
  const hex = ticketIdHex(ticketId)
  if (hex.length < 8) return hex ? [hex] : []
  const lengths = [8, 12, 16, 20, 24, 32].filter((n) => n < hex.length)
  lengths.push(hex.length)
  const seen = new Set<string>()
  const out: string[] = []
  for (const length of lengths) {
    const value = hex.slice(0, length)
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** True when `candidate` would be ambiguous next to an already issued ref. */
export function residentRequestRefCollides(candidate: string, existing: string): boolean {
  const next = candidate.trim().toUpperCase()
  const prior = existing.trim().toUpperCase()
  if (!next || !prior) return false
  return prior === next || prior.startsWith(next)
}

/**
 * Shortest safe ref for this ticket. Existing refs are left unchanged;
 * only the new ticket grows when the 8-character prefix is already used.
 */
export function pickUniqueResidentRequestRef(
  ticketId: string,
  taken: Iterable<string>,
): string {
  const used = Array.from(taken, (value) => value.trim().toUpperCase()).filter(Boolean)
  const candidates = residentRequestRefCandidates(ticketId)
  for (const candidate of candidates) {
    if (!used.some((prior) => residentRequestRefCollides(candidate, prior))) {
      return candidate
    }
  }
  return candidates[candidates.length - 1] ?? ticketIdHex(ticketId).slice(0, 8)
}

/** Stored ref when present; otherwise the unambiguous 8-character prefix. */
export function residentRequestRef(
  ticketId: string,
  stored?: string | null,
): string {
  const saved = (stored ?? "").trim().toUpperCase()
  if (/^[0-9A-F]{8,32}$/.test(saved)) return saved
  return pickUniqueResidentRequestRef(ticketId, [])
}

/** Phrase in “your {phrase} request”. AC failures stay “AC repair”. */
export function residentRequestPhrase(
  categoryLabel: string | null | undefined,
  sourceText?: string | null,
): string {
  const label = (categoryLabel ?? "").trim()
  const text = sourceText ?? ""
  if (/^hvac$/i.test(label) && /\b(a\/?c|air\s*condition\w*|cooling)\b/i.test(text)) {
    return "AC repair"
  }
  if (/^hvac$/i.test(label)) return "HVAC"
  if (!label || /^maintenance$/i.test(label)) return "maintenance"
  return label
}

export function buildResidentRequestConfirmationSms(input: {
  requestRef: string
  requestPhrase?: string | null
  vendorWillContact?: boolean
  handlingTip?: string | null
}): string {
  const phrase = (input.requestPhrase ?? "").trim() || "maintenance"
  const next = input.vendorWillContact
    ? "Your vendor will be in touch to schedule."
    : "We'll text you here with updates."
  const tip = input.handlingTip?.trim()
  const ref = input.requestRef.trim().toUpperCase()
  return [
    `Thanks! We've received your ${phrase} request. ${next}`,
    tip ? "" : null,
    tip || null,
    "",
    `Ref: ${ref}`,
  ].filter((line): line is string => line != null).join("\n")
}

export function buildResidentRequestsConfirmationSms(input: {
  requestRefs: string[]
  vendorWillContact?: boolean
  handlingTip?: string | null
}): string {
  const refs = input.requestRefs.map((ref) => ref.trim().toUpperCase()).filter(Boolean)
  const n = refs.length
  const next = input.vendorWillContact
    ? "Your vendor will be in touch to schedule."
    : "We'll text you here with updates."
  const tip = input.handlingTip?.trim()
  return [
    `Thanks! We've received your ${n} maintenance request${n === 1 ? "" : "s"}. ${next}`,
    tip ? "" : null,
    tip || null,
    "",
    ...refs.map((ref) => `Ref: ${ref}`),
  ].filter((line): line is string => line != null).join("\n")
}
