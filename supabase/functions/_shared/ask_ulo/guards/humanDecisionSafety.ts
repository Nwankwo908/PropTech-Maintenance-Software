/**
 * Decisions that must stay with a human — Ulo explains rules, never picks the outcome.
 * Complements fairHousingSafety (approve/deny) and actionBoundary (auto-execute).
 */

export type HumanDecisionFlagId =
  | "disability_accommodation_decision"
  | "eviction_strategy_decision"
  | "domestic_violence_response"
  | "retaliation_response"

export type HumanDecisionFlag = {
  id: HumanDecisionFlagId
  label: string
}

export type HumanDecisionSafety = {
  refuseDecision: boolean
  flags: HumanDecisionFlag[]
}

const DECISION_CUE_RE =
  /\b((?:should|shall|can|could|would)\s+i\s+(?:just\s+)?(?:grant|deny|approve|reject|allow|refuse|evict|proceed)|(?:please\s+)?(?:grant|deny|approve|reject)\s+(?:this|the|that)|(?:make|give)\s+(?:me\s+)?(?:a\s+)?(?:decision|recommendation)|(?:is\s+it\s+(?:ok|okay|lawful)\s+to)\s+(?:grant|deny|evict|refuse)|(?:tell\s+me\s+(?:to|whether\s+to))\s+(?:grant|deny|evict|approve))\b/i

const ACCOMMODATION_RE =
  /\b(reasonable\s*accommodat(?:ion|e)|reasonable\s*modificat(?:ion|e)|service\s*animal|emotional\s+support\s*animal|esa\b|disability\s+(?:request|accommodation)|ada\s+request)\b/i

const EVICTION_STRATEGY_RE =
  /\b((?:should|shall|can)\s+i\s+evict|evict\s+(?:them|him|her|this\s+tenant)|(?:best|winning)\s+(?:legal\s+)?strategy\s+(?:to\s+)?evict|how\s+(?:do\s+i|to)\s+win\s+(?:an?\s+)?(?:eviction|unlawful\s+detainer)|what\s+legal\s+strategy)\b/i

const DV_RESPONSE_RE =
  /\b((?:should|shall|can)\s+i\s+(?:evict|terminate|remove).{0,40}(?:domestic\s*violence|dv\b|vawa|protection\s+order)|(?:deny|refuse).{0,40}(?:domestic\s*violence|vawa)|how\s+(?:do\s+i|to)\s+(?:handle|respond\s+to)\s+(?:a\s+)?(?:dv|domestic\s*violence)\b)\b/i

const RETALIATION_RESPONSE_RE =
  /\b((?:should|shall|can)\s+i\s+(?:evict|raise\s+rent|terminate).{0,50}(?:complain|complaint|code\s+enforcement|health\s+department)|(?:punish|retaliate\s+against)\s+(?:the\s+)?tenant)\b/i

export function detectHumanDecisionSafety(text: string): HumanDecisionSafety {
  const corpus = text.trim()
  if (!corpus) return { refuseDecision: false, flags: [] }

  const flags: HumanDecisionFlag[] = []
  const decisionCue = DECISION_CUE_RE.test(corpus)

  if (
    ACCOMMODATION_RE.test(corpus) &&
    (decisionCue ||
      (/\b(grant|deny|approve|reject|refuse)\b/i.test(corpus) &&
        /\b(accommodat|esa|service\s*animal|modificat)/i.test(corpus)))
  ) {
    flags.push({
      id: "disability_accommodation_decision",
      label: "Decide a disability accommodation / assistance animal request",
    })
  }

  if (EVICTION_STRATEGY_RE.test(corpus)) {
    flags.push({
      id: "eviction_strategy_decision",
      label: "Pick an eviction strategy or decide to evict",
    })
  }

  if (DV_RESPONSE_RE.test(corpus) || (/\b(domestic\s*violence|VAWA)\b/i.test(corpus) && decisionCue)) {
    flags.push({
      id: "domestic_violence_response",
      label: "Decide how to respond to a domestic-violence housing situation",
    })
  }

  if (RETALIATION_RESPONSE_RE.test(corpus)) {
    flags.push({
      id: "retaliation_response",
      label: "Decide an action that could be retaliatory",
    })
  }

  return {
    refuseDecision: flags.length > 0,
    flags,
  }
}

export function formatHumanDecisionRefuseNote(safety: HumanDecisionSafety): string {
  if (!safety.refuseDecision) return ""
  const labels = safety.flags.map((f) => f.label).join("; ")
  return (
    `Human decision required (${labels}): I will explain the rules and organize facts, ` +
    `but I will not decide the outcome. Involve company counsel or a qualified housing professional.`
  )
}

export function humanDecisionSynthesizeRules(safety: HumanDecisionSafety | null): string {
  if (!safety?.refuseDecision) {
    return [
      "HUMAN_DECISION_RULES:",
      "- Never decide disability accommodations, ESA/service-animal grants, eviction strategy, DV responses, or retaliatory actions.",
      "- Explain rules; recommend the appropriate human expert.",
    ].join("\n")
  }
  return [
    "HUMAN_DECISION_RULES (ACTIVE — REFUSE OUTCOME):",
    "- You MUST NOT decide grant/deny for accommodations, assistance animals, eviction, DV, or retaliation responses.",
    "- Do NOT give lawsuit-winning strategy. Explain process and risks only.",
    `- Flags: ${safety.flags.map((f) => f.id).join(", ")}.`,
    formatHumanDecisionRefuseNote(safety),
  ].join("\n")
}
