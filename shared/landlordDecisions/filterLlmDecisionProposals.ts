/**
 * LLM output is a proposal. Anything that fails these checks stays unclear
 * and is never applied.
 */
import type { DecisionAction, DecisionCandidate, DecisionIntent } from "./parseDecisionReply.ts"

const ALLOWED: ReadonlySet<DecisionAction> = new Set([
  "yes",
  "options",
  "self",
  "snooze",
  "skip",
])

export type LlmDecisionProposal = {
  display_id: number
  action: string
  params?: { snooze_until?: string | null } | null
  confidence: number
}

export function filterLlmDecisionProposals(
  proposals: LlmDecisionProposal[],
  candidates: DecisionCandidate[],
): DecisionIntent[] {
  const byId = new Map(candidates.map((row) => [row.displayId, row]))
  const accepted: DecisionIntent[] = []
  for (const proposal of proposals) {
    if (!(proposal.confidence >= 0.8)) continue
    const candidate = byId.get(proposal.display_id)
    if (!candidate) continue
    const action = proposal.action.trim().toLowerCase() as DecisionAction
    if (!ALLOWED.has(action)) continue
    if (action === "skip" && candidate.ticketClass !== "proactive") continue
    const intent: DecisionIntent = {
      displayId: candidate.displayId,
      action,
    }
    if (action === "snooze") {
      const until = proposal.params?.snooze_until?.trim() ?? ""
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) continue
      intent.snoozeUntil = until
    }
    accepted.push(intent)
  }
  return accepted
}
