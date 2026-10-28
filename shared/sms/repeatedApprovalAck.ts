/**
 * A landlord YES/APPROVE that repeats a decision already made.
 * The reply is an acknowledgement only — it never approves, assigns, or notifies.
 */

const APPROVAL_WORD = "(?:yes|y|yeah|yep|approve|approved)"

export type RepeatedApprovalParse =
  | { kind: "none" }
  | { kind: "bare" }
  | { kind: "named"; ref: string }

export type RepeatedApprovalTarget = {
  ticketId: string
  ref: string
  workOrderRef: string
  label: string
  vendorNotified: boolean
  batchId: string
}

export type RepeatedApprovalDecision =
  | { action: "ignore" }
  | { action: "clarify"; body: string }
  | { action: "acknowledge"; ticketId: string; body: string }

export function parseRepeatedApprovalReply(body: string): RepeatedApprovalParse {
  const trimmed = body
    .trim()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
  if (!trimmed) return { kind: "none" }
  if (new RegExp(`^${APPROVAL_WORD}$`, "i").test(trimmed)) {
    return { kind: "bare" }
  }
  const named = trimmed.match(
    new RegExp(`^${APPROVAL_WORD}(?:\\s+ref)?\\s+(?:wo-)?([0-9a-f]{4,32})$`, "i"),
  )
  if (!named?.[1]) return { kind: "none" }
  return { kind: "named", ref: named[1].toUpperCase() }
}

/** True only when a job text was recorded and no send error is stored. */
export function vendorNotificationVerified(input: {
  vendorNotifiedAt?: string | null
  vendorNotifyError?: string | null
}): boolean {
  const notifiedAt = (input.vendorNotifiedAt ?? "").trim()
  if (!notifiedAt) return false
  return !(input.vendorNotifyError ?? "").trim()
}

export function repeatedApprovalAcknowledgement(input: {
  ref?: string | null
  vendorNotified: boolean
}): string {
  const ref = (input.ref ?? "").trim().toUpperCase()
  if (input.vendorNotified) {
    return ref
      ? `This request is already approved. The vendor has already been notified. Ref: ${ref}.`
      : "This request is already approved. The vendor has already been notified."
  }
  if (ref) {
    return `This request is already approved. The vendor has not been notified yet. Ref: ${ref}.`
  }
  return "This request is already approved."
}

function targetMatchesRef(target: RepeatedApprovalTarget, ref: string): boolean {
  const want = ref.toUpperCase().replace(/^WO-/, "")
  const ticket = target.ticketId.replace(/-/g, "").toUpperCase()
  if (target.ref.toUpperCase() === want) return true
  const workOrder = target.workOrderRef.toUpperCase().replace(/^WO-/, "")
  if (workOrder && workOrder === want) return true
  if (want.length >= 4 && ticket.startsWith(want)) return true
  return false
}

function clarifyPending(): string {
  return "A different question is still waiting, so I won't treat that as another approval. Answer the latest text."
}

function clarifyWhich(targets: RepeatedApprovalTarget[]): string {
  const lines = ["Which request did you mean?"]
  targets.forEach((target, index) => {
    const label = target.label.trim() || "That request"
    lines.push(`${index + 1}. ${label}. Ref: ${target.ref}`)
  })
  lines.push("Reply YES and the reference.")
  return lines.join("\n")
}

function acknowledge(target: RepeatedApprovalTarget): RepeatedApprovalDecision {
  return {
    action: "acknowledge",
    ticketId: target.ticketId,
    body: repeatedApprovalAcknowledgement({
      ref: target.ref,
      vendorNotified: target.vendorNotified,
    }),
  }
}

/**
 * An unqualified YES repeats the latest single-request approval, including
 * when that reply arrives hours later. Several requests in that latest ask,
 * a reference that matches more than one, or any still-open question clarifies.
 */
export function resolveRepeatedApproval(input: {
  body: string
  pendingQuestionCount: number
  latestAsk: RepeatedApprovalTarget[]
  namedPool: RepeatedApprovalTarget[]
}): RepeatedApprovalDecision {
  const parsed = parseRepeatedApprovalReply(input.body)
  if (parsed.kind === "none") return { action: "ignore" }
  if (input.pendingQuestionCount > 0) {
    return { action: "clarify", body: clarifyPending() }
  }

  if (parsed.kind === "named") {
    const pool = dedupeTargets([...input.latestAsk, ...input.namedPool])
    const matches = pool.filter((target) => targetMatchesRef(target, parsed.ref))
    if (matches.length === 1) return acknowledge(matches[0]!)
    if (matches.length > 1) return { action: "clarify", body: clarifyWhich(matches) }
    return {
      action: "clarify",
      body: `I couldn't match Ref ${parsed.ref} to an approved request.`,
    }
  }

  if (input.latestAsk.length === 1) return acknowledge(input.latestAsk[0]!)
  if (input.latestAsk.length > 1) {
    return { action: "clarify", body: clarifyWhich(input.latestAsk) }
  }
  return { action: "ignore" }
}

function dedupeTargets(targets: RepeatedApprovalTarget[]): RepeatedApprovalTarget[] {
  const seen = new Set<string>()
  const out: RepeatedApprovalTarget[] = []
  for (const target of targets) {
    if (seen.has(target.ticketId)) continue
    seen.add(target.ticketId)
    out.push(target)
  }
  return out
}
