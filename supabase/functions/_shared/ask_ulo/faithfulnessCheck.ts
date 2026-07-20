/**
 * Lightweight faithfulness / groundedness check for Ask Ulo answers.
 * Rule-based: hard legal claims should be backed by retrieved citations.
 * Not a substitute for counsel review — used for continuous eval trends.
 */

import type { AskUloCitation } from "./opsGraphLookup.ts"

export type FaithfulnessDetail = {
  hardClaimCount: number
  citationMentionCount: number
  matchedSourceCount: number
  retrievedSourceCount: number
  unsupportedHardClaims: boolean
  notes: string[]
}

export type FaithfulnessResult = {
  /** 0..1 when scored; null when N/A (clarify/refuse/non-legal). */
  score: number | null
  detail: FaithfulnessDetail
}

const HARD_CLAIM_RE =
  /\b(must|shall|required|illegal|unlawful|prohibited|may not|cannot|can't|at least \d+|within \d+\s+days?|not more than|cap(ped)? at|fine of|penalty)\b/i

/** Citation markers like [1], (ORS 90.300), or Source: … */
const CITATION_MARK_RE =
  /\[\d+\]|\((?:ORS|USC|CFR|ORS\.|Title)\s*[\d.]+\)|\bsource(?:s)?\s*:/gi

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function sourceKeys(citations: AskUloCitation[]): string[] {
  const keys: string[] = []
  for (const c of citations) {
    if (c.title?.trim()) keys.push(normalize(c.title))
    if (c.url?.trim()) keys.push(normalize(c.url))
    const meta = c as AskUloCitation & { citation?: string | null }
    if (typeof meta.citation === "string" && meta.citation.trim()) {
      keys.push(normalize(meta.citation))
    }
  }
  return keys.filter(Boolean)
}

function countHardClaimSentences(answer: string): number {
  const parts = answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20)
  let n = 0
  for (const p of parts) {
    if (HARD_CLAIM_RE.test(p)) n += 1
  }
  return n
}

function countMatchedSources(answer: string, citations: AskUloCitation[]): number {
  const ans = normalize(answer)
  if (!ans) return 0
  let matched = 0
  for (const key of sourceKeys(citations)) {
    if (key.length < 6) continue
    // Match a distinctive substring (first ~40 chars of normalized key).
    const needle = key.slice(0, Math.min(40, key.length))
    if (needle.length >= 6 && ans.includes(needle)) matched += 1
  }
  return matched
}

/**
 * Score how well the answer appears grounded in retrieved citations.
 * - null when the answer is an intentional non-answer (clarify/refuse) or non-legal
 * - high when hard claims are few or citations are present and matched
 * - low when hard claims appear without citation support
 */
export function assessFaithfulness(input: {
  intent: string
  answer: string
  citations: AskUloCitation[]
  gateStatus?: "ok" | "clarify" | "refuse" | null
  knownUnknown?: boolean
}): FaithfulnessResult {
  const notes: string[] = []
  const hardClaimCount = countHardClaimSentences(input.answer)
  const citationMentionCount = (input.answer.match(CITATION_MARK_RE) ?? []).length
  const retrievedSourceCount = input.citations.length
  const matchedSourceCount = countMatchedSources(input.answer, input.citations)

  const detail: FaithfulnessDetail = {
    hardClaimCount,
    citationMentionCount,
    matchedSourceCount,
    retrievedSourceCount,
    unsupportedHardClaims: false,
    notes,
  }

  if (input.knownUnknown || input.gateStatus === "clarify" || input.gateStatus === "refuse") {
    notes.push("known_unknown_or_gate_block")
    return { score: null, detail }
  }

  if (input.intent !== "legal") {
    notes.push("non_legal_intent")
    // Soft score: presence of any retrieved context is enough for ops/market.
    if (retrievedSourceCount === 0 && hardClaimCount === 0) {
      return { score: 1, detail }
    }
    const soft =
      retrievedSourceCount > 0
        ? Math.min(1, 0.6 + matchedSourceCount * 0.1 + citationMentionCount * 0.05)
        : hardClaimCount > 2
          ? 0.4
          : 0.75
    return { score: Math.round(soft * 1000) / 1000, detail }
  }

  if (retrievedSourceCount === 0) {
    detail.unsupportedHardClaims = hardClaimCount > 0
    notes.push(hardClaimCount > 0 ? "hard_claims_without_sources" : "no_sources_no_hard_claims")
    return {
      score: hardClaimCount > 0 ? 0.15 : 0.7,
      detail,
    }
  }

  // Has sources: reward citation mentions + title/url overlap; penalize bare hard claims.
  let score = 0.45
  score += Math.min(0.25, retrievedSourceCount * 0.05)
  score += Math.min(0.2, matchedSourceCount * 0.08)
  score += Math.min(0.15, citationMentionCount * 0.05)

  if (hardClaimCount > 0 && matchedSourceCount === 0 && citationMentionCount === 0) {
    detail.unsupportedHardClaims = true
    score -= Math.min(0.4, hardClaimCount * 0.12)
    notes.push("hard_claims_unanchored")
  } else if (hardClaimCount > 0) {
    notes.push("hard_claims_with_source_signal")
  } else {
    notes.push("descriptive_answer")
  }

  score = Math.max(0, Math.min(1, score))
  return { score: Math.round(score * 1000) / 1000, detail }
}
