/**
 * Back-compat exports for executive briefing / factual detection.
 * Source of truth: reasoningMode.ts
 */

export {
  isExecutiveBriefingQuestion,
  isNarrowFactualOpsQuestion,
  isComparisonRankingQuestion,
  isDiagnosisQuestion,
  isRecommendationQuestion,
  classifyAskUloReasoningMode,
  requiresEntityLevelComparison,
  shouldFetchPortfolioBriefing,
  type AskUloReasoningMode,
  type AskUloReasoningResult,
} from "./reasoningMode.ts"
