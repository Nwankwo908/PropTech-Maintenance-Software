/**
 * Per-turn Ask Ulo context — request prep only (who / where / what request).
 * Intent, safety, and tool results live in later stages.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloAgentMode } from "../routing/selectMode.ts"
import { parseAskUloAgentMode } from "../routing/selectMode.ts"
import { extractBuildingFilter } from "../tools/properties/buildingFilter.ts"
import {
  resolvePortfolioJurisdiction,
  type PortfolioJurisdiction,
} from "../tools/properties/portfolioContext.ts"
import type {
  AskUloHistoryMessage,
  AskUloPermissions,
  AskUloResponse,
  AskUloRunInput,
} from "./types.ts"
import { getAskUloFeatureFlags, type AskUloFeatureFlags } from "./config.ts"

export type { AskUloPermissions } from "./types.ts"

export type AskUloPropertyScope = {
  /** Building name inferred from the question / recent turns, if any. */
  buildingFilter: string | null
  sampleBuildings: string[]
  buildingCount: number
}

export type AskUloContext = {
  supabase: SupabaseClient
  question: string
  landlordId: string
  userId: string | null
  history: AskUloHistoryMessage[]
  conversationId: string | null
  agentMode: AskUloAgentMode | null
  /** Wall-clock for the turn (date-aware phrasing). */
  now: Date
  startedAt: number
  priorUserTurns: string[]
  /** Recent turns joined for retrieval / building detection. */
  retrievalQuestion: string
  portfolioJurisdiction: PortfolioJurisdiction
  propertyScope: AskUloPropertyScope
  permissions: AskUloPermissions
  flags: AskUloFeatureFlags
}

export type AskUloTurnContext = Pick<
  AskUloContext,
  | "question"
  | "landlordId"
  | "userId"
  | "history"
  | "conversationId"
  | "agentMode"
  | "startedAt"
  | "priorUserTurns"
  | "retrievalQuestion"
  | "now"
>

/** Empty / portfolio-seeded jurisdiction for early safety responses. */
export function jurisdictionFromPortfolio(
  portfolio: PortfolioJurisdiction,
): AskUloResponse["jurisdiction"] {
  return {
    countryCode: "US",
    stateCode: portfolio.stateCode,
    countySlug: null,
    countyLabel: null,
    citySlug: portfolio.citySlug,
    cityLabel: portfolio.cityLabel,
    courtSystem: null,
    housingProgram: null,
    codeSet: null,
  }
}

export function buildAskUloTurnContext(input: AskUloRunInput): AskUloTurnContext {
  const now = new Date()
  const question = input.question.trim()
  const landlordId = input.landlordId.trim()
  const userId = input.userId?.trim() || null
  const agentMode = parseAskUloAgentMode(input.agentMode)
  const history = (input.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)
  const priorUserTurns = history.filter((m) => m.role === "user").map((m) => m.content)
  const retrievalQuestion =
    history.length > 0
      ? [...priorUserTurns, question].slice(-3).join("\n")
      : question
  return {
    question,
    landlordId,
    userId,
    history,
    conversationId: input.conversationId ?? null,
    agentMode,
    now,
    startedAt: now.getTime(),
    priorUserTurns,
    retrievalQuestion,
  }
}

function defaultPermissions(): AskUloPermissions {
  return {
    canAskLegal: true,
    canSeeResidents: true,
    canSeeVendors: true,
    canSeeFinance: true,
  }
}

/**
 * Prepare everything needed before safety / routing / tools.
 * Does not classify intent (that belongs to classifyQuestion).
 */
export async function buildAskUloContext(
  supabase: SupabaseClient,
  input: AskUloRunInput,
): Promise<AskUloContext> {
  const turn = buildAskUloTurnContext(input)
  const portfolioJurisdiction = await resolvePortfolioJurisdiction(
    supabase,
    turn.landlordId,
  )
  const buildingFilter =
    extractBuildingFilter(turn.question) ??
    extractBuildingFilter(turn.retrievalQuestion)

  return {
    supabase,
    ...turn,
    portfolioJurisdiction,
    propertyScope: {
      buildingFilter,
      sampleBuildings: portfolioJurisdiction.sampleBuildings,
      buildingCount: portfolioJurisdiction.buildingCount,
    },
    permissions: {
      ...defaultPermissions(),
      ...(input.permissions ?? {}),
    },
    flags: getAskUloFeatureFlags(),
  }
}
