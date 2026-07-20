/**
 * Reasoning mode for Ask Ulo — decides *how* to answer before retrieval.
 * Prevents comparison/ranking/diagnosis/recommendation from collapsing into
 * the generic “General” template (portfolio ticket totals + filler).
 */

import {
  isFirstActionPriorityQuestion,
  isStrategicBriefingQuestion,
} from "./reasoningFirst.ts"
import { requiresInvestigation } from "./investigationDefinition.ts"

export type AskUloReasoningMode =
  | "factual"
  | "comparison_ranking"
  | "diagnosis"
  | "recommendation"
  | "executive_briefing"

export type AskUloReasoningResult = {
  mode: AskUloReasoningMode
  confidence: "high" | "medium" | "low"
  /** Internal only — never shown to the landlord. */
  reason: string
}

/**
 * Portfolio briefing packet is opt-in only.
 * Unmatched / generic_ops questions must never fall through to Health score dumps.
 */
export function shouldFetchPortfolioBriefing(input: {
  intent: string
  reasoningMode: AskUloReasoningMode | string
  playbookId: string
}): boolean {
  return (
    input.intent === "executive_briefing" ||
    input.intent === "property_health" ||
    input.reasoningMode === "executive_briefing" ||
    input.playbookId === "executive_briefing"
  )
}

const NARROW_FACTUAL_RE =
  /\b(how\s+many|what(?:'s|\s+is)\s+the\s+(?:number|count)|count\s+of|number\s+of)\b.+\b(open|critical|escalated|overdue|aging)?\s*(work\s*orders?|tickets?|requests?|workflows?|units?|vacancies|occupancy)\b|\b(when\s+does|when\s+is|what\s+is\s+the\s+status|is\s+(?:the|my)\s+.+\s+(?:still\s+)?open|what\s+is\s+my\s+vendor\s+response\s+rate|what(?:'s|\s+is)\s+(?:my\s+)?(?:health\s+)?score)\b/i

const EXECUTIVE_BRIEFING_RE =
  /\b((?:how\s+)?healthy\s+is\s+(?:my\s+)?portfolio|portfolio\s+(?:health|status|overview|checkup|check[- ]?in)|catch\s+me\s+up|what\s+did\s+i\s+miss|how\s+are\s+things(?:\s+going)?|anything\s+i\s+should\s+(?:be\s+)?worried\s+about|is\s+there\s+anything\s+i\s+should\s+(?:be\s+)?worried|what(?:'s|\s+is)\s+going\s+on(?:\s+with\s+(?:my\s+)?(?:portfolio|properties|buildings))?|give\s+me\s+(?:a\s+)?(?:briefing|rundown|status\s+update|ops\s+update)|executive\s+brief(?:ing)?|ops\s+(?:briefing|summary)|where\s+do\s+(?:things|i)\s+stand|morning\s+(?:brief|briefing|update)|end[- ]of[- ]day\s+(?:brief|update)|summarize\s+(?:my\s+)?(?:entire\s+)?portfolio|today'?s\s+briefing|regional\s+property\s+manager|pretend\s+you(?:'|’)?re\s+my)\b/i

/** which / first / worst / compare / rank / priority — entity-level comparison */
const COMPARISON_RANKING_RE =
  /\b(which\s+(?:propert(?:y|ies)|buildings?|units?|vendors?|residents?|issues?|workflows?|one)|which\s+(?:of\s+(?:my\s+)?(?:properties|buildings|units)|one)|(?:needs?|deserve[sd]?)\s+(?:my\s+)?attention\s+first|attention\s+first|perform(?:ing|s)?\s+the\s+worst|worst\s+(?:propert|building|perform)|best\s+(?:propert|building|perform)|rank(?:ing|ed)?|compar(?:e|ison)|highest|lowest|most\s+(?:urgent|critical|at[- ]risk|problematic|maintenance)|least\s+(?:healthy|perform)|prioriti[sz]e\s+(?:which|among|the\s+(?:propert|building|unit|vendor))|top\s+priority|needs?\s+(?:the\s+)?most\s+attention|generate(?:s|d)?\s+the\s+most)\b/i

/** Market comps must not be treated as property-ops ranking. */
const MARKET_COMPARE_EXCLUDE_RE =
  /\b(comparable\s*rentals?|nearby\s+rentals?|comp\s+set|compare\s+.+\s+to\s+nearby|market\s*(?:rent|analysis|comps?))\b/i

const DIAGNOSIS_RE =
  /\b(why\b|what\s+caused|what\s+is\s+driving|what(?:'s|\s+is)\s+wrong|what\s+changed|what\s+is\s+becoming\s+a\s+problem|is\s+anything\s+becoming\s+a\s+problem|root\s+cause|what(?:'s|\s+is)\s+behind)\b/i

const RECOMMENDATION_RE =
  /\b(what\s+should\s+i\s+(?:do|focus\s+on|prioriti[sz]e)|what\s+needs\s+(?:my\s+)?attention|what\s+should\s+happen\s+first|what\s+would\s+you\s+(?:recommend|do(?:\s+first)?)|what\s+is\s+my\s+biggest\s+risk|biggest\s+risk|where\s+am\s+i\s+losing\s+money|losing\s+money|recommend(?:ed)?\s+(?:next\s+)?steps?|what\s+to\s+focus\s+on|if\s+you\s+owned|where\s+(?:should|would)\s+i\s+start|smartest\s+(?:decision|move|action)|best\s+(?:decision|move|action)\s+(?:i\s+can\s+make|today|right\s+now|now)|decision\s+i\s+can\s+make\s+today)\b/i

export function isComparisonRankingQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (MARKET_COMPARE_EXCLUDE_RE.test(q)) return false
  return COMPARISON_RANKING_RE.test(q)
}

export function isDiagnosisQuestion(question: string): boolean {
  return DIAGNOSIS_RE.test(question.trim())
}

export function isRecommendationQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (isComparisonRankingQuestion(q)) return false
  // First-action / "if you owned" beats strategic briefing.
  if (isFirstActionPriorityQuestion(q)) return true
  if (isStrategicBriefingQuestion(q)) return false
  return RECOMMENDATION_RE.test(q)
}

export function isExecutiveBriefingQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (isComparisonRankingQuestion(q)) return false
  if (isStrategicBriefingQuestion(q)) return true
  if (isRecommendationQuestion(q)) return false
  if (isDiagnosisQuestion(q)) return false
  if (NARROW_FACTUAL_RE.test(q) && !EXECUTIVE_BRIEFING_RE.test(q)) return false
  return EXECUTIVE_BRIEFING_RE.test(q)
}

export function isNarrowFactualOpsQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (requiresInvestigation(q)) return false
  if (isComparisonRankingQuestion(q)) return false
  if (isExecutiveBriefingQuestion(q)) return false
  if (isRecommendationQuestion(q)) return false
  if (isDiagnosisQuestion(q)) return false
  return NARROW_FACTUAL_RE.test(q)
}

/**
 * Semantic-ish reasoning mode from the latest user question.
 * Order: ranking → factual → diagnosis → strategic briefing → recommendation → executive → default.
 */
export function classifyAskUloReasoningMode(question: string): AskUloReasoningResult {
  const q = question.trim()
  if (!q) {
    return { mode: "factual", confidence: "low", reason: "empty" }
  }

  // Ranking must win over "needs attention" / briefing language.
  if (isComparisonRankingQuestion(q)) {
    return {
      mode: "comparison_ranking",
      confidence: "high",
      reason: "comparison_or_ranking_language",
    }
  }

  if (
    NARROW_FACTUAL_RE.test(q) &&
    !EXECUTIVE_BRIEFING_RE.test(q) &&
    !isStrategicBriefingQuestion(q) &&
    !requiresInvestigation(q) &&
    !RECOMMENDATION_RE.test(q) &&
    !DIAGNOSIS_RE.test(q)
  ) {
    return { mode: "factual", confidence: "high", reason: "narrow_count_or_status" }
  }

  // Definition-of-investigation triggers (Why / Which / What should / …)
  // never collapse to a single dashboard metric.
  if (requiresInvestigation(q) && !isComparisonRankingQuestion(q)) {
    if (isDiagnosisQuestion(q) || /^\s*why\b/i.test(q)) {
      return { mode: "diagnosis", confidence: "high", reason: "investigation_why" }
    }
    if (isRecommendationQuestion(q) || isFirstActionPriorityQuestion(q)) {
      return {
        mode: "recommendation",
        confidence: "high",
        reason: "investigation_recommend",
      }
    }
    if (isStrategicBriefingQuestion(q) || /\bwhat\s+am\s+i\s+missing|how\s+can\s+i\s+improve\b/i.test(q)) {
      return {
        mode: "executive_briefing",
        confidence: "high",
        reason: "investigation_strategic",
      }
    }
  }

  if (isDiagnosisQuestion(q)) {
    return { mode: "diagnosis", confidence: "high", reason: "why_or_cause_language" }
  }

  // "What would you do first?" / "If you owned my portfolio…" → ranked first action.
  if (isRecommendationQuestion(q)) {
    return {
      mode: "recommendation",
      confidence: "high",
      reason: isFirstActionPriorityQuestion(q)
        ? "first_action_priority"
        : "focus_risk_or_recommend_language",
    }
  }

  // Strategic forward-looking questions → executive briefing (multi-domain).
  if (isStrategicBriefingQuestion(q)) {
    return {
      mode: "executive_briefing",
      confidence: "high",
      reason: "strategic_worry_prioritize_or_horizon",
    }
  }

  if (isExecutiveBriefingQuestion(q)) {
    return {
      mode: "executive_briefing",
      confidence: "high",
      reason: "portfolio_state_language",
    }
  }

  return { mode: "factual", confidence: "low", reason: "default" }
}

/** True when the answer must compare entities — never answer with a portfolio-only total. */
export function requiresEntityLevelComparison(mode: AskUloReasoningMode): boolean {
  return (
    mode === "comparison_ranking" ||
    mode === "diagnosis" ||
    mode === "recommendation" ||
    mode === "executive_briefing"
  )
}
