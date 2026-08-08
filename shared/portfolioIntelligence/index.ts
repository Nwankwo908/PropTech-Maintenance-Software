import { computePortfolioInsights } from './computeInsights.ts'
import { computePortfolioRecommendations } from './computeRecommendations.ts'
import type {
  PortfolioIntelligenceInput,
  PortfolioIntelligenceResult,
} from './types.ts'

export function computePortfolioIntelligence(
  input: PortfolioIntelligenceInput,
): PortfolioIntelligenceResult {
  return {
    insights: computePortfolioInsights(input),
    recommendations: computePortfolioRecommendations(input),
  }
}

export { computePortfolioInsights } from './computeInsights.ts'
export { computePortfolioRecommendations } from './computeRecommendations.ts'
export * from './types.ts'
export * from './helpers.ts'
