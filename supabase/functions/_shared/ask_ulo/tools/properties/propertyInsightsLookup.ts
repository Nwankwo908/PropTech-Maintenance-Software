/**
 * Property Insights lookup — shared portfolio intelligence (Overview + Ask Ulo).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "../../retrieval/searchInternalData.ts"
import {
  buildInsightMarkdown,
  buildRecommendationMarkdown,
  computePortfolioInsights,
  computePortfolioRecommendations,
  type PortfolioRecommendation,
  type PropertyInsightFinding,
  type PropertyInsightTag,
} from "../../../portfolioIntelligence/index.ts"
import { loadPortfolioIntelligenceInput } from "../../../portfolioIntelligence/loadSnapshot.ts"

export type { PropertyInsightTag, PropertyInsightFinding }

export type PropertyInsightsResult = {
  available: boolean
  found: boolean
  insights: PropertyInsightFinding[]
  recommendations: PortfolioRecommendation[]
  bullets: string[]
  citations: AskUloCitation[]
  /** Pattern cards — Overview / Tier-1 insights. */
  markdown: string
  /** Action signals — Ask Ulo "what to do" (not Property Insights cards). */
  recommendationMarkdown: string | null
  sufficientForMaintenanceRisk: boolean
}

function titleForTag(tag: PropertyInsightTag): string {
  switch (tag) {
    case "RECURRING ISSUES":
      return "Recurring Issues"
    case "RISK":
      return "Needs Attention"
    case "PREVENT FUTURE REPAIRS":
      return "Prevent Future Repairs"
    case "VENDOR RESPONSE":
      return "Vendor Response"
  }
}

export async function propertyInsightsLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; includeRecommendationActions?: boolean },
): Promise<PropertyInsightsResult> {
  const landlordId = input.landlordId.trim()
  const empty: PropertyInsightsResult = {
    available: false,
    found: false,
    insights: [],
    recommendations: [],
    bullets: [],
    citations: [],
    markdown: "",
    recommendationMarkdown: null,
    sufficientForMaintenanceRisk: false,
  }
  if (!landlordId) return empty

  let snapshot
  try {
    snapshot = await loadPortfolioIntelligenceInput(supabase, landlordId)
  } catch (err) {
    console.error("[ask_ulo/propertyInsightsLookup] load snapshot", err)
    return {
      ...empty,
      markdown: "Property Insights could not be loaded from live ops data.",
    }
  }

  const insights = computePortfolioInsights(snapshot)
  const recommendations = computePortfolioRecommendations(snapshot)
  const recommendationMarkdown = buildRecommendationMarkdown(recommendations)
  const recommendationActions = input.includeRecommendationActions
    ? recommendations.map((r) => r.message)
    : undefined

  const found = insights.length > 0
  const markdown = buildInsightMarkdown(insights, recommendationActions)
  const bullets = insights.map((i) => `${titleForTag(i.tag)}: ${i.text}`)
  const sufficientForMaintenanceRisk = insights.some(
    (i) =>
      i.tag === "RECURRING ISSUES" ||
      i.tag === "RISK" ||
      i.tag === "PREVENT FUTURE REPAIRS",
  )

  console.log(
    "ASK_ULO_TIER1_PROPERTY_INSIGHTS",
    JSON.stringify({
      landlordId,
      found,
      tags: insights.map((i) => i.tag),
      counts: insights.map((i) => ({ tag: i.tag, n: i.requestCount })),
    }),
  )

  return {
    available: true,
    found,
    insights,
    recommendations,
    bullets,
    citations: [
      {
        tool: "ops_graph",
        title: "Property Insights",
        citation:
          "maintenance_request_enriched + units (shared portfolio intelligence)",
        excerpt: found
          ? insights.map((i) => i.text).join(" · ")
          : "No recurring / preventive insights in the last 60 days",
      },
    ],
    markdown,
    recommendationMarkdown,
    sufficientForMaintenanceRisk,
  }
}
