/**
 * Clarify-menu intake seeding — never treat "a repair" / menu echoes as the ticket.
 * Prefer the newest recent inbound that reports a problem, classifiable or not.
 */
import { hasProblemSignal } from "../../../../shared/maintenance/deterministicRules.ts"
import { inferIssueTypeFromText } from "./residentIntakeTypes.ts"
import { matchShortReplyToken } from "./shortReplyTokens.ts"

/** Menu echo from “What do you need — a repair, rent, lease…?” */
const CLARIFY_MENU_REPAIR_ECHO =
  /^(a\s+)?(repair|maintenance|fix)([.!?…]*|\s+please)?$/i

/** Vague need-a-repair phrasing with no symptom object. */
const BARE_REPAIR_NEED =
  /\b((i |we )?(need|want|requesting) (a |some )?(repair|maintenance|fix)|need (it |something )?(fixed|repaired)|something (needs?|is) (a )?fix|please (help|fix|send).{0,40}\brepair)\b/i

export type ClarifyMenuSelection = "repair" | "rent_or_lease" | "something_else"

const MENU_REPAIR_TOKENS = [
  "A REPAIR",
  "REPAIR",
  "MAINTENANCE",
  "FIX",
  "A FIX",
] as const

const MENU_RENT_LEASE_TOKENS = [
  "SOMETHING ABOUT RENT OR YOUR LEASE",
  "SOMETHING ABOUT RENT OR MY LEASE",
  "RENT OR YOUR LEASE",
  "RENT OR MY LEASE",
  "RENT OR LEASE",
  "ABOUT RENT OR LEASE",
  "RENT",
  "LEASE",
] as const

const MENU_SOMETHING_ELSE_TOKENS = [
  "SOMETHING ELSE",
  "SOMETHING DIFFERENT",
  "OTHER",
  "NONE OF THOSE",
] as const

export function looksLikeClarifyMenuRepairEcho(body: string): boolean {
  const t = body.trim()
  if (CLARIFY_MENU_REPAIR_ECHO.test(t)) return true
  return matchShortReplyToken(t, MENU_REPAIR_TOKENS) != null
}

/**
 * When Ulo just showed the clarify menu, treat a verbatim / near-verbatim
 * option echo as a valid selection (typo-tolerant via matchShortReplyToken).
 */
export function parseClarifyMenuSelection(body: string): ClarifyMenuSelection | null {
  const t = body.trim()
  if (!t) return null
  if (looksLikeClarifyMenuRepairEcho(t)) return "repair"
  if (matchShortReplyToken(t, MENU_SOMETHING_ELSE_TOKENS)) return "something_else"
  if (matchShortReplyToken(t, MENU_RENT_LEASE_TOKENS)) return "rent_or_lease"
  // Longer near-verbatim rent/lease option line.
  const norm = t.toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim()
  if (
    /^(something about )?rent( or (your|my|the )?lease)?$/.test(norm) ||
    /^rent or (your|my|the )?lease$/.test(norm)
  ) {
    return "rent_or_lease"
  }
  if (/^something else$/.test(norm)) return "something_else"
  return null
}

export function isRecentClarifyMenuAsk(
  clarifyMenuShownAt: string | null | undefined,
  nowMs = Date.now(),
  windowMs = 24 * 60 * 60 * 1000,
): boolean {
  if (!clarifyMenuShownAt?.trim()) return false
  const shown = Date.parse(clarifyMenuShownAt)
  if (!Number.isFinite(shown)) return false
  return nowMs - shown <= windowMs
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
 * How far back seed recovery reads inbound texts. Older messages describe
 * business the resident already finished. Logged with every recovery so the
 * effect of the window is visible in production.
 */
export const SEED_LOOKBACK_MINUTES = 45

/** Why a seed was chosen, for the recovery log. */
export type IssueSeedResolution = {
  seed: string
  /** current = the text in hand; recovered = an earlier problem report. */
  source: "current" | "recovered"
  /** What plain "most recent inbound" would have picked. */
  mostRecentInbound: string | null
  /** True when this logic changed the outcome. */
  differsFromMostRecent: boolean
  /** Messages passed over before landing on the seed. */
  skipped: number
  /** Stopped early because the resident had cancelled that request. */
  stoppedAtCancel: boolean
  lookbackMinutes: number
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
  return resolveIssueSeed(currentBody, recentInboundBodies).seed
}

/** Same choice as above, with the reasoning attached so it can be logged. */
export function resolveIssueSeed(
  currentBody: string,
  recentInboundBodies: string[],
): IssueSeedResolution {
  const current = currentBody.trim()
  const mostRecent = recentInboundBodies
    .map((b) => b.trim())
    .find((b) => b && b.toLowerCase() !== current.toLowerCase()) ?? null

  const asCurrent = (): IssueSeedResolution => ({
    seed: current,
    source: "current",
    mostRecentInbound: mostRecent,
    differsFromMostRecent: false,
    skipped: 0,
    stoppedAtCancel: false,
    lookbackMinutes: SEED_LOOKBACK_MINUTES,
  })

  if (inferIssueTypeFromText(current)) return asCurrent()

  if (!looksLikeBareRepairRequest(current) && !isVagueTicketDescription(current)) {
    return asCurrent()
  }

  let skipped = 0
  for (const raw of recentInboundBodies) {
    const candidate = raw.trim()
    if (!candidate) continue
    if (CLOSED_REQUEST_MARKER.test(candidate)) {
      return { ...asCurrent(), skipped, stoppedAtCancel: true }
    }
    if (candidate.toLowerCase() === current.toLowerCase()) continue
    if (looksLikeBareRepairRequest(candidate)) {
      skipped++
      continue
    }
    if (inferIssueTypeFromText(candidate) || hasProblemSignal(candidate)) {
      return {
        seed: candidate,
        source: "recovered",
        mostRecentInbound: mostRecent,
        differsFromMostRecent: candidate.toLowerCase() !==
          (mostRecent ?? "").toLowerCase(),
        skipped,
        stoppedAtCancel: false,
        lookbackMinutes: SEED_LOOKBACK_MINUTES,
      }
    }
    skipped++
  }

  return { ...asCurrent(), skipped }
}
