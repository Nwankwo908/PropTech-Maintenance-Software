/**
 * Faithfulness / groundedness — does every claim come from evidence?
 * Independent post-answer check (fail-closed for unanchored hard legal claims).
 */

import type { AskUloCitation } from "../retrieval/searchInternalData.ts"

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

export type AnswerFaithfulnessCheck = {
  pass: boolean
  failClosed: boolean
  block: "refuse" | null
  summary: string
  reasons: string[]
  faithfulness: FaithfulnessResult
}

const MONEY_OR_DEADLINE_RE =
  /\$\s?\d[\d,]*(?:\.\d+)?|\b\d+\s+days?\b|\bwithin\s+\d+\b|\bat\s+least\s+\d+\b/gi

/**
 * Post-answer faithfulness: claims must be anchored in citations or evidence text.
 * Fail-closed for legal hard claims without sources.
 */
export function checkAnswerFaithfulness(input: {
  intent: string
  answer: string
  citations: AskUloCitation[]
  /** Organized evidence / packet corpus for overlap checks. */
  evidenceText?: string
  hasEvidence?: boolean
  gateStatus?: "ok" | "clarify" | "refuse" | null
}): AnswerFaithfulnessCheck {
  const faithfulness = assessFaithfulness({
    intent: input.intent,
    answer: input.answer,
    citations: input.citations,
    gateStatus: input.gateStatus,
    knownUnknown: input.gateStatus === "clarify" || input.gateStatus === "refuse",
  })
  const reasons: string[] = [...faithfulness.detail.notes]
  const evidenceNorm = normalize(input.evidenceText ?? "")

  // Concrete figures in the answer should appear in evidence when we have a corpus.
  if (evidenceNorm.length > 40 && input.hasEvidence) {
    const tokens = input.answer.match(MONEY_OR_DEADLINE_RE) ?? []
    const unsupported: string[] = []
    for (const tok of tokens) {
      if (figureAnchoredInEvidence(tok, evidenceNorm, input.answer)) continue
      unsupported.push(tok.trim())
    }
    if (unsupported.length >= 2) {
      reasons.push(`unsupported_figures:${unsupported.slice(0, 3).join(",")}`)
      faithfulness.detail.unsupportedHardClaims = true
    }
  }

  // Invented certainty with no evidence at all
  if (
    !input.hasEvidence &&
    input.citations.length === 0 &&
    /\b(definitely|certainly|always|never|must|required)\b/i.test(input.answer) &&
    faithfulness.detail.hardClaimCount > 0
  ) {
    reasons.push("confident_claims_without_evidence")
    faithfulness.detail.unsupportedHardClaims = true
  }

  const legalFailClosed =
    input.intent === "legal" &&
    faithfulness.detail.unsupportedHardClaims &&
    input.gateStatus !== "clarify" &&
    input.gateStatus !== "refuse"

  const opsFailClosed =
    input.intent !== "legal" &&
    reasons.some((r) => r.startsWith("unsupported_figures:")) &&
    faithfulness.detail.hardClaimCount > 0

  const failClosed = legalFailClosed || opsFailClosed
  const pass =
    !failClosed &&
    (faithfulness.score == null || faithfulness.score >= 0.35) &&
    !reasons.includes("confident_claims_without_evidence")

  return {
    pass,
    failClosed,
    block: failClosed ? "refuse" : null,
    summary: failClosed
      ? "Answer includes hard claims that are not backed by retrieved evidence."
      : pass
        ? "Claims appear grounded in evidence or are appropriately soft."
        : "Faithfulness is weak — treat figures cautiously.",
    reasons,
    faithfulness,
  }
}

function answerHasNearbyCitation(answer: string, token: string): boolean {
  const idx = answer.toLowerCase().indexOf(token.toLowerCase())
  if (idx < 0) return false
  const window = answer.slice(Math.max(0, idx - 80), idx + token.length + 80)
  return /source\s*:|ORS\s*\d|\[\d+\]|\.gov/i.test(window)
}

/** True when a money/deadline token is reflected in evidence (including 14d ↔ 14 days). */
function figureAnchoredInEvidence(
  tok: string,
  evidenceNorm: string,
  answer: string,
): boolean {
  const n = normalize(tok)
  if (n.length >= 2 && evidenceNorm.includes(n)) return true
  if (answerHasNearbyCitation(answer, tok)) return true
  const digits = tok.replace(/[^\d]/g, "")
  if (digits.length >= 3) {
    const compact = evidenceNorm.replace(/\s+/g, "")
    if (compact.includes(digits)) return true
  }
  const dayM = /^(\d+)\s*days?$/i.exec(tok.trim())
  if (dayM) {
    const d = dayM[1]
    if (
      evidenceNorm.includes(`${d}d`) ||
      evidenceNorm.includes(`${d} day`) ||
      evidenceNorm.includes(`${d} days`)
    ) {
      return true
    }
  }
  return false
}
