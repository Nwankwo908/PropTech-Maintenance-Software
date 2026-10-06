/**
 * When a draft fails post-answer faithfulness for unsupported/invented figures,
 * rebuild the answer from real tool packets (never show verifier diagnostics).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { formatCatchAllWorkOrdersMarkdown } from "../retrieval/catchAllFallback.ts"
import type { SearchWorkOrdersResult } from "../tools/maintenance/searchWorkOrders.ts"
import { searchWorkOrders } from "../tools/maintenance/searchWorkOrders.ts"
import {
  isCriticalMaintenanceByPropertyQuestion,
  isOverdueWorkOrdersQuestion,
  isPortfolioWorkPrioritizationQuestion,
} from "../tools/maintenance/workOrderPresentation.ts"
import {
  formatCriticalMaintenanceByPropertyMarkdown,
  propertyRankingLookup,
  type PropertyRankingResult,
  type RankedProperty,
} from "../tools/properties/propertyRankingLookup.ts"
import { polishAskUloProse } from "../synthesis/formatAnswer.ts"

export function isUnsupportedFiguresRejection(reasons: string[]): boolean {
  return reasons.some(
    (r) =>
      r.startsWith("unsupported_figures:") ||
      r === "confident_claims_without_evidence",
  )
}

export type GroundedRetryInput = {
  question: string
  supabase?: SupabaseClient | null
  landlordId?: string | null
  gatedPropertyRanking?: {
    available?: boolean
    canRank?: boolean
    markdown?: string | null
    ranked?: RankedProperty[] | null
    portfolioOpenWorkOrders?: number
  } | null
  catchAllWorkOrders?: { found?: boolean; markdown?: string | null } | null
  searchWorkOrdersHit?: {
    result?: SearchWorkOrdersResult | null
  } | null
}

export type GroundedRetryResult = {
  markdown: string | null
  source: string | null
}

function landlordFacingRankingMarkdown(
  ranking: {
    canRank?: boolean
    ranked?: RankedProperty[] | null
    markdown?: string | null
  } | null | undefined,
  question: string,
): string | null {
  if (isCriticalMaintenanceByPropertyQuestion(question) && ranking?.ranked?.length) {
    const criticalMd = formatCriticalMaintenanceByPropertyMarkdown(ranking.ranked)
    if (criticalMd.trim()) return polishAskUloProse(criticalMd)
  }

  if (!ranking?.canRank || !ranking.ranked?.length) return null

  // Strip internal packet scaffolding — keep landlord-facing sections only.
  const raw = (ranking.markdown ?? "").trim()
  if (!raw) return null
  const cleaned = raw
    .replace(/^##\s*Property ranking packet\s*/i, "")
    .replace(/\n###\s*All ranked properties \(internal\)[\s\S]*$/i, "")
    .trim()
  if (!cleaned || /I can't reliably rank/i.test(cleaned)) return null
  return polishAskUloProse(cleaned)
}

function markdownFromSearchHit(
  hit: GroundedRetryInput["searchWorkOrdersHit"],
  prioritization: boolean,
): string | null {
  const result = hit?.result
  if (!result?.available || !result.workOrders?.length) return null
  const md = formatCatchAllWorkOrdersMarkdown(result.workOrders, {
    prioritization,
  })
  return md.trim() ? polishAskUloProse(md) : null
}

/**
 * Prefer already-fetched grounded packets; optionally re-query when missing.
 */
export async function attemptGroundedRetryAfterFiguresRejection(
  input: GroundedRetryInput,
): Promise<GroundedRetryResult> {
  const q = input.question.trim()
  const prioritization =
    isPortfolioWorkPrioritizationQuestion(q) ||
    isOverdueWorkOrdersQuestion(q) ||
    isCriticalMaintenanceByPropertyQuestion(q)

  const fromRanking = landlordFacingRankingMarkdown(
    input.gatedPropertyRanking,
    q,
  )
  if (fromRanking) {
    return { markdown: fromRanking, source: "property_ranking" }
  }

  const fromCatchAll = input.catchAllWorkOrders?.found
    ? (input.catchAllWorkOrders.markdown ?? "").trim()
    : ""
  if (fromCatchAll && !/unsupported_figures|non_legal_intent/i.test(fromCatchAll)) {
    return {
      markdown: polishAskUloProse(fromCatchAll),
      source: "catchall_search_work_orders",
    }
  }

  const fromSearch = markdownFromSearchHit(input.searchWorkOrdersHit, prioritization)
  if (fromSearch) {
    return { markdown: fromSearch, source: "search_work_orders" }
  }

  // Live re-query when packets were empty / incomplete.
  const landlordId = input.landlordId?.trim()
  const supabase = input.supabase
  if (supabase && landlordId) {
    if (
      isCriticalMaintenanceByPropertyQuestion(q) ||
      /\bwhich\s+propert/i.test(q)
    ) {
      try {
        const ranking = await propertyRankingLookup(supabase, { landlordId })
        const md = landlordFacingRankingMarkdown(ranking, q)
        if (md) return { markdown: md, source: "property_ranking_refetch" }
      } catch {
        // fall through
      }
    }

    try {
      const search = await searchWorkOrders(supabase, {
        organizationId: landlordId,
        sortBy: "priority",
        sortOrder: "desc",
        limit: 24,
      })
      const md = markdownFromSearchHit({ result: search }, true)
      if (md) return { markdown: md, source: "search_work_orders_refetch" }
    } catch {
      // fall through
    }
  }

  return { markdown: null, source: null }
}

/** Plain-language clarify when grounded retry has nothing to show. */
export function formatUnsupportedFiguresClarifyMarkdown(question?: string): string {
  const q = (question ?? "").trim()
  const wantsCost = /\b(cost|costs|estimate|estimated|\$|spend|budget|how much|dollar)\b/i
    .test(q)
  const wantsTimeline =
    /\b(timeline|how long|when will|deadline|days?\s+to|eta)\b/i.test(q)

  const missing = wantsCost
    ? "I don't have cost data recorded for these tickets yet."
    : wantsTimeline
      ? "I don't have reliable timeline figures on file for this yet."
      : isCriticalMaintenanceByPropertyQuestion(q)
        ? "I couldn't load property-level critical maintenance detail to rank buildings yet."
        : "I don't have verified numbers on file for the figures that came up in that draft."

  return [
    "I held back a draft answer because some of the numbers weren't backed by your live records.",
    "",
    "### What's missing",
    missing,
    "",
    "### What happens next",
    wantsCost || wantsTimeline
      ? "Once estimates or dates are on the tickets, ask again and I'll use those recorded figures."
      : "Ask me about open critical tickets, overdue work, or a named property — I'll answer from the live list without inventing totals.",
  ].join("\n")
}
