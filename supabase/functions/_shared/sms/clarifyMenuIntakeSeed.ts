/**
 * Clarify-menu intake seeding — never treat "a repair" / menu echoes as the ticket.
 * Prefer the newest recent inbound that reports a problem, classifiable or not.
 */
import { hasProblemSignal } from "../../../../shared/maintenance/deterministicRules.ts"
import { inferIssueTypeFromText } from "./residentIntakeTypes.ts"

/** Menu echo from “What do you need — a repair, rent, lease…?” */
const CLARIFY_MENU_REPAIR_ECHO =
  /^(a\s+)?(repair|maintenance|fix)([.!?…]*|\s+please)?$/i

/** Vague need-a-repair phrasing with no symptom object. */
const BARE_REPAIR_NEED =
  /\b((i |we )?(need|want|requesting) (a |some )?(repair|maintenance|fix)|need (it |something )?(fixed|repaired)|something (needs?|is) (a )?fix|please (help|fix|send).{0,40}\brepair)\b/i

export function looksLikeClarifyMenuRepairEcho(body: string): boolean {
  return CLARIFY_MENU_REPAIR_ECHO.test(body.trim())
}

export function looksLikeBareRepairRequest(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (looksLikeClarifyMenuRepairEcho(t)) return true
  return BARE_REPAIR_NEED.test(t)
}

/** True when the text alone cannot seed a real maintenance ticket. */
export function isVagueTicketDescription(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (inferIssueTypeFromText(t)) return false
  if (looksLikeBareRepairRequest(t)) return true
  // Classifier sometimes sanitizes to "A repair is needed."
  if (/^a\s+repair(\s+is\s+needed)?[.!]?$/i.test(t)) return true
  return false
}

/**
 * Ends a look-back. Text before a cancel belongs to a request the resident
 * already dropped, so it must never be resurrected as the new ticket.
 */
const CLOSED_REQUEST_MARKER =
  /^(never\s*mind|nevermind|forget\s+it|cancel(\s+it|\s+that)?|it'?s\s+(fixed|resolved|fine|ok(ay)?)|i\s+fixed\s+it|all\s+set|no\s+longer\s+needed)[.!]?$/i

/**
 * When the resident answers the clarify menu with “a repair”, recover their
 * real problem report from recent inbound SMS, walking newest first.
 *
 * Takes the newest message that reports a problem — not the newest one the
 * rules happen to classify. Preferring a classifiable candidate let a stale
 * report win over a fresher description of the same issue.
 */
export function resolveIssueSeedFromRecentInbounds(
  currentBody: string,
  recentInboundBodies: string[],
): string {
  const current = currentBody.trim()
  if (inferIssueTypeFromText(current)) return current

  if (!looksLikeBareRepairRequest(current) && !isVagueTicketDescription(current)) {
    return current
  }

  for (const raw of recentInboundBodies) {
    const candidate = raw.trim()
    if (!candidate) continue
    if (CLOSED_REQUEST_MARKER.test(candidate)) break
    if (candidate.toLowerCase() === current.toLowerCase()) continue
    if (looksLikeBareRepairRequest(candidate)) continue
    if (inferIssueTypeFromText(candidate) || hasProblemSignal(candidate)) {
      return candidate
    }
  }

  return current
}
