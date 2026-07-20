/**
 * Ask Ulo orchestration: classify intent → route tools → synthesize → log graph.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  formatQualityChecksForAudit,
  plannedToolNames,
  runAnswerQualityGate,
} from "./answerQualityGate.ts"
import {
  applyAskUloAgentModeBias,
  parseAskUloAgentMode,
  type AskUloAgentMode,
} from "./agentMode.ts"
import {
  detectAskUloActionBoundary,
  formatActionBoundaryMarkdown,
} from "./actionBoundary.ts"
import {
  draftCommunication,
  type DraftCommunicationResult,
} from "./domainTools/draftCommunication.ts"
import {
  listActiveWorkflows,
  type ListActiveWorkflowsResult,
} from "./domainTools/listActiveWorkflows.ts"
import {
  getWeatherAlerts,
  type GetWeatherAlertsResult,
} from "./domainTools/getWeatherAlerts.ts"
import {
  getLandlordIncentives,
  type GetLandlordIncentivesResult,
} from "./domainTools/getLandlordIncentives.ts"
import {
  COUNSEL_EXPERT_ROLES,
  recommendCounselExpert,
  type CounselExpertRoleId,
} from "./counselHandoff.ts"
import {
  detectFairHousingSafety,
  formatFairHousingBlockMarkdown,
  formatFairHousingRefuseDecisionNote,
} from "./fairHousingSafety.ts"
import {
  detectHumanDecisionSafety,
  formatHumanDecisionRefuseNote,
} from "./humanDecisionSafety.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { humanizeOpsLanguage } from "./reasoningTransparency.ts"
import { classifyAskUloIntent, planToolsForIntent } from "./intent.ts"
import {
  classifyAskUloReasoningMode,
  isNarrowFactualOpsQuestion,
} from "./briefingIntent.ts"
import { classifyAnalyticalQuery } from "./analyticalQuery.ts"
import { isPeriodSummaryQuestion, classifyResponseFormat } from "./dynamicResponse.ts"
import { portfolioBriefingLookup } from "./portfolioBriefingLookup.ts"
import { propertyRankingLookup } from "./propertyRankingLookup.ts"
import { periodSummaryLookup } from "./periodSummaryLookup.ts"
import { unitMaintenanceRankingLookup } from "./unitMaintenanceRankingLookup.ts"
import { oldestWaitingWorkOrderLookup } from "./oldestWaitingWorkOrderLookup.ts"
import { entityInvestigationLookup } from "./entityInvestigationLookup.ts"
import { isOldestWaitingWorkOrderQuestion } from "./taskCompletion.ts"
import { isEntityInvestigationQuestion } from "./entityInvestigation.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import { extractBuildingFilter } from "./buildingFilter.ts"
import { deepOperationalInvestigationLookup } from "./deepOperationalInvestigationLookup.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { recurringRepairsLookup } from "./recurringRepairsLookup.ts"
import { missingUpdatesLookup } from "./missingUpdatesLookup.ts"
import { vendorResponseSpeedLookup } from "./vendorResponseSpeedLookup.ts"
import { vendorBestLookup } from "./vendorBestLookup.ts"
import { vendorCompletionLookup } from "./vendorCompletionLookup.ts"
import { vendorInactiveLookup } from "./vendorInactiveLookup.ts"
import { vendorVerificationStatusLookup } from "./vendorVerificationStatusLookup.ts"
import { vendorOverloadLookup } from "./vendorOverloadLookup.ts"
import {
  detectQuestionSubject,
  isHonestGapSubjectQuestion,
  isUloActiveTasksQuestion,
  isVendorFocusedQuestion,
  isWeatherAlertsQuestion,
  isLandlordIncentivesQuestion,
} from "./questionSubjectMatch.ts"
import { shouldFetchPortfolioBriefing } from "./reasoningMode.ts"
import { planEvidenceForQuestion } from "./subjectEvidenceGate.ts"
import { detectAskUloCapability } from "./capability.ts"
import { resolveCapabilityRoute } from "./capabilityRoute.ts"
import {
  emptyEvidenceBundle,
  finalizeEvidenceBundle,
  getAwaitingDecisions,
  getPropertyInsights,
  listResidents,
  recordToolExecution,
  summarizeEvidenceBundle,
} from "./domainTools/mod.ts"
import {
  isOpenAiToolSelectEnabled,
  selectDomainToolsWithOpenAI,
  type PlannedDomainToolCall,
} from "./domainTools/openaiToolSelect.ts"
import {
  applyPlannedToolsToNeeds,
  buildToolSelectAllowlist,
  planToolsFromCapabilityRoute,
} from "./domainTools/toolSelectNeeds.ts"
import { executePlannedDomainTools } from "./domainTools/executeDomainTool.ts"
import {
  buildCatchAllWorkOrderPacket,
  shouldAttemptCatchAllWorkOrderFallback,
  type CatchAllWorkOrderPacket,
} from "./domainTools/catchAllFallback.ts"
import {
  incompleteEntityRootCauseAnswer,
  incompleteInvestigationAnswer,
  incompleteMaintenanceRiskAnswer,
  incompleteOldestWaitingAnswer,
  incompleteSubjectGapAnswer,
  incompleteTaskAnswer,
} from "./missingInfoCommunication.ts"
import {
  buildToolMissIncompleteSignal,
  resolveIncompleteRankingSignal,
} from "./incompleteEvidence.ts"
import {
  classifyEpistemicAsk,
  resolveEpistemicOutcome,
  type EpistemicClassification,
} from "./epistemicBucket.ts"
import {
  appendDroppedHalfIfNeeded,
  detectCompoundVendorMarketIntent,
} from "./compoundIntent.ts"
import {
  assessLegalGrounding,
  formatLegalClarificationMarkdown,
  formatLegalRefuseMarkdown,
  resolveLegalJurisdiction,
  type LegalJurisdictionResolution,
} from "./legalJurisdiction.ts"
import {
  detectLegalSensitiveTopics,
  formatSensitiveCounselNote,
  isScreeningPrivacyTopic,
  type LegalSensitiveTopic,
} from "./legalSensitiveTopics.ts"
import { legalRagSearch } from "./legalRagSearch.ts"
import {
  prepareRetrievalCache,
  putRetrievalCache,
} from "./retrievalCache.ts"
import { summarizeLegalSourceTiers } from "./legalSourceTrust.ts"
import { marketDataLookup } from "./marketDataLookup.ts"
import { opsGraphLookup, type AskUloCitation } from "./opsGraphLookup.ts"
import { resolvePortfolioJurisdiction } from "./portfolioContext.ts"
import {
  formatPriceHistoryMarkdown,
  propertyPriceHistoryLookup,
} from "./propertyPriceHistory.ts"
import {
  leasingImpactFromOpsBullets,
  propertySnapshotLookup,
} from "./propertySnapshot.ts"
import {
  enrichPropertyContextForLegal,
  formatPropertyScopeClarifyMarkdown,
  legalOpsContextFromOpsBullets,
  needsPortfolioPropertyScope,
} from "./propertyContext.ts"
import {
  formatRentHistoryMarkdown,
  rentHistoryLookup,
} from "./rentHistoryLookup.ts"
import { structuredComplianceLookup } from "./structuredLookup.ts"
import {
  assessAnswerConfidence,
  buildSourcesUsed,
  confidenceLabel,
  type AnswerConfidence,
  type SourceUsedItem,
} from "./sourceHierarchy.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"
import {
  buildFaithfulnessForEval,
  estimateTokensFromText,
  insertAskUloEval,
  extractAskUloFailureTags,
} from "./evalRecord.ts"

export type AskUloResponse = {
  answer: string
  citations: AskUloCitation[]
  toolsUsed: string[]
  mode: "openai" | "fallback"
  model: string | null
  intent: string
  agentMode: AskUloAgentMode | null
  /** Continuous-eval row id for feedback / dashboards. */
  evalId: string | null
  jurisdiction: {
    countryCode: string
    stateCode: string | null
    countySlug: string | null
    countyLabel: string | null
    citySlug: string | null
    cityLabel: string | null
    courtSystem: string | null
    housingProgram: string | null
    codeSet: string | null
  }
  /** Rich UI payload for market / rental / neighborhood / investment analyses. */
  visualContext: AskUloVisualContext | null
  /** Audit / transparency for legal answers (also persisted on messages). */
  legalAudit: AskUloLegalAudit | null
  /** Set when the user asked Ulo to auto-execute a blocked consequential action. */
  safetyBoundary: AskUloSafetyBoundary | null
}

export type AskUloSafetyBoundary = {
  blocked: true
  /** Distinguishes auto-execute blocks from Fair Housing / screening refusals. */
  kind?: "action_boundary" | "fair_housing"
  actions: Array<{ id: string; label: string }>
  fairHousingFlags?: Array<{ id: string; label: string }>
}

export type AskUloLegalAudit = {
  gateStatus: "ok" | "clarify" | "refuse" | null
  sensitiveTopics: Array<{ id: string; label: string }>
  requireCounsel: boolean
  counselNote: string | null
  officialSourceCount: number
  primaryOfficialCount: number
  agencyGuidanceCount: number
  discoveryMirrorCount: number
  /** Newly adopted ordinances not yet in the published online code. */
  pendingOrdinanceCount: number
  /** Suggested human expert for handoff. */
  recommendedExpertId: CounselExpertRoleId
  /** Concrete expert roles landlords can flag for review. */
  handoffExperts: Array<{
    id: CounselExpertRoleId
    label: string
    shortLabel: string
    description: string
    whenToUse: string
  }>
  /** When gate is clarify for property scope — clickable building names in UI. */
  propertyClarifyOptions: string[]
  /** Answer confidence from trusted source hierarchy. */
  answerConfidence: AnswerConfidence
  answerConfidenceLabel: string
  /** Transparent checklist of sources that grounded this answer. */
  sourcesUsed: SourceUsedItem[]
  /** Five-check quality gate (location → topic → scope → sources → grounding + safety QC). */
  qualityChecks: Array<{
    id: string
    step: number | null
    label: string
    status: "pass" | "fail" | "warn" | "skip"
    summary: string
  }>
}

export type AskUloMarketCompVisual = {
  address: string
  rent: number | null
  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  distanceMiles: number | null
  source: string
  listingUrl: string | null
}

export type AskUloHistoryChartPoint = {
  date: string
  value: number
}

export type AskUloVisualContext =
  | {
      kind: "market_analysis" | "comparable_rentals"
      buildingName: string | null
      address: string | null
      cityLabel: string | null
      stateCode: string | null
      lat: number | null
      lng: number | null
      comps: AskUloMarketCompVisual[]
      showStreetView: boolean
    }
  | {
      kind: "price_history" | "rent_history"
      buildingName: string | null
      title: string
      changeLabel: string | null
      /** 'value' = property $, 'rent' = $/mo */
      valueKind: "value" | "rent"
      series: AskUloHistoryChartPoint[]
    }

/** Approximate coords for demo portfolio addresses (Street View). */
const DEMO_GEO: Record<string, { lat: number; lng: number }> = {
  "812 Oakwood Ave, Portland, OR 97214": { lat: 45.5152, lng: -122.6486 },
  "220 Pine Ridge Dr, Portland, OR 97217": { lat: 45.582, lng: -122.678 },
  "45 Cedar Court Ln, Beaverton, OR 97005": { lat: 45.487, lng: -122.803 },
  "901 Maple Heights Blvd, Hillsboro, OR 97124": { lat: 45.5229, lng: -122.9898 },
  "12 Birch Tower Way, Portland, OR 97209": { lat: 45.5308, lng: -122.682 },
  "330 Willow Park Rd, Gresham, OR 97030": { lat: 45.498, lng: -122.43 },
}

// Building filter lives in buildingFilter.ts (rejects HVAC / plumbing as "buildings").

export type AskUloHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export async function runAskUlo(
  supabase: SupabaseClient,
  input: {
    question: string
    landlordId: string
    history?: AskUloHistoryMessage[]
    conversationId?: string | null
    agentMode?: string | null
  },
): Promise<AskUloResponse> {
  const startedAt = Date.now()
  const question = input.question.trim()
  const landlordId = input.landlordId.trim()
  const agentMode = parseAskUloAgentMode(input.agentMode)
  const history = (input.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)

  const priorUserTurns = history.filter((m) => m.role === "user").map((m) => m.content)
  const classified = classifyAskUloIntent(question, priorUserTurns)
  const intentResult = applyAskUloAgentModeBias(classified, agentMode)
  const actionBoundary = detectAskUloActionBoundary(question)
  const fairHousingSafety = detectFairHousingSafety(question)

  const emptyJurisdiction = {
    countryCode: "US",
    stateCode: null as string | null,
    countySlug: null as string | null,
    countyLabel: null as string | null,
    citySlug: null as string | null,
    cityLabel: null as string | null,
    courtSystem: null as string | null,
    housingProgram: null as string | null,
    codeSet: null as string | null,
  }

  async function recordSafetyEval(inputEval: {
    answer: string
    toolsUsed: string[]
    knownUnknown: boolean
    fairHousingFlags?: string[]
  }): Promise<string | null> {
    return insertAskUloEval(supabase, {
      landlordId,
      conversationId: input.conversationId ?? null,
      questionExcerpt: question,
      intent: intentResult.intent,
      mode: "fallback",
      model: null,
      gateStatus: null,
      refused: true,
      clarified: false,
      requireCounsel: true,
      knownUnknown: inputEval.knownUnknown,
      qualityChecks: [],
      qualitySummary: inputEval.toolsUsed.join(","),
      stateCode: null,
      countySlug: null,
      citySlug: null,
      housingProgram: null,
      sensitiveTopicIds: [],
      fairHousingFlags: inputEval.fairHousingFlags ?? [],
      humanDecisionFlags: [],
      citationCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      discoveryMirrorCount: 0,
      retrievalCacheHit: false,
      answerConfidence: null,
      faithfulnessScore: null,
      faithfulnessDetail: { notes: ["safety_boundary"] },
      latencyMs: Date.now() - startedAt,
      failureTags: extractAskUloFailureTags(inputEval.toolsUsed),
    })
  }

  if (actionBoundary.blocked) {
    const answer = formatActionBoundaryMarkdown(actionBoundary)
    const epistemicEarly = classifyEpistemicAsk({
      question,
      subject: "other",
      capability: "search",
      policyBlocked: true,
    })
    console.log(
      "ASK_ULO_EPISTEMIC_BUCKET",
      JSON.stringify({
        ...epistemicEarly,
        phase: "policy_early",
      }),
    )
    const toolsUsed = [
      `intent:${intentResult.intent}`,
      "safety:action_boundary",
      `epistemic:${epistemicEarly.classified_bucket}`,
      ...actionBoundary.actions.map((a) => `blocked:${a.id}`),
    ]
    if (agentMode) toolsUsed.push(`agent_mode:${agentMode}`)

    const evalId = await recordSafetyEval({
      answer,
      toolsUsed,
      knownUnknown: true,
    })

    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "ask_ulo.answered",
      source: "edge_function",
      actor_type: "landlord",
      metadata: {
        question: question.slice(0, 500),
        intent: intentResult.intent,
        intent_confidence: intentResult.confidence,
        agent_mode: agentMode,
        tools_used: toolsUsed,
        mode: "fallback",
        model: null,
        citation_count: 0,
        conversation_id: input.conversationId ?? null,
        history_turns: history.length,
        safety_boundary: true,
        safety_kind: "action_boundary",
        blocked_actions: actionBoundary.actions.map((a) => a.id),
        eval_id: evalId,
        latency_ms: Date.now() - startedAt,
        known_unknown: true,
      },
    })

    return {
      answer,
      citations: [],
      toolsUsed,
      mode: "fallback",
      model: null,
      intent: intentResult.intent,
      agentMode,
      evalId,
      jurisdiction: emptyJurisdiction,
      visualContext: null,
      legalAudit: null,
      safetyBoundary: {
        blocked: true,
        kind: "action_boundary",
        actions: actionBoundary.actions.map((a) => ({ id: a.id, label: a.label })),
      },
    }
  }

  if (fairHousingSafety.blocked) {
    const answer = formatFairHousingBlockMarkdown(fairHousingSafety)
    const toolsUsed = [
      `intent:${intentResult.intent}`,
      "safety:fair_housing",
      ...fairHousingSafety.flags.map((f) => `fair_housing:${f.id}`),
    ]
    if (agentMode) toolsUsed.push(`agent_mode:${agentMode}`)

    const evalId = await recordSafetyEval({
      answer,
      toolsUsed,
      knownUnknown: true,
      fairHousingFlags: fairHousingSafety.flags.map((f) => f.id),
    })

    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "ask_ulo.answered",
      source: "edge_function",
      actor_type: "landlord",
      metadata: {
        question: question.slice(0, 500),
        intent: intentResult.intent,
        intent_confidence: intentResult.confidence,
        agent_mode: agentMode,
        tools_used: toolsUsed,
        mode: "fallback",
        model: null,
        citation_count: 0,
        conversation_id: input.conversationId ?? null,
        history_turns: history.length,
        safety_boundary: true,
        safety_kind: "fair_housing",
        fair_housing_flags: fairHousingSafety.flags.map((f) => f.id),
        protected_traits: fairHousingSafety.protectedTraitsMentioned,
        proxies: fairHousingSafety.proxiesMentioned,
        eval_id: evalId,
        latency_ms: Date.now() - startedAt,
        known_unknown: true,
      },
    })

    return {
      answer,
      citations: [],
      toolsUsed,
      mode: "fallback",
      model: null,
      intent: intentResult.intent,
      agentMode,
      evalId,
      jurisdiction: emptyJurisdiction,
      visualContext: null,
      legalAudit: null,
      safetyBoundary: {
        blocked: true,
        kind: "fair_housing",
        actions: [
          {
            id: "fair_housing_screening",
            label: "recommend approve/deny based on protected traits or proxies",
          },
        ],
        fairHousingFlags: fairHousingSafety.flags.map((f) => ({
          id: f.id,
          label: f.label,
        })),
      },
    }
  }

  const plan = planToolsForIntent(intentResult.intent)
  const humanDecisionSafety = detectHumanDecisionSafety(question)
  // Always scan — DV, retaliation, accommodations, etc. can appear outside "legal" intent.
  const sensitiveTopics: LegalSensitiveTopic[] = detectLegalSensitiveTopics(question)
  // Soft approve/deny asks still get screening/fair-housing counsel pressure.
  if (
    fairHousingSafety.refuseDecision &&
    !sensitiveTopics.some((t) => t.id === "tenant_screening" || t.id === "fair_housing")
  ) {
    sensitiveTopics.push({ id: "tenant_screening", label: "Tenant screening" })
    sensitiveTopics.push({ id: "fair_housing", label: "Fair housing / discrimination" })
  }
  if (
    humanDecisionSafety.refuseDecision &&
    humanDecisionSafety.flags.some((f) => f.id === "disability_accommodation_decision") &&
    !sensitiveTopics.some((t) => t.id === "disability_accommodation")
  ) {
    sensitiveTopics.push({
      id: "disability_accommodation",
      label: "Disability accommodations",
    })
  }
  const screeningIsolation = sensitiveTopics.some((t) => isScreeningPrivacyTopic(t.id))
  const requireCounsel =
    sensitiveTopics.length > 0 ||
    fairHousingSafety.refuseDecision ||
    humanDecisionSafety.refuseDecision
  const counselParts = [
    requireCounsel && sensitiveTopics.length > 0
      ? formatSensitiveCounselNote(sensitiveTopics)
      : null,
    fairHousingSafety.refuseDecision
      ? formatFairHousingRefuseDecisionNote(fairHousingSafety)
      : null,
    humanDecisionSafety.refuseDecision
      ? formatHumanDecisionRefuseNote(humanDecisionSafety)
      : null,
  ].filter(Boolean)
  const counselNote = counselParts.length > 0 ? counselParts.join(" ") : null

  const retrievalQuestion =
    history.length > 0
      ? [...priorUserTurns, question].slice(-3).join("\n")
      : question

  const portfolioJurisdiction = await resolvePortfolioJurisdiction(supabase, landlordId)
  const buildingFilter =
    extractBuildingFilter(question) ?? extractBuildingFilter(retrievalQuestion)

  const toolsUsed: string[] = [
    `intent:${intentResult.intent}`,
    `portfolio_location:${portfolioJurisdiction.locationSource}`,
  ]
  if (portfolioJurisdiction.stateCode) {
    toolsUsed.push(
      `portfolio_place:${[portfolioJurisdiction.cityLabel, portfolioJurisdiction.stateCode]
        .filter(Boolean)
        .join(",")}`,
    )
  }
  console.log(
    "ASK_ULO_PORTFOLIO_JURISDICTION",
    JSON.stringify({
      landlordId,
      locationSource: portfolioJurisdiction.locationSource,
      stateCode: portfolioJurisdiction.stateCode,
      cityLabel: portfolioJurisdiction.cityLabel,
      buildingCount: portfolioJurisdiction.buildingCount,
    }),
  )
  if (fairHousingSafety.refuseDecision) {
    toolsUsed.push("safety:fair_housing_refuse_decision")
    for (const f of fairHousingSafety.flags) {
      toolsUsed.push(`fair_housing:${f.id}`)
    }
  }
  if (humanDecisionSafety.refuseDecision) {
    toolsUsed.push("safety:human_decision_refuse")
    for (const f of humanDecisionSafety.flags) {
      toolsUsed.push(`human_decision:${f.id}`)
    }
  }
  if (screeningIsolation) toolsUsed.push("privacy:screening_isolation")

  let legalResolution: LegalJurisdictionResolution | null = null
  let effectiveJurisdiction: {
    countryCode: string
    stateCode: string | null
    countySlug: string | null
    countyLabel: string | null
    citySlug: string | null
    cityLabel: string | null
    courtSystem: string | null
    housingProgram: string | null
    codeSet: string | null
  } = {
    countryCode: "US",
    stateCode: portfolioJurisdiction.stateCode,
    countySlug: null,
    countyLabel: null,
    citySlug: portfolioJurisdiction.citySlug,
    cityLabel: portfolioJurisdiction.cityLabel,
    courtSystem: null,
    housingProgram: null,
    codeSet: null,
  }

  if (intentResult.intent === "legal") {
    legalResolution = resolveLegalJurisdiction({
      question,
      priorUserTurns,
      portfolio: portfolioJurisdiction,
      buildingHint: buildingFilter,
    })
    toolsUsed.push(`legal_jurisdiction:${legalResolution.source}`)
    if (legalResolution.stateCode) {
      effectiveJurisdiction = {
        countryCode: legalResolution.countryCode,
        stateCode: legalResolution.stateCode,
        countySlug: legalResolution.countySlug,
        countyLabel: legalResolution.countyLabel,
        citySlug: legalResolution.citySlug,
        cityLabel: legalResolution.cityLabel,
        courtSystem: legalResolution.courtSystem,
        housingProgram: legalResolution.housingProgram,
        codeSet: legalResolution.codeSet,
      }
    }
  }

  const runLegalTools =
    plan.runLegalRag &&
    legalResolution != null &&
    !legalResolution.needsClarification &&
    Boolean(legalResolution.stateCode)

  let legal: Awaited<ReturnType<typeof legalRagSearch>> | null = null
  let structured: Awaited<
    ReturnType<typeof structuredComplianceLookup>
  > | null = null
  let retrievalCacheHit = false

  if (runLegalTools) {
    const cachePrep = await prepareRetrievalCache(supabase, {
      intent: intentResult.intent,
      stateCode: effectiveJurisdiction.stateCode,
      citySlug: effectiveJurisdiction.citySlug,
      countySlug: effectiveJurisdiction.countySlug,
      housingProgram: effectiveJurisdiction.housingProgram,
      question: retrievalQuestion,
    })
    if (cachePrep.hit && cachePrep.payload) {
      legal = cachePrep.payload.legal
      structured = cachePrep.payload.structured
      retrievalCacheHit = true
      toolsUsed.push("retrieval_cache:hit")
      toolsUsed.push(`retrieval_topic:${cachePrep.topicBucket}`)
    } else {
      toolsUsed.push("retrieval_cache:miss")
      toolsUsed.push(`retrieval_topic:${cachePrep.topicBucket}`)
      const [legalFresh, structuredFresh] = await Promise.all([
        legalRagSearch(supabase, {
          question: retrievalQuestion,
          stateCode: effectiveJurisdiction.stateCode,
          citySlug: effectiveJurisdiction.citySlug,
          countySlug: effectiveJurisdiction.countySlug,
          countryCode: effectiveJurisdiction.countryCode,
          housingProgram: effectiveJurisdiction.housingProgram,
        }),
        plan.runStructured
          ? structuredComplianceLookup(supabase, {
              question: retrievalQuestion,
              stateCode: effectiveJurisdiction.stateCode,
              citySlug: effectiveJurisdiction.citySlug,
              countySlug: effectiveJurisdiction.countySlug,
            })
          : Promise.resolve(null),
      ])
      legal = legalFresh
      structured = structuredFresh
      await putRetrievalCache(supabase, {
        cacheKey: cachePrep.cacheKey,
        intent: intentResult.intent,
        stateCode: effectiveJurisdiction.stateCode,
        citySlug: effectiveJurisdiction.citySlug,
        countySlug: effectiveJurisdiction.countySlug,
        housingProgram: effectiveJurisdiction.housingProgram,
        questionNorm: cachePrep.questionNorm,
        sourceFreshnessToken: cachePrep.sourceFreshnessToken,
        payload: { legal, structured },
      })
    }
  }

  const reasoningEarly = classifyAskUloReasoningMode(question)
  const analytical = classifyAnalyticalQuery(question)
  const playbook = classifyInvestigationPlaybook(question)
  const evidencePlan = planEvidenceForQuestion(question)
  const capabilityResult = detectAskUloCapability(question, evidencePlan.subject)
  const capabilityRoute = resolveCapabilityRoute({
    subject: evidencePlan.subject,
    capability: capabilityResult.capability,
  })
  console.log(
    "ASK_ULO_PLAYBOOK",
    JSON.stringify({
      id: playbook.id,
      consultTier1First: playbook.consultTier1First,
      preferTier1Answer: playbook.preferTier1Answer,
      deepOpsPrimary: playbook.deepOpsPrimary,
    }),
  )
  console.log(
    "ASK_ULO_CAPABILITY_ROUTE",
    JSON.stringify({
      subject: evidencePlan.subject,
      capability: capabilityResult.capability,
      confidence: capabilityResult.confidence,
      hints: capabilityResult.hints,
      requiredTools: capabilityRoute.requiredTools,
      optionalTools: capabilityRoute.optionalTools,
    }),
  )

  const epistemicAsk = classifyEpistemicAsk({
    question,
    subject: evidencePlan.subject,
    capability: capabilityResult.capability,
  })
  const compoundVendorMarket = detectCompoundVendorMarketIntent(question)
  console.log(
    "ASK_ULO_EPISTEMIC_BUCKET",
    JSON.stringify({
      classified_bucket: epistemicAsk.classified_bucket,
      matched_rule: epistemicAsk.matched_rule,
      confidence: epistemicAsk.confidence,
      fallback_reason: epistemicAsk.fallback_reason,
      secondary_signals: epistemicAsk.secondary_signals,
      compound_vendor_market: compoundVendorMarket.isCompound,
      phase: "ask",
    }),
  )

  const vendorSubjectLock =
    evidencePlan.subject === "vendor" || isVendorFocusedQuestion(question)
  /** Hard subject gate: never fetch property ranking / portfolio briefing for wrong subjects. */
  const propertyDashboardLock =
    evidencePlan.blockPropertyDashboard || vendorSubjectLock
  const toolSelectLocks = {
    blockPropertyDashboard: propertyDashboardLock,
    vendorLock: vendorSubjectLock,
  }
  const toolAllowlist = buildToolSelectAllowlist(capabilityRoute, toolSelectLocks)
  const rulePlannedTools = planToolsFromCapabilityRoute({
    route: capabilityRoute,
    hints: capabilityResult.hints,
    locks: toolSelectLocks,
  })

  let plannedTools: PlannedDomainToolCall[] = rulePlannedTools
  let toolSelectSource: "openai" | "rules" | "skipped" | "error" = "rules"
  let noToolMatched = false

  if (isOpenAiToolSelectEnabled() && toolAllowlist.length > 0) {
    const llmSelect = await selectDomainToolsWithOpenAI({
      question,
      allowlist: toolAllowlist,
      subject: evidencePlan.subject,
      capability: capabilityResult.capability,
    })
    if (llmSelect.ok && llmSelect.tools.length > 0) {
      // Always keep required-route tools; LLM may add optional ones / refine args.
      const byName = new Map<string, PlannedDomainToolCall>()
      for (const t of rulePlannedTools) byName.set(t.name, t)
      for (const t of llmSelect.tools) byName.set(t.name, t)
      plannedTools = [...byName.values()]
      toolSelectSource = "openai"
      noToolMatched = false
    } else {
      noToolMatched = llmSelect.noToolMatched || llmSelect.source === "empty"
      toolSelectSource = llmSelect.source === "error" ? "error" : "rules"
      plannedTools = rulePlannedTools
    }
    console.log(
      "ASK_ULO_TOOL_SELECT",
      JSON.stringify({
        source: toolSelectSource,
        allowlist: toolAllowlist,
        tools_planned: plannedTools.map((t) => ({
          name: t.name,
          arguments: t.arguments,
        })),
        no_tool_matched: noToolMatched,
        openai_source: llmSelect.source,
        error: llmSelect.error ?? null,
        model: llmSelect.model ?? null,
        latencyMs: llmSelect.latencyMs ?? null,
      }),
    )
  } else {
    console.log(
      "ASK_ULO_TOOL_SELECT",
      JSON.stringify({
        source: "rules",
        allowlist: toolAllowlist,
        tools_planned: plannedTools.map((t) => ({
          name: t.name,
          arguments: t.arguments,
        })),
        no_tool_matched: false,
        openai_source: "skipped",
      }),
    )
  }

  const toolNeeds = applyPlannedToolsToNeeds(plannedTools, toolSelectLocks)
  toolsUsed.push(`tool_select:${toolSelectSource}`)
  if (noToolMatched) toolsUsed.push("no_tool_matched")
  for (const id of toolNeeds.plannedToolIds) {
    toolsUsed.push(`tools_planned:${id}`)
  }

  const needsPeriodSummary =
    intentResult.intent === "period_summary" || isPeriodSummaryQuestion(question)
  const needsOldestWaiting =
    !needsPeriodSummary &&
    (intentResult.intent === "oldest_waiting_work_order" ||
      isOldestWaitingWorkOrderQuestion(question))
  const needsEntityInvestigation =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    (intentResult.intent === "entity_investigation" ||
      isEntityInvestigationQuestion(question))
  const deepOpsCandidate =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    requiresDeepOperationalInvestigation(question)
  // Repair-cost / deep-ops-primary playbooks own the path. For Tier-1-first
  // playbooks (maintenance risk, emergencies), still allow deep ops as enrichment
  // but never let it suppress Property Insights / briefing.
  const needsDeepOps =
    deepOpsCandidate &&
    (playbook.deepOpsPrimary ||
      playbook.id === "why_not_resolved" ||
      playbook.id === "generic_ops" ||
      playbook.id === "maintenance_risk" ||
      playbook.id === "emergency_escalation")
  const needsDraftCommunication =
    capabilityResult.capability === "draft" ||
    capabilityRoute.requiredTools.includes("draft_communication") ||
    toolNeeds.needsDraftCommunication
  const needsActiveWorkflows =
    !needsDraftCommunication &&
    (isUloActiveTasksQuestion(question) ||
      capabilityRoute.requiredTools.includes("list_active_workflows") ||
      toolNeeds.needsActiveWorkflows ||
      (evidencePlan.subject === "workflow" &&
        (capabilityResult.capability === "explain_status" ||
          capabilityResult.capability === "search")))
  const needsWeatherAlerts =
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    (isWeatherAlertsQuestion(question) ||
      capabilityRoute.requiredTools.includes("get_weather_alerts") ||
      toolNeeds.needsWeatherAlerts ||
      evidencePlan.subject === "weather")
  const needsLandlordIncentives =
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    (isLandlordIncentivesQuestion(question) ||
      capabilityRoute.requiredTools.includes("get_landlord_incentives") ||
      toolNeeds.needsLandlordIncentives ||
      evidencePlan.subject === "incentives")
  const needsListResidents =
    !needsPeriodSummary &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    (Boolean(capabilityResult.hints.residentFilter) ||
      toolNeeds.needsListResidents ||
      ((evidencePlan.subject === "resident" || evidencePlan.subject === "finance") &&
        capabilityRoute.requiredTools.includes("search_residents")))
  const needsPropertyInsights =
    evidencePlan.allowPropertyInsights &&
    !vendorSubjectLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    (toolNeeds.needsPropertyInsights ||
      ((playbook.consultTier1First ||
        capabilityResult.capability === "identify_risk" ||
        capabilityResult.capability === "identify_recurring_pattern") &&
        playbook.id !== "approve_repairs" &&
        capabilityResult.capability !== "identify_pending_decision" &&
        playbook.id !== "missing_updates" &&
        playbook.id !== "vendor_speed" &&
        playbook.id !== "vendor_best" &&
        playbook.id !== "vendor_completion" &&
        playbook.id !== "vendor_inactive" &&
        playbook.id !== "vendor_overload"))
  const needsRecurringRepairs =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "recurring_repairs" ||
      capabilityResult.capability === "identify_recurring_pattern")
  const needsApproveRepairs =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "approve_repairs" ||
      capabilityResult.capability === "identify_pending_decision" ||
      toolNeeds.needsApproveRepairs)
  const needsMissingUpdates =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    playbook.id === "missing_updates"
  const needsVendorResponseSpeed =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "vendor_speed" || toolNeeds.needsVendorResponseSpeed)
  const needsVendorCompletion =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "vendor_completion" || toolNeeds.needsVendorCompletion)
  const needsVendorInactive =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "vendor_inactive" || toolNeeds.needsVendorInactive)
  const needsVendorOverload =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "vendor_overload" || toolNeeds.needsVendorOverload)
  const needsVendorVerification =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    playbook.id === "vendor_verification"
  const needsVendorBest =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (playbook.id === "vendor_best" || toolNeeds.needsVendorBest)
  const needsUnitRanking =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (intentResult.intent === "unit_maintenance_ranking" ||
      analytical.isUnitMaintenanceVolumeRanking)
  const needsBriefing =
    !propertyDashboardLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    !plan.runMarketData &&
    intentResult.intent !== "market_rent_estimate" &&
    intentResult.intent !== "market_analysis" &&
    intentResult.intent !== "comparable_rentals" &&
    intentResult.intent !== "property_priority" &&
    reasoningEarly.mode !== "recommendation" &&
    reasoningEarly.mode !== "comparison_ranking" &&
    reasoningEarly.mode !== "diagnosis" &&
    evidencePlan.allowPortfolioBriefing &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsVendorInactive &&
    !needsVendorOverload &&
    !needsVendorVerification &&
    !needsVendorCompletion &&
    !needsVendorBest &&
    !needsVendorResponseSpeed &&
    shouldFetchPortfolioBriefing({
      intent: intentResult.intent,
      reasoningMode: reasoningEarly.mode,
      playbookId: playbook.id,
    })
  const needsRanking =
    !propertyDashboardLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    evidencePlan.allowPropertyRanking &&
    !needsUnitRanking &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsVendorResponseSpeed &&
    !needsVendorCompletion &&
    !needsVendorInactive &&
    !needsVendorOverload &&
    !needsVendorVerification &&
    !needsVendorBest &&
    !needsMissingUpdates &&
    !needsApproveRepairs &&
    !needsRecurringRepairs &&
    intentResult.intent !== "vendor" &&
    playbook.id !== "vendor_speed" &&
    playbook.id !== "vendor_best" &&
    playbook.id !== "vendor_completion" &&
    playbook.id !== "vendor_inactive" &&
    playbook.id !== "vendor_overload" &&
    playbook.id !== "vendor_verification" &&
    !playbook.preferTier1Answer &&
    (intentResult.intent === "property_priority" ||
      reasoningEarly.mode === "comparison_ranking" ||
      reasoningEarly.mode === "diagnosis" ||
      reasoningEarly.mode === "recommendation")

  const [
    opsRaw,
    structuredNonLegal,
    property,
    portfolioBriefing,
    propertyInsights,
    recurringRepairs,
    repairsToApprove,
    missingUpdates,
    vendorResponseSpeed,
    vendorBest,
    vendorCompletion,
    vendorInactive,
    vendorOverload,
    vendorVerification,
    propertyRanking,
    unitMaintenanceRanking,
    periodSummary,
    oldestWaitingWorkOrder,
    entityInvestigation,
    deepOpsInvestigation,
    residentsList,
    draftCommunicationResult,
    activeWorkflowsResult,
    weatherAlertsResult,
    landlordIncentivesResult,
  ] =
    await Promise.all([
      plan.runOpsGraph &&
        !needsUnitRanking &&
        !needsPeriodSummary &&
        !needsOldestWaiting &&
        !needsEntityInvestigation &&
        !needsListResidents &&
        !needsDraftCommunication &&
        !needsActiveWorkflows &&
        !needsWeatherAlerts &&
        !needsLandlordIncentives &&
        !(needsDeepOps && playbook.deepOpsPrimary)
        ? opsGraphLookup(supabase, { landlordId, buildingFilter })
        : Promise.resolve(null),
      !runLegalTools &&
        plan.runStructured &&
        intentResult.intent !== "legal" &&
        !needsDraftCommunication &&
        !needsActiveWorkflows &&
        !needsWeatherAlerts &&
        !needsLandlordIncentives
        ? structuredComplianceLookup(supabase, {
            question: retrievalQuestion,
            stateCode: portfolioJurisdiction.stateCode,
            citySlug: portfolioJurisdiction.citySlug,
          })
        : Promise.resolve(null),
      plan.runPropertySnapshot &&
        !needsListResidents &&
        !needsDraftCommunication &&
        !needsActiveWorkflows &&
        !needsWeatherAlerts &&
        !needsLandlordIncentives
        ? propertySnapshotLookup(supabase, {
            landlordId,
            question: retrievalQuestion,
            jurisdiction: {
              stateCode: effectiveJurisdiction.stateCode,
              cityLabel: effectiveJurisdiction.cityLabel,
              citySlug: effectiveJurisdiction.citySlug,
            },
          })
        : Promise.resolve(null),
      needsBriefing
        ? portfolioBriefingLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsPropertyInsights
        ? getPropertyInsights(supabase, { organizationId: landlordId })
        : Promise.resolve(null),
      needsRecurringRepairs
        ? recurringRepairsLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsApproveRepairs
        ? getAwaitingDecisions(supabase, {
            organizationId: landlordId,
            priorities: capabilityResult.hints.priorities,
            maintenanceOnly: true,
          })
        : Promise.resolve(null),
      needsMissingUpdates
        ? missingUpdatesLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsVendorResponseSpeed
        ? vendorResponseSpeedLookup(supabase, { landlordId, question })
        : Promise.resolve(null),
      needsVendorBest
        ? vendorBestLookup(supabase, { landlordId, question, buildingFilter })
        : Promise.resolve(null),
      needsVendorCompletion
        ? vendorCompletionLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsVendorInactive
        ? vendorInactiveLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsVendorOverload
        ? vendorOverloadLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsVendorVerification
        ? vendorVerificationStatusLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsRanking
        ? propertyRankingLookup(supabase, { landlordId })
        : Promise.resolve(null),
      needsUnitRanking
        ? unitMaintenanceRankingLookup(supabase, {
            landlordId,
            buildingFilter,
            analytical,
          })
        : Promise.resolve(null),
      needsPeriodSummary
        ? periodSummaryLookup(supabase, {
            landlordId,
            question,
            buildingFilter,
          })
        : Promise.resolve(null),
      needsOldestWaiting
        ? oldestWaitingWorkOrderLookup(supabase, {
            landlordId,
            buildingFilter,
          })
        : Promise.resolve(null),
      needsEntityInvestigation
        ? entityInvestigationLookup(supabase, {
            landlordId,
            question,
            buildingFilter,
          })
        : Promise.resolve(null),
      needsDeepOps
        ? deepOperationalInvestigationLookup(supabase, {
            landlordId,
            question,
            buildingFilter,
          })
        : Promise.resolve(null),
      needsListResidents
        ? listResidents(supabase, {
            organizationId: landlordId,
            filter: (() => {
              const fromPlan = plannedTools.find((t) => t.name === "search_residents")
                ?.arguments.filter
              if (
                typeof fromPlan === "string" &&
                [
                  "late_rent",
                  "outstanding_balance",
                  "lease_ending",
                  "high_maintenance_activity",
                  "move_in",
                  "move_out",
                  "message_nonresponse",
                ].includes(fromPlan)
              ) {
                return fromPlan as
                  | "late_rent"
                  | "outstanding_balance"
                  | "lease_ending"
                  | "high_maintenance_activity"
                  | "move_in"
                  | "move_out"
                  | "message_nonresponse"
              }
              return capabilityResult.hints.residentFilter ?? "late_rent"
            })(),
            sortBy:
              capabilityResult.hints.residentFilter === "move_in"
                ? "move_in_date"
                : capabilityResult.hints.residentFilter === "message_nonresponse"
                  ? "awaiting_reply_hours"
                  : "balance_due",
            sortOrder: "desc",
            dateRangeDays:
              capabilityResult.hints.residentFilter === "move_in" ? 31 : 30,
            limit: 25,
          })
        : Promise.resolve(null),
      needsDraftCommunication
        ? Promise.resolve(draftCommunication({ question }))
        : Promise.resolve(null as DraftCommunicationResult | null),
      needsActiveWorkflows
        ? listActiveWorkflows(supabase, {
            organizationId: landlordId,
            limit: 40,
          })
        : Promise.resolve(null as ListActiveWorkflowsResult | null),
      needsWeatherAlerts
        ? getWeatherAlerts(supabase, { organizationId: landlordId })
        : Promise.resolve(null as GetWeatherAlertsResult | null),
      needsLandlordIncentives
        ? getLandlordIncentives(supabase, { organizationId: landlordId })
        : Promise.resolve(null as GetLandlordIncentivesResult | null),
    ])

  // Recurring repairs are repair-level evidence (not Property Insights cards).
  const propertyInsightsForAnswer = propertyInsights ?? null

  const toolsCalled: string[] = []
  if (propertyInsights) toolsCalled.push("get_property_insights")
  if (repairsToApprove) toolsCalled.push("get_awaiting_decisions")
  if (residentsList) toolsCalled.push("search_residents")
  if (draftCommunicationResult) toolsCalled.push("draft_communication")
  if (activeWorkflowsResult) toolsCalled.push("list_active_workflows")
  if (weatherAlertsResult) toolsCalled.push("get_weather_alerts")
  if (landlordIncentivesResult) toolsCalled.push("get_landlord_incentives")
  if (vendorResponseSpeed || vendorBest || vendorCompletion || vendorInactive || vendorOverload || vendorVerification) {
    toolsCalled.push("rank_vendors")
  }

  // Gap-fill / catch-all: search_work_orders → landlord packet (never briefing).
  let searchWorkOrdersHit: Extract<
    Awaited<ReturnType<typeof executePlannedDomainTools>>[number],
    { toolId: "search_work_orders" }
  > | null = null
  let catchAllWorkOrders: CatchAllWorkOrderPacket | null = null

  const specialtyPacketAlready =
    Boolean(draftCommunicationResult?.markdown) ||
    Boolean(activeWorkflowsResult?.available && activeWorkflowsResult.markdown) ||
    Boolean(weatherAlertsResult?.available && weatherAlertsResult.markdown) ||
    Boolean(landlordIncentivesResult?.available && landlordIncentivesResult.markdown) ||
    Boolean(residentsList?.available && residentsList.markdown) ||
    Boolean(repairsToApprove?.available && repairsToApprove.markdown) ||
    Boolean(missingUpdates?.available && missingUpdates.markdown) ||
    Boolean(vendorResponseSpeed?.available && vendorResponseSpeed.markdown) ||
    Boolean(vendorBest?.available && vendorBest.markdown) ||
    Boolean(vendorCompletion?.available && vendorCompletion.markdown) ||
    Boolean(vendorInactive?.available && vendorInactive.markdown) ||
    Boolean(vendorOverload?.available && vendorOverload.markdown) ||
    Boolean(vendorVerification?.available && vendorVerification.markdown) ||
    Boolean(recurringRepairs?.available && recurringRepairs.markdown) ||
    Boolean(propertyInsights?.found && propertyInsights.markdown) ||
    Boolean(deepOpsInvestigation?.found && deepOpsInvestigation.markdown) ||
    Boolean(entityInvestigation?.found && entityInvestigation.markdown) ||
    Boolean(oldestWaitingWorkOrder?.found) ||
    Boolean(periodSummary?.canSummarize && periodSummary.markdown)

  const attemptCatchAll = shouldAttemptCatchAllWorkOrderFallback({
    subject: evidencePlan.subject,
    hasSpecialtyPacket: specialtyPacketAlready,
  })

  if (toolNeeds.needsSearchWorkOrders || attemptCatchAll) {
    const plannedForSearch =
      plannedTools.some((t) => t.name === "search_work_orders")
        ? plannedTools
        : [{ name: "search_work_orders" as const, arguments: { query: question } }]
    const executed = await executePlannedDomainTools(
      supabase,
      plannedForSearch,
      {
        organizationId: landlordId,
        question,
        buildingFilter,
      },
      new Set(["search_work_orders"]),
    )
    const hit = executed.find((e) => e.toolId === "search_work_orders")
    if (hit && hit.toolId === "search_work_orders") {
      searchWorkOrdersHit = hit
      if (!toolsCalled.includes("search_work_orders")) {
        toolsCalled.push("search_work_orders")
      }
    }
  }

  if (attemptCatchAll && searchWorkOrdersHit) {
    catchAllWorkOrders = buildCatchAllWorkOrderPacket(searchWorkOrdersHit.result)
  }

  console.log(
    "ASK_ULO_CATCHALL_FALLBACK",
    JSON.stringify({
      attempted: attemptCatchAll,
      subject: evidencePlan.subject,
      specialty_packet: specialtyPacketAlready,
      wo_count: catchAllWorkOrders?.workOrderCount ?? 0,
      used: Boolean(catchAllWorkOrders?.found),
      skipped_briefing: true,
    }),
  )
  if (attemptCatchAll) {
    toolsUsed.push(
      catchAllWorkOrders?.found
        ? "catchall_fallback:search_work_orders"
        : "catchall_fallback:none",
    )
  }

  let epistemicOutcome: EpistemicClassification = resolveEpistemicOutcome({
    ask: epistemicAsk,
    specialtyPacket: specialtyPacketAlready,
    noToolMatched,
    catchallAttempted: attemptCatchAll,
    catchallFound: Boolean(catchAllWorkOrders?.found),
  })
  toolsUsed.push(`epistemic:${epistemicOutcome.classified_bucket}`)
  if (epistemicOutcome.fallback_reason) {
    toolsUsed.push(`epistemic_fallback:${epistemicOutcome.fallback_reason}`)
  }
  console.log(
    "ASK_ULO_EPISTEMIC_BUCKET",
    JSON.stringify({
      classified_bucket: epistemicOutcome.classified_bucket,
      matched_rule: epistemicOutcome.matched_rule,
      confidence: epistemicOutcome.confidence,
      fallback_reason: epistemicOutcome.fallback_reason,
      secondary_signals: epistemicOutcome.secondary_signals,
      compound_vendor_market: compoundVendorMarket.isCompound,
      phase: "outcome",
    }),
  )

  for (const id of toolsCalled) {
    toolsUsed.push(`tools_called:${id}`)
  }
  console.log(
    "ASK_ULO_TOOLS_CALLED",
    JSON.stringify({
      tools_planned: toolNeeds.plannedToolIds,
      tools_called: toolsCalled,
      no_tool_matched: noToolMatched,
      source: toolSelectSource,
    }),
  )

  const evidenceBundle = emptyEvidenceBundle({
    subject: evidencePlan.subject,
    capability: capabilityResult.capability,
    organizationId: landlordId,
  })
  if (propertyInsightsForAnswer) {
    recordToolExecution(evidenceBundle, {
      tool: "get_property_insights",
      arguments: { organizationId: landlordId },
      resultCount: propertyInsightsForAnswer.insights?.length ?? 0,
      success: propertyInsightsForAnswer.available,
    })
    if (propertyInsightsForAnswer.insights?.length) {
      evidenceBundle.findings.insights = propertyInsightsForAnswer.insights.map((i) => ({
        tag: i.tag,
        text: i.text,
        requestCount: i.requestCount ?? null,
        building: i.building ?? null,
        unitLabel: i.unitLabel ?? null,
        categoryLabel: i.categoryLabel ?? null,
      }))
    }
  }
  if (repairsToApprove) {
    recordToolExecution(evidenceBundle, {
      tool: "get_awaiting_decisions",
      arguments: { organizationId: landlordId },
      resultCount: repairsToApprove.items?.length ?? 0,
      success: repairsToApprove.available,
    })
    if (repairsToApprove.items?.length) {
      evidenceBundle.findings.decisions = repairsToApprove.items.map((i) => ({
        kind: i.kind,
        label: i.label,
        building: i.building,
        unitLabel: i.unitLabel,
        category: i.category,
        reason: i.reason,
        priority: i.priority,
        ageHours: i.ageHours,
      }))
    }
  }
  if (residentsList) {
    recordToolExecution(evidenceBundle, {
      tool: "search_residents",
      arguments: residentsList.params,
      resultCount: residentsList.residents.length,
      success: residentsList.available,
      error: residentsList.error ?? undefined,
    })
    if (residentsList.residents.length) {
      evidenceBundle.findings.residents = residentsList.residents.map((r) => ({
        residentId: r.residentId,
        name: r.name,
        unitLabel: r.unitLabel,
        propertyName: r.propertyName,
        balanceDue: r.balanceDue,
        daysOverdue: r.daysOverdue,
        leaseEndDate: r.leaseEndDate,
        workflowRunId: r.workflowRunId,
      }))
    }
  }
  if (draftCommunicationResult) {
    recordToolExecution(evidenceBundle, {
      tool: "draft_communication",
      arguments: { kind: draftCommunicationResult.kind },
      resultCount: 1,
      success: true,
    })
  }
  if (activeWorkflowsResult) {
    recordToolExecution(evidenceBundle, {
      tool: "list_active_workflows",
      arguments: activeWorkflowsResult.params,
      resultCount: activeWorkflowsResult.facts.activeCount,
      success: activeWorkflowsResult.available,
    })
  }
  if (weatherAlertsResult) {
    recordToolExecution(evidenceBundle, {
      tool: "get_weather_alerts",
      arguments: weatherAlertsResult.params,
      resultCount: weatherAlertsResult.alerts.length,
      success: weatherAlertsResult.available,
      error: weatherAlertsResult.error ?? undefined,
    })
  }
  if (landlordIncentivesResult) {
    recordToolExecution(evidenceBundle, {
      tool: "get_landlord_incentives",
      arguments: landlordIncentivesResult.params,
      resultCount: landlordIncentivesResult.programs.length,
      success: landlordIncentivesResult.available,
      error: landlordIncentivesResult.error ?? undefined,
    })
  }
  if (vendorInactive?.ranked?.length) {
    recordToolExecution(evidenceBundle, {
      tool: "rank_vendors",
      arguments: { metric: "inactive" },
      resultCount: vendorInactive.ranked.length,
      success: vendorInactive.available,
    })
    evidenceBundle.findings.vendors = vendorInactive.ranked.map((r) => ({
      vendorId: r.vendorId,
      name: r.name,
      metric: "inactive",
      activeJobs: r.pendingAcceptJobs ?? null,
    }))
  } else if (vendorBest?.ranked?.length) {
    recordToolExecution(evidenceBundle, {
      tool: "rank_vendors",
      arguments: { metric: "overall_quality" },
      resultCount: vendorBest.ranked.length,
      success: vendorBest.available,
    })
    evidenceBundle.findings.vendors = vendorBest.ranked.map((r) => ({
      vendorId: r.vendorId,
      name: r.name,
      metric: "overall_quality",
      score: r.vendorScore,
      category: r.category,
      completedJobs: r.completedJobs,
      acceptedJobs: r.acceptedJobs,
    }))
  } else if (vendorResponseSpeed?.ranked?.length) {
    recordToolExecution(evidenceBundle, {
      tool: "rank_vendors",
      arguments: { metric: "response_time" },
      resultCount: vendorResponseSpeed.ranked.length,
      success: vendorResponseSpeed.available,
    })
    evidenceBundle.findings.vendors = vendorResponseSpeed.ranked.map((r) => ({
      vendorId: r.vendorId,
      name: r.name,
      metric: "response_time",
      score: r.responseSpeedScore,
      completedJobs: r.completedJobs,
      acceptedJobs: r.acceptedJobs,
    }))
  }
  if (searchWorkOrdersHit) {
    const wo = searchWorkOrdersHit.result
    recordToolExecution(evidenceBundle, {
      tool: "search_work_orders",
      arguments: wo.params,
      resultCount: wo.workOrders.length,
      success: wo.available,
      error: wo.error ?? undefined,
    })
    if (wo.workOrders.length) {
      evidenceBundle.findings.workOrders = wo.workOrders.map((w) => ({
        id: w.workOrderId,
        displayId: w.maintenanceRequestId,
        propertyName: w.propertyName,
        unitLabel: w.unitLabel,
        title: w.title,
        description: w.description,
        category: w.category,
        priority: w.priority,
        status: w.vendorWorkStatus ?? w.workflowStatus,
        workflowStage: w.workflowStage,
        vendorName: w.vendorName,
        estimate: w.estimatedCost,
        approvalRequired: w.approvalStatus === "review_required",
        daysOpen: w.daysOpen,
      }))
    }
  }
  const finalizedEvidence = finalizeEvidenceBundle(evidenceBundle)
  console.log(
    "ASK_ULO_EVIDENCE_BUNDLE",
    JSON.stringify(summarizeEvidenceBundle(finalizedEvidence)),
  )

  // If ranking returned only aggregates / incomplete entity data, retry once is already
  // covered by propertyRankingLookup reading per-building fields — mark tool usage below.

  if (!runLegalTools && structuredNonLegal) {
    structured = structuredNonLegal
  }
  // Prefer property snapshot location when legal named a building.
  if (
    intentResult.intent === "legal" &&
    legalResolution &&
    !legalResolution.needsClarification &&
    property?.stateCode
  ) {
    const cityLabel = property.cityLabel ?? legalResolution.cityLabel
    const refreshed = resolveLegalJurisdiction({
      question: cityLabel
        ? `${question} in ${cityLabel} ${property.stateCode}`
        : `${question} in ${property.stateCode}`,
      priorUserTurns,
      portfolio: portfolioJurisdiction,
      buildingHint: buildingFilter ?? property.buildingName,
    })
    effectiveJurisdiction = {
      countryCode: refreshed.countryCode,
      stateCode: property.stateCode,
      countySlug: refreshed.countySlug ?? legalResolution.countySlug,
      countyLabel: refreshed.countyLabel ?? legalResolution.countyLabel,
      citySlug: cityLabel
        ? cityLabel
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : legalResolution.citySlug,
      cityLabel,
      courtSystem: refreshed.courtSystem ?? legalResolution.courtSystem,
      housingProgram: legalResolution.housingProgram,
      codeSet: legalResolution.codeSet ?? refreshed.codeSet,
    }
  }

  // Portfolio dossier for legal: leases, programs, policies, inspections.
  let propertyForSynthesis = property
  let portfolioBuildingNames: string[] = []
  if (intentResult.intent === "legal") {
    // Single-building portfolios: auto-scope so rent/lease questions don't stall.
    if (
      !property?.buildingName &&
      !buildingFilter &&
      property
    ) {
      const probe = await enrichPropertyContextForLegal(supabase, {
        landlordId,
        buildingName: null,
      })
      portfolioBuildingNames = probe.portfolioBuildingNames
      if (probe.portfolioBuildingNames.length === 1) {
        const only = probe.portfolioBuildingNames[0]
        const scoped = await propertySnapshotLookup(supabase, {
          landlordId,
          question: `${retrievalQuestion} at ${only}`,
          jurisdiction: {
            stateCode: effectiveJurisdiction.stateCode,
            cityLabel: effectiveJurisdiction.cityLabel,
            citySlug: effectiveJurisdiction.citySlug,
          },
        })
        propertyForSynthesis = scoped.found ? scoped : property
        toolsUsed.push("property_auto_scope")
      }
    }

    const focusBuilding =
      propertyForSynthesis?.buildingName ?? buildingFilter ?? null
    const enriched = await enrichPropertyContextForLegal(supabase, {
      landlordId,
      buildingName: focusBuilding,
      portfolioBuildingNames:
        portfolioBuildingNames.length > 0 ? portfolioBuildingNames : undefined,
    })
    portfolioBuildingNames =
      enriched.portfolioBuildingNames.length > 0
        ? enriched.portfolioBuildingNames
        : portfolioBuildingNames
    if (enriched.bullets.length && propertyForSynthesis) {
      propertyForSynthesis = {
        ...propertyForSynthesis,
        buildingName: enriched.buildingName ?? propertyForSynthesis.buildingName,
        bullets: [...propertyForSynthesis.bullets, ...enriched.bullets],
        citations: [...propertyForSynthesis.citations, ...enriched.citations],
      }
      toolsUsed.push("property_legal_context")
    } else if (enriched.bullets.length) {
      propertyForSynthesis = {
        bullets: enriched.bullets,
        citations: enriched.citations,
        found: true,
        buildingName: enriched.buildingName,
        cityLabel: effectiveJurisdiction.cityLabel,
        stateCode: effectiveJurisdiction.stateCode,
        addressLine: null,
        portfolioMonthlyRent: null,
      }
      toolsUsed.push("property_legal_context")
    }
    // Property profile may surface HCV even when the question didn't say "Section 8".
    if (
      enriched.housingProgramHint &&
      !effectiveJurisdiction.housingProgram
    ) {
      effectiveJurisdiction = {
        ...effectiveJurisdiction,
        housingProgram: enriched.housingProgramHint,
      }
      toolsUsed.push(`housing_program:${enriched.housingProgramHint}`)
    }
  }

  const recommendedExpertId = recommendCounselExpert(sensitiveTopics)

  let legalGate: {
    status: "ok" | "clarify" | "refuse"
    markdown: string
    officialSourceCount: number
    primaryOfficialCount: number
    agencyGuidanceCount: number
    sensitiveTopics: LegalSensitiveTopic[]
    requireCounsel: boolean
    counselNote: string | null
    recommendedExpertId: CounselExpertRoleId
  } | null = null

  let sourceTierCounts = {
    primaryOfficial: 0,
    agencyGuidance: 0,
    discoveryMirror: 0,
    untrusted: 0,
    answerableCount: 0,
  }

  const resolvedBuilding =
    propertyForSynthesis?.buildingName ?? buildingFilter ?? null
  const needsPropertyScope =
    intentResult.intent === "legal" &&
    needsPortfolioPropertyScope(question) &&
    !resolvedBuilding &&
    (portfolioBuildingNames.length > 1 ||
      portfolioJurisdiction.buildingCount > 1)

  let propertyClarifyOptions: string[] = []

  let groundingReason: string | null = null
  let groundingOk = false

  if (intentResult.intent === "legal" && legalResolution?.needsClarification) {
    legalGate = {
      status: "clarify",
      markdown: formatLegalClarificationMarkdown(legalResolution),
      officialSourceCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      sensitiveTopics,
      requireCounsel,
      counselNote,
      recommendedExpertId,
    }
    toolsUsed.push("legal:clarify_location")
  } else if (needsPropertyScope) {
    const buildings =
      portfolioBuildingNames.length > 0
        ? portfolioBuildingNames
        : portfolioJurisdiction.sampleBuildings
    propertyClarifyOptions = buildings.slice(0, 12)
    legalGate = {
      status: "clarify",
      markdown: formatPropertyScopeClarifyMarkdown(buildings, question),
      officialSourceCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      sensitiveTopics,
      requireCounsel,
      counselNote,
      recommendedExpertId,
    }
    toolsUsed.push("legal:clarify_property")
  } else if (intentResult.intent === "legal" && legalResolution) {
    const legalCitations = legal?.citations ?? []
    const structuredCitations = structured?.relevant ? structured.citations : []
    sourceTierCounts = summarizeLegalSourceTiers([
      ...legalCitations,
      ...structuredCitations,
    ])
    const grounding = assessLegalGrounding({
      stateCode: effectiveJurisdiction.stateCode,
      cityLabel: effectiveJurisdiction.cityLabel,
      legalCitations,
      structuredCitations,
      legalHitCount: legal?.hits.length ?? 0,
      structuredRelevant: Boolean(structured?.relevant),
    })
    groundingReason = grounding.reason
    groundingOk = grounding.grounded
    if (!grounding.grounded && grounding.refusePrompt) {
      legalGate = {
        status: "refuse",
        markdown: formatLegalRefuseMarkdown(
          grounding.refusePrompt,
          effectiveJurisdiction.stateCode,
        ),
        officialSourceCount: grounding.officialSourceCount,
        primaryOfficialCount: grounding.primaryOfficialCount,
        agencyGuidanceCount: grounding.agencyGuidanceCount,
        sensitiveTopics,
        requireCounsel,
        counselNote,
        recommendedExpertId,
      }
      toolsUsed.push(`legal:refuse:${grounding.reason ?? "ungrounded"}`)
    } else {
      legalGate = {
        status: "ok",
        markdown: "",
        officialSourceCount: grounding.officialSourceCount,
        primaryOfficialCount: grounding.primaryOfficialCount,
        agencyGuidanceCount: grounding.agencyGuidanceCount,
        sensitiveTopics,
        requireCounsel,
        counselNote,
        recommendedExpertId,
      }
      if (grounding.reason === "agency_guidance_only") {
        toolsUsed.push("legal:agency_guidance_only")
      }
      if (requireCounsel) {
        toolsUsed.push(
          `legal:sensitive:${sensitiveTopics.map((t) => t.id).join(",")}`,
        )
      }
    }
  }

  if (agentMode) {
    toolsUsed.push(`agent_mode:${agentMode}`)
  }

  const jurisdiction = effectiveJurisdiction

  const market = plan.runMarketData
    ? await marketDataLookup({
        buildingName: property?.buildingName ?? buildingFilter,
        cityLabel: property?.cityLabel ?? jurisdiction.cityLabel,
        stateCode: property?.stateCode ?? jurisdiction.stateCode,
        addressLine: property?.addressLine ?? null,
        portfolioMonthlyRent: property?.portfolioMonthlyRent ?? null,
      })
    : null

  const priceHistory =
    intentResult.intent === "price_history_ambiguous"
      ? await propertyPriceHistoryLookup({
          buildingName: property?.buildingName ?? buildingFilter,
          clarifyOnly: true,
        })
      : plan.runPriceHistory
        ? await propertyPriceHistoryLookup({
            buildingName: property?.buildingName ?? buildingFilter,
            addressLine: property?.addressLine ?? null,
          })
        : null

  const rentHistory = plan.runRentHistory
    ? await rentHistoryLookup({
        buildingName: property?.buildingName ?? buildingFilter,
        cityLabel: property?.cityLabel ?? jurisdiction.cityLabel,
        stateCode: property?.stateCode ?? jurisdiction.stateCode,
        addressLine: property?.addressLine ?? null,
      })
    : null

  let ops:
    | { bullets: string[]; citations: AskUloCitation[] }
    | null = null

  if (opsRaw && plan.opsMode === "full") {
    ops = { bullets: opsRaw.bullets, citations: opsRaw.citations }
    toolsUsed.push("ops_graph")
  } else if (opsRaw && plan.opsMode === "leasing_impact") {
    const impact = leasingImpactFromOpsBullets(opsRaw.bullets)
    if (impact.length) {
      ops = { bullets: impact, citations: [] }
      toolsUsed.push("ops_leasing_impact")
    }
  } else if (opsRaw && plan.opsMode === "legal_context") {
    const legalOps = legalOpsContextFromOpsBullets(opsRaw.bullets)
    if (legalOps.length) {
      ops = { bullets: legalOps, citations: opsRaw.citations.slice(0, 2) }
      toolsUsed.push("ops_legal_context")
    }
  }

  if (legal && legalGate?.status === "ok") toolsUsed.push("legal_rag")
  if (structured?.relevant && (intentResult.intent !== "legal" || legalGate?.status === "ok")) {
    toolsUsed.push("structured")
  }
  if (propertyForSynthesis ?? property) toolsUsed.push("property_snapshot")
  if (portfolioBriefing?.available) toolsUsed.push("portfolio_briefing")
  else if (portfolioBriefing) toolsUsed.push("portfolio_briefing:unavailable")
  if (propertyInsightsForAnswer?.found) toolsUsed.push("property_insights")
  else if (propertyInsightsForAnswer?.available) toolsUsed.push("property_insights:none")
  else if (propertyInsightsForAnswer) toolsUsed.push("property_insights:unavailable")
  if (recurringRepairs?.found) toolsUsed.push("recurring_repairs")
  else if (recurringRepairs?.available) toolsUsed.push("recurring_repairs:none")
  else if (recurringRepairs) toolsUsed.push("recurring_repairs:unavailable")
  if (repairsToApprove?.found) toolsUsed.push("repairs_to_approve")
  else if (repairsToApprove?.available) toolsUsed.push("repairs_to_approve:none")
  else if (repairsToApprove) toolsUsed.push("repairs_to_approve:unavailable")
  if (residentsList?.found) toolsUsed.push("search_residents")
  else if (residentsList?.available) toolsUsed.push("search_residents:none")
  else if (residentsList) toolsUsed.push("search_residents:unavailable")
  if (draftCommunicationResult?.markdown) {
    toolsUsed.push(`draft_communication:${draftCommunicationResult.kind}`)
  }
  if (activeWorkflowsResult?.available) {
    toolsUsed.push(
      activeWorkflowsResult.found
        ? "list_active_workflows"
        : "list_active_workflows:none",
    )
  } else if (activeWorkflowsResult) {
    toolsUsed.push("list_active_workflows:unavailable")
  }
  if (weatherAlertsResult?.available) {
    toolsUsed.push(
      weatherAlertsResult.found ? "get_weather_alerts" : "get_weather_alerts:none",
    )
  } else if (weatherAlertsResult) {
    toolsUsed.push("get_weather_alerts:unavailable")
  }
  if (landlordIncentivesResult?.available) {
    toolsUsed.push(
      landlordIncentivesResult.found
        ? "get_landlord_incentives"
        : "get_landlord_incentives:none",
    )
  } else if (landlordIncentivesResult) {
    toolsUsed.push("get_landlord_incentives:unavailable")
  }
  if (missingUpdates?.found) toolsUsed.push("missing_updates")
  else if (missingUpdates?.available) toolsUsed.push("missing_updates:none")
  else if (missingUpdates) toolsUsed.push("missing_updates:unavailable")
  if (vendorResponseSpeed?.found) toolsUsed.push("vendor_response_speed")
  else if (vendorResponseSpeed?.available) toolsUsed.push("vendor_response_speed:none")
  else if (vendorResponseSpeed) toolsUsed.push("vendor_response_speed:unavailable")
  if (vendorBest?.found) toolsUsed.push("vendor_best")
  else if (vendorBest?.available) toolsUsed.push("vendor_best:none")
  else if (vendorBest) toolsUsed.push("vendor_best:unavailable")
  if (vendorBest?.external?.found) toolsUsed.push("vendor_external")
  else if (vendorBest?.external?.available) toolsUsed.push("vendor_external:none")
  if (vendorCompletion?.found) toolsUsed.push("vendor_completion")
  else if (vendorCompletion?.available) toolsUsed.push("vendor_completion:none")
  else if (vendorCompletion) toolsUsed.push("vendor_completion:unavailable")
  if (vendorInactive?.found) toolsUsed.push("vendor_inactive")
  else if (vendorInactive?.available) toolsUsed.push("vendor_inactive:none")
  else if (vendorInactive) toolsUsed.push("vendor_inactive:unavailable")
  if (vendorOverload?.found) toolsUsed.push("vendor_overload")
  else if (vendorOverload?.available) toolsUsed.push("vendor_overload:none")
  else if (vendorOverload) toolsUsed.push("vendor_overload:unavailable")
  if (vendorVerification?.found) toolsUsed.push("vendor_verification")
  else if (vendorVerification?.available) toolsUsed.push("vendor_verification:none")
  else if (vendorVerification) toolsUsed.push("vendor_verification:unavailable")
  toolsUsed.push(`playbook:${playbook.id}`)
  toolsUsed.push(`subject:${evidencePlan.subject}`)
  toolsUsed.push(`capability:${capabilityResult.capability}`)
  toolsUsed.push(
    `capability_route:${capabilityRoute.requiredTools.join("+") || "none"}`,
  )
  if (evidencePlan.blockPropertyDashboard) {
    toolsUsed.push("subject_gate:block_property_dashboard")
  }
  if (propertyRanking?.canRank) toolsUsed.push("property_ranking")
  else if (propertyRanking?.available) toolsUsed.push("property_ranking:incomplete")
  else if (propertyRanking) toolsUsed.push("property_ranking:unavailable")
  if (unitMaintenanceRanking?.canRank) toolsUsed.push("unit_maintenance_ranking")
  else if (unitMaintenanceRanking?.available) {
    toolsUsed.push("unit_maintenance_ranking:incomplete")
  } else if (unitMaintenanceRanking) {
    toolsUsed.push("unit_maintenance_ranking:unavailable")
  }
  if (periodSummary?.canSummarize) toolsUsed.push("period_summary")
  else if (periodSummary?.available) toolsUsed.push("period_summary:incomplete")
  else if (periodSummary) toolsUsed.push("period_summary:unavailable")
  if (oldestWaitingWorkOrder?.found) toolsUsed.push("oldest_waiting_work_order")
  else if (oldestWaitingWorkOrder?.available) toolsUsed.push("oldest_waiting_work_order:none")
  else if (oldestWaitingWorkOrder) toolsUsed.push("oldest_waiting_work_order:unavailable")
  if (entityInvestigation?.found) toolsUsed.push("entity_investigation")
  else if (entityInvestigation?.available) toolsUsed.push("entity_investigation:none")
  else if (entityInvestigation) toolsUsed.push("entity_investigation:unavailable")
  if (deepOpsInvestigation?.found) toolsUsed.push("deep_ops_investigation")
  else if (deepOpsInvestigation?.available) toolsUsed.push("deep_ops_investigation:none")
  else if (deepOpsInvestigation) toolsUsed.push("deep_ops_investigation:unavailable")
  if (analytical.isUnitMaintenanceVolumeRanking) {
    toolsUsed.push(
      `analytical:entity=${analytical.entity};metric=${analytical.metric};ranking=${analytical.ranking}`,
    )
  }
  if (market?.available) toolsUsed.push(`market_data:${market.provider}`)
  else if (market) toolsUsed.push("market_data:unavailable")
  if (priceHistory?.available) toolsUsed.push("price_history")
  else if (priceHistory?.needsClarification) toolsUsed.push("price_history:clarify")
  else if (priceHistory) toolsUsed.push("price_history:unavailable")
  if (rentHistory?.available) toolsUsed.push("rent_history")
  else if (rentHistory) toolsUsed.push("rent_history:unavailable")

  const reasoning = reasoningEarly
  const narrowFactual =
    isNarrowFactualOpsQuestion(question) && reasoning.mode === "factual"

  // Hard subject gate: never feed property dashboard packets into synthesis
  // for vendor / resident / work-order / etc. questions.
  const gatedPropertyRanking = propertyDashboardLock ? null : propertyRanking
  const gatedPortfolioBriefing = propertyDashboardLock ? null : portfolioBriefing

  const synthesis = await synthesizeAskUloAnswer({
    question,
    history,
    intent: intentResult.intent,
    intentLabel: intentResult.label,
    jurisdiction: {
      countryCode: jurisdiction.countryCode,
      stateCode: jurisdiction.stateCode,
      countySlug: jurisdiction.countySlug,
      countyLabel: jurisdiction.countyLabel,
      cityLabel: jurisdiction.cityLabel,
      citySlug: jurisdiction.citySlug,
      courtSystem: jurisdiction.courtSystem,
      housingProgram: jurisdiction.housingProgram,
      codeSet: jurisdiction.codeSet,
    },
    legalGate,
    fairHousing: fairHousingSafety.refuseDecision ? fairHousingSafety : null,
    humanDecision: humanDecisionSafety.refuseDecision ? humanDecisionSafety : null,
    screeningIsolation,
    ops: screeningIsolation ? null : ops,
    legal:
      legalGate?.status === "ok" && legal
        ? {
            bullets: legal.bullets,
            citations: legal.citations,
            mode: legal.mode,
            pendingOrdinanceCount: legal.pendingOrdinanceCount,
          }
        : null,
    structured:
      legalGate?.status === "ok" && structured?.relevant
        ? {
            bullets: structured.bullets,
            citations: structured.citations,
            facts: structured.facts,
          }
        : intentResult.intent !== "legal" && structured?.relevant
          ? {
              bullets: structured.bullets,
              citations: structured.citations,
              facts: structured.facts,
            }
          : null,
    property: propertyForSynthesis
      ? {
          bullets: propertyForSynthesis.bullets,
          citations: propertyForSynthesis.citations,
          buildingName: propertyForSynthesis.buildingName,
        }
      : null,
    market: market
      ? {
          available: market.available,
          provider: market.provider,
          bullets: market.bullets,
          citations: market.citations,
          gapNote: market.gapNote,
          estimatedRent: market.estimatedRent,
          rentRangeLow: market.rentRangeLow,
          rentRangeHigh: market.rentRangeHigh,
        }
      : null,
    priceHistory: priceHistory
      ? {
          available: priceHistory.available,
          bullets: priceHistory.bullets,
          citations: priceHistory.citations,
          events: priceHistory.events,
          summary: priceHistory.summary,
          drivers: priceHistory.drivers,
          gapNote: priceHistory.gapNote,
          needsClarification: priceHistory.needsClarification,
          clarificationPrompt: priceHistory.clarificationPrompt,
          markdown: formatPriceHistoryMarkdown(priceHistory),
        }
      : null,
    rentHistory: rentHistory
      ? {
          available: rentHistory.available,
          bullets: rentHistory.bullets,
          citations: rentHistory.citations,
          gapNote: rentHistory.gapNote,
          markdown: formatRentHistoryMarkdown(rentHistory),
        }
      : null,
    portfolioBriefing: gatedPortfolioBriefing
      ? {
          available: gatedPortfolioBriefing.available,
          assessment: gatedPortfolioBriefing.assessment,
          healthScore: gatedPortfolioBriefing.healthScore,
          healthDelta4w: gatedPortfolioBriefing.healthDelta4w,
          bullets: gatedPortfolioBriefing.bullets,
          citations: gatedPortfolioBriefing.citations,
          markdown: gatedPortfolioBriefing.markdown,
          facts: gatedPortfolioBriefing.facts,
        }
      : null,
    propertyInsights: propertyInsightsForAnswer
      ? {
          available: propertyInsightsForAnswer.available,
          found: propertyInsightsForAnswer.found,
          bullets: propertyInsightsForAnswer.bullets,
          citations: propertyInsightsForAnswer.citations,
          markdown: propertyInsightsForAnswer.markdown,
          insights: propertyInsightsForAnswer.insights.map((i) => ({
            tag: i.tag,
            text: i.text,
            requestCount: i.requestCount ?? null,
            building: i.building ?? null,
            unitLabel: i.unitLabel ?? null,
            categoryLabel: i.categoryLabel ?? null,
          })),
          sufficientForMaintenanceRisk: propertyInsightsForAnswer.sufficientForMaintenanceRisk,
        }
      : null,
    recurringRepairs: recurringRepairs
      ? {
          available: recurringRepairs.available,
          found: recurringRepairs.found,
          bullets: recurringRepairs.bullets,
          citations: recurringRepairs.citations,
          markdown: recurringRepairs.markdown,
          ticketCount: recurringRepairs.ticketCount,
          completedTicketCount: recurringRepairs.completedTicketCount,
          completedWorkflowCount: recurringRepairs.completedWorkflowCount,
          windowDays: recurringRepairs.windowDays,
          patterns: recurringRepairs.patterns.map((p) => ({
            kind: p.kind,
            label: p.label,
            repairTypeId: p.repairTypeId,
            repairTypeLabel: p.repairTypeLabel,
            count: p.count,
            building: p.building,
            unitLabel: p.unitLabel,
            categoryFamily: p.categoryFamily,
            completedCount: p.completedCount,
            openCount: p.openCount,
            reopenedAfterCompletion: p.reopenedAfterCompletion,
          })),
        }
      : null,
    repairsToApprove: repairsToApprove
      ? {
          available: repairsToApprove.available,
          found: repairsToApprove.found,
          bullets: repairsToApprove.bullets,
          citations: repairsToApprove.citations,
          markdown: repairsToApprove.markdown,
          openUrgentCount: repairsToApprove.openUrgentCount,
          awaitingCount: repairsToApprove.awaitingCount,
          items: repairsToApprove.items.map((i) => ({
            kind: i.kind,
            label: i.label,
            building: i.building,
            unitLabel: i.unitLabel,
            reason: i.reason,
            priority: i.priority,
          })),
        }
      : null,
    residents: residentsList
      ? {
          available: residentsList.available,
          found: residentsList.found,
          bullets: residentsList.bullets,
          citations: residentsList.citations,
          markdown: residentsList.markdown,
          filter: String(residentsList.params.filter ?? "late_rent"),
          residents: residentsList.residents.map((r) => ({
            residentId: r.residentId,
            name: r.name,
            unitLabel: r.unitLabel,
            propertyName: r.propertyName,
            balanceDue: r.balanceDue,
            daysOverdue: r.daysOverdue,
            moveInDate: r.moveInDate,
            awaitingReplyHours: r.awaitingReplyHours,
          })),
        }
      : null,
    missingUpdates: missingUpdates
      ? {
          available: missingUpdates.available,
          found: missingUpdates.found,
          bullets: missingUpdates.bullets,
          citations: missingUpdates.citations,
          markdown: missingUpdates.markdown,
          openCount: missingUpdates.openCount,
          items: missingUpdates.items.map((i) => ({
            displayId: i.displayId,
            label: i.label,
            building: i.building,
            unitLabel: i.unitLabel,
            whyMissing: i.whyMissing,
            daysWaiting: i.daysWaiting,
            status: i.status,
          })),
        }
      : null,
    vendorResponseSpeed: vendorResponseSpeed
      ? {
          available: vendorResponseSpeed.available,
          found: vendorResponseSpeed.found,
          bullets: vendorResponseSpeed.bullets,
          citations: vendorResponseSpeed.citations,
          markdown: vendorResponseSpeed.markdown,
          ranked: vendorResponseSpeed.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            avgResponseMinutes: r.avgResponseMinutes,
            acceptedJobs: r.acceptedJobs,
            completedJobs: r.completedJobs,
            responseSpeedScore: r.responseSpeedScore,
          })),
        }
      : null,
    vendorBest: vendorBest
      ? {
          available: vendorBest.available,
          found: vendorBest.found,
          bullets: vendorBest.bullets,
          citations: vendorBest.citations,
          markdown: vendorBest.markdown,
          tradeSlug: vendorBest.tradeSlug,
          tradeLabel: vendorBest.tradeLabel,
          ranked: vendorBest.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            category: r.category,
            vendorScore: r.vendorScore,
            residentSatisfaction: r.residentSatisfaction,
            reviewCount: r.reviewCount,
            completedJobs: r.completedJobs,
            acceptedJobs: r.acceptedJobs,
            avgResponseMinutes: r.avgResponseMinutes,
            completionRate: r.completionRate,
          })),
        }
      : null,
    vendorCompletion: vendorCompletion
      ? {
          available: vendorCompletion.available,
          found: vendorCompletion.found,
          bullets: vendorCompletion.bullets,
          citations: vendorCompletion.citations,
          markdown: vendorCompletion.markdown,
          ranked: vendorCompletion.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            completionRate: r.completionRate,
            completedJobs: r.completedJobs,
            acceptedJobs: r.acceptedJobs,
          })),
        }
      : null,
    vendorInactive: vendorInactive
      ? {
          available: vendorInactive.available,
          found: vendorInactive.found,
          bullets: vendorInactive.bullets,
          citations: vendorInactive.citations,
          markdown: vendorInactive.markdown,
          ranked: vendorInactive.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            pendingAcceptJobs: r.pendingAcceptJobs,
            acceptedJobs: r.acceptedJobs,
            lastAssignedAt: r.lastAssignedAt,
            daysSinceAssigned: r.daysSinceAssigned,
            reason: r.reason,
          })),
        }
      : null,
    vendorOverload: vendorOverload
      ? {
          available: vendorOverload.available,
          found: vendorOverload.found,
          bullets: vendorOverload.bullets,
          citations: vendorOverload.citations,
          markdown: vendorOverload.markdown,
          ranked: vendorOverload.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            openJobs: r.openJobs,
            pendingAccept: r.pendingAccept,
            accepted: r.accepted,
            inProgress: r.inProgress,
            oldestOpenDays: r.oldestOpenDays,
          })),
        }
      : null,
    vendorVerification: vendorVerification
      ? {
          available: vendorVerification.available,
          found: vendorVerification.found,
          bullets: vendorVerification.bullets,
          citations: vendorVerification.citations,
          markdown: vendorVerification.markdown,
          ranked: vendorVerification.ranked.map((r) => ({
            vendorId: r.vendorId,
            name: r.name,
            verificationStatus: r.verificationStatus,
            verificationLabel: r.verificationLabel,
            capacityLabel: r.capacityLabel,
            checklistComplete: r.checklistComplete,
            checklistRequired: r.checklistRequired,
            missingReasons: r.missingReasons,
          })),
        }
      : null,
    investigationPlaybook: {
      id: playbook.id,
      preferTier1Answer: playbook.preferTier1Answer,
      consultTier1First: playbook.consultTier1First,
      deepOpsPrimary: playbook.deepOpsPrimary,
    },
    propertyRanking: gatedPropertyRanking
      ? {
          available: gatedPropertyRanking.available,
          canRank: gatedPropertyRanking.canRank,
          missingData: gatedPropertyRanking.missingData,
          bullets: gatedPropertyRanking.bullets,
          citations: gatedPropertyRanking.citations,
          markdown: gatedPropertyRanking.markdown,
          portfolioOpenWorkOrders: gatedPropertyRanking.portfolioOpenWorkOrders,
          top: gatedPropertyRanking.top
            ? {
                building: gatedPropertyRanking.top.building,
                whyLines: gatedPropertyRanking.top.whyLines,
                recommendedActions: gatedPropertyRanking.top.recommendedActions,
                openWorkOrders: gatedPropertyRanking.top.openWorkOrders,
                criticalWorkOrders: gatedPropertyRanking.top.criticalWorkOrders,
                agingWorkOrders: gatedPropertyRanking.top.agingWorkOrders,
                escalatedWorkflows: gatedPropertyRanking.top.escalatedWorkflows,
                healthScore: gatedPropertyRanking.top.healthScore,
                healthDelta4w: gatedPropertyRanking.top.healthDelta4w,
              }
            : null,
          watch: gatedPropertyRanking.watch.map((w) => ({
            building: w.building,
            whyLines: w.whyLines,
            openWorkOrders: w.openWorkOrders,
          })),
        }
      : null,
    unitMaintenanceRanking: unitMaintenanceRanking
      ? {
          available: unitMaintenanceRanking.available,
          canRank: unitMaintenanceRanking.canRank,
          missingData: unitMaintenanceRanking.missingData,
          bullets: unitMaintenanceRanking.bullets,
          citations: unitMaintenanceRanking.citations,
          markdown: unitMaintenanceRanking.markdown,
          timeframeLabel: unitMaintenanceRanking.timeframeLabel,
          timeframeDays: unitMaintenanceRanking.timeframeDays,
          timeframeIsDefault: unitMaintenanceRanking.timeframeIsDefault,
          scopeLabel: unitMaintenanceRanking.scopeLabel,
          unlinkedRequestCount: unitMaintenanceRanking.unlinkedRequestCount,
          scopedRequestCount: unitMaintenanceRanking.scopedRequestCount,
          openInScope: unitMaintenanceRanking.openInScope,
          top: unitMaintenanceRanking.top
            ? {
                unitLabel: unitMaintenanceRanking.top.unitLabel,
                building: unitMaintenanceRanking.top.building,
                totalRequests: unitMaintenanceRanking.top.totalRequests,
                recentRequests: unitMaintenanceRanking.top.recentRequests,
                openRequests: unitMaintenanceRanking.top.openRequests,
                mostCommonCategory: unitMaintenanceRanking.top.mostCommonCategory,
              }
            : null,
          ranked: unitMaintenanceRanking.ranked.map((r) => ({
            unitLabel: r.unitLabel,
            building: r.building,
            totalRequests: r.totalRequests,
            recentRequests: r.recentRequests,
            openRequests: r.openRequests,
            mostCommonCategory: r.mostCommonCategory,
          })),
        }
      : null,
    periodSummary: periodSummary
      ? {
          available: periodSummary.available,
          canSummarize: periodSummary.canSummarize,
          missingData: periodSummary.missingData,
          bullets: periodSummary.bullets,
          citations: periodSummary.citations,
          markdown: periodSummary.markdown,
          periodLabel: periodSummary.periodLabel,
          periodDays: periodSummary.periodDays,
          periodIsDefault: periodSummary.periodIsDefault,
          scopeLabel: periodSummary.scopeLabel,
          facts: periodSummary.facts as unknown as Record<string, unknown>,
        }
      : null,
    oldestWaitingWorkOrder: oldestWaitingWorkOrder
      ? {
          available: oldestWaitingWorkOrder.available,
          found: oldestWaitingWorkOrder.found,
          missingData: oldestWaitingWorkOrder.missingData,
          bullets: oldestWaitingWorkOrder.bullets,
          citations: oldestWaitingWorkOrder.citations,
          markdown: oldestWaitingWorkOrder.markdown,
          openCount: oldestWaitingWorkOrder.openCount,
          oldest: oldestWaitingWorkOrder.oldest
            ? {
                displayId: oldestWaitingWorkOrder.oldest.displayId,
                building: oldestWaitingWorkOrder.oldest.building,
                unit: oldestWaitingWorkOrder.oldest.unit,
                issueCategory: oldestWaitingWorkOrder.oldest.issueCategory,
                description: oldestWaitingWorkOrder.oldest.description,
                status: oldestWaitingWorkOrder.oldest.status,
                daysWaiting: oldestWaitingWorkOrder.oldest.daysWaiting,
                vendorName: oldestWaitingWorkOrder.oldest.vendorName,
                reasonWaiting: oldestWaitingWorkOrder.oldest.reasonWaiting,
                recommendedAction: oldestWaitingWorkOrder.oldest.recommendedAction,
              }
            : null,
        }
      : null,
    entityInvestigation: entityInvestigation
      ? {
          available: entityInvestigation.available,
          found: entityInvestigation.found,
          missingData: entityInvestigation.missingData,
          bullets: entityInvestigation.bullets,
          citations: entityInvestigation.citations,
          markdown: entityInvestigation.markdown,
          primary: entityInvestigation.primary
            ? {
                displayId: entityInvestigation.primary.displayId,
                building: entityInvestigation.primary.building,
                unit: entityInvestigation.primary.unit,
                issueCategory: entityInvestigation.primary.issueCategory,
                description: entityInvestigation.primary.description,
                status: entityInvestigation.primary.status,
                daysOpen: entityInvestigation.primary.daysOpen,
                vendorName: entityInvestigation.primary.vendorName,
                rootCause: entityInvestigation.primary.rootCause,
                recommendedAction: entityInvestigation.primary.recommendedAction,
              }
            : null,
        }
      : null,
    deepOpsInvestigation: deepOpsInvestigation
      ? {
          available: deepOpsInvestigation.available,
          found: deepOpsInvestigation.found,
          missingFields: deepOpsInvestigation.missingFields,
          bullets: deepOpsInvestigation.bullets,
          citations: deepOpsInvestigation.citations,
          markdown: deepOpsInvestigation.markdown,
          categories: deepOpsInvestigation.plan.categories,
          isRepairCostQuestion: deepOpsInvestigation.plan.isRepairCostQuestion,
          ticketCount: deepOpsInvestigation.workOrders.length ||
            deepOpsInvestigation.tickets.length,
          workOrders: deepOpsInvestigation.workOrders.map((w) => ({
            workOrderId: w.workOrderId,
            maintenanceRequestId: w.maintenanceRequestId,
            propertyName: w.propertyName,
            unitLabel: w.unitLabel,
            category: w.category,
            title: w.title,
            description: w.description,
            priority: w.priority,
            estimatedCost: w.estimatedCost,
            estimatedCostSource: w.estimatedCostSource,
            repairScope: w.repairScope,
            laborEstimate: w.laborEstimate,
            workflowStage: w.workflowStage,
            vendorName: w.vendorName,
            slaExpired: w.slaExpired,
            approvalStatus: w.approvalStatus,
          })),
          operationalEvidenceJson: JSON.stringify(
            { workOrders: deepOpsInvestigation.workOrders },
            null,
            2,
          ),
        }
      : null,
    reasoningMode: reasoning.mode,
    responseFormat: classifyResponseFormat(question),
    narrowFactual,
    toolsUsed,
  })

  const placeBits = [
    jurisdiction.cityLabel,
    jurisdiction.countyLabel ? `${jurisdiction.countyLabel} County` : null,
    jurisdiction.stateCode,
  ].filter(Boolean)
  const jurisdictionLabel = placeBits.length > 0 ? placeBits.join(", ") : null

  const sourcesUsed =
    intentResult.intent === "legal"
      ? buildSourcesUsed({
          citations: synthesis.citations,
          propertyBuildingName: propertyForSynthesis?.buildingName ?? property?.buildingName,
          propertyBullets: propertyForSynthesis?.bullets ?? property?.bullets,
          hasOpsContext: Boolean(ops?.bullets.length),
          housingProgram: jurisdiction.housingProgram,
          jurisdictionLabel,
        })
      : []

  const answerConfidence =
    intentResult.intent === "legal"
      ? assessAnswerConfidence({
          intent: intentResult.intent,
          gateStatus: legalGate?.status ?? null,
          requireCounsel,
          primaryOfficialCount:
            legalGate?.primaryOfficialCount ?? sourceTierCounts.primaryOfficial,
          agencyGuidanceCount:
            legalGate?.agencyGuidanceCount ?? sourceTierCounts.agencyGuidance,
          discoveryMirrorCount: sourceTierCounts.discoveryMirror,
          pendingOrdinanceCount: legal?.pendingOrdinanceCount ?? 0,
          hasPortfolioContext: Boolean(
            propertyForSynthesis?.bullets.length || property?.bullets.length,
          ),
        })
      : ("medium" as AnswerConfidence)

  let answerWithSources = synthesis.answer

  // Prefer structured draft / resident / active-workflow packets over cross-subject synthesis.
  // Incomplete ranking is a structured signal — code owns the message (never LLM invent+censor).
  const incompleteRankingPrefer = resolveIncompleteRankingSignal({
    propertyRanking: gatedPropertyRanking
      ? {
          available: gatedPropertyRanking.available,
          canRank: gatedPropertyRanking.canRank,
          missingData: gatedPropertyRanking.missingData,
          portfolioOpenWorkOrders: gatedPropertyRanking.portfolioOpenWorkOrders,
        }
      : null,
    unitMaintenanceRanking: unitMaintenanceRanking
      ? {
          available: unitMaintenanceRanking.available,
          canRank: unitMaintenanceRanking.canRank,
          missingData: unitMaintenanceRanking.missingData,
          requestCount: unitMaintenanceRanking.scopedRequestCount,
          unlinkedRequestCount: unitMaintenanceRanking.unlinkedRequestCount,
          timeframeLabel: unitMaintenanceRanking.timeframeLabel,
          scopeLabel: unitMaintenanceRanking.scopeLabel,
        }
      : null,
    reasoningMode: reasoningEarly.mode,
    preferUnit:
      intentResult.intent === "unit_maintenance_ranking" ||
      needsUnitRanking,
  })
  const rankingPrimaryPrefer =
    intentResult.intent === "property_priority" ||
    intentResult.intent === "unit_maintenance_ranking" ||
    reasoningEarly.mode === "comparison_ranking" ||
    reasoningEarly.mode === "diagnosis" ||
    reasoningEarly.mode === "recommendation"

  if (incompleteRankingPrefer && rankingPrimaryPrefer) {
    answerWithSources = incompleteRankingPrefer.markdown
    toolsUsed.push(
      `prefer_packet:incomplete_${incompleteRankingPrefer.kind}:${incompleteRankingPrefer.status}`,
    )
    console.log(
      "ASK_ULO_INCOMPLETE_EVIDENCE",
      JSON.stringify({
        kind: incompleteRankingPrefer.kind,
        status: incompleteRankingPrefer.status,
        missing: incompleteRankingPrefer.missing,
        known: incompleteRankingPrefer.known,
        authority: "code",
      }),
    )
  } else if (draftCommunicationResult?.markdown) {
    answerWithSources = draftCommunicationResult.markdown
    toolsUsed.push("prefer_packet:draft_communication")
  } else if (activeWorkflowsResult?.available && activeWorkflowsResult.markdown) {
    answerWithSources = activeWorkflowsResult.markdown
    toolsUsed.push("prefer_packet:list_active_workflows")
  } else if (weatherAlertsResult?.available && weatherAlertsResult.markdown) {
    answerWithSources = weatherAlertsResult.markdown
    toolsUsed.push("prefer_packet:get_weather_alerts")
  } else if (landlordIncentivesResult?.available && landlordIncentivesResult.markdown) {
    answerWithSources = landlordIncentivesResult.markdown
    toolsUsed.push("prefer_packet:get_landlord_incentives")
  } else if (residentsList?.available && residentsList.markdown) {
    answerWithSources = residentsList.markdown
    toolsUsed.push("prefer_packet:search_residents")
  } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
    answerWithSources = catchAllWorkOrders.markdown
    toolsUsed.push("prefer_packet:catchall_search_work_orders")
  } else if (
    (noToolMatched || (attemptCatchAll && !catchAllWorkOrders?.found)) &&
    !specialtyPacketAlready
  ) {
    const toolMiss = buildToolMissIncompleteSignal({
      noToolMatched,
      catchallNone: Boolean(attemptCatchAll && !catchAllWorkOrders?.found),
      subject: evidencePlan.subject,
      openWorkOrders:
        typeof gatedPortfolioBriefing?.facts?.openWorkOrders === "number"
          ? gatedPortfolioBriefing.facts.openWorkOrders
          : null,
    })
    if (toolMiss) {
      answerWithSources = toolMiss.markdown
      toolsUsed.push(
        `prefer_packet:incomplete_${toolMiss.kind}:${toolMiss.status}`,
      )
      console.log(
        "ASK_ULO_INCOMPLETE_EVIDENCE",
        JSON.stringify({
          kind: toolMiss.kind,
          status: toolMiss.status,
          missing: toolMiss.missing,
          known: toolMiss.known,
          authority: "code",
        }),
      )
    }
  } else if (
    isHonestGapSubjectQuestion(question) &&
    capabilityResult.capability !== "draft" &&
    !isWeatherAlertsQuestion(question) &&
    !isLandlordIncentivesQuestion(question) &&
    /\b(forecast|predict|might\s+not\s+renew|before\s+winter|most\s+likely\s+to\s+need)\b/i
      .test(question)
  ) {
    answerWithSources = incompleteSubjectGapAnswer({
      subject: evidencePlan.subject,
      openCount:
        typeof gatedPortfolioBriefing?.facts?.openWorkOrders === "number"
          ? gatedPortfolioBriefing.facts.openWorkOrders
          : null,
      residentFilter: capabilityResult.hints.residentFilter ?? null,
      capability: capabilityResult.capability,
      question,
    })
    toolsUsed.push("prefer_packet:honest_gap")
  }

  // Mark tool-miss prefer as satisfying task packet so quality gates don't rewrite to briefing.
  const toolMissPreferActive = toolsUsed.some((t) =>
    t.startsWith("prefer_packet:incomplete_tool_miss") ||
    t.startsWith("prefer_packet:incomplete_catchall_none"),
  )

  const qualityReport = runAnswerQualityGate({
    intent: intentResult.intent,
    intentLabel: intentResult.label,
    toolsPlanned: plannedToolNames(plan),
    jurisdiction: legalResolution,
    needsPropertyScope,
    stateCode: jurisdiction.stateCode,
    citySlug: jurisdiction.citySlug,
    housingProgram: jurisdiction.housingProgram,
    ranLegalSearch: Boolean(legal && runLegalTools),
    ranTopicTools: toolsUsed.some((t) =>
      /^(ops_graph|legal_rag|structured|property_snapshot|market_data|price_history|rent_history|portfolio_briefing)/.test(
        t,
      ),
    ),
    primaryOfficial: sourceTierCounts.primaryOfficial,
    agencyGuidance: sourceTierCounts.agencyGuidance,
    discoveryMirror: sourceTierCounts.discoveryMirror,
    untrusted: sourceTierCounts.untrusted,
    citationCount: synthesis.citations.length,
    pendingOrdinanceCount: legal?.pendingOrdinanceCount ?? 0,
    gateStatus: legalGate?.status ?? null,
    grounded: intentResult.intent === "legal" ? groundingOk : true,
    groundingReason,
    officialSourceCount: legalGate?.officialSourceCount ?? 0,
    draftAnswer: synthesis.answer,
    question,
    taskPacketSatisfied: Boolean(
      toolMissPreferActive ||
        oldestWaitingWorkOrder?.found ||
        (unitMaintenanceRanking?.canRank && unitMaintenanceRanking.top) ||
        (unitMaintenanceRanking?.available && !unitMaintenanceRanking.canRank) ||
        (periodSummary?.canSummarize && periodSummary.markdown) ||
        (gatedPropertyRanking?.canRank && gatedPropertyRanking.top) ||
        (gatedPropertyRanking?.available && !gatedPropertyRanking.canRank) ||
        (gatedPortfolioBriefing?.available && gatedPortfolioBriefing.markdown) ||
        (draftCommunicationResult?.markdown) ||
        (activeWorkflowsResult?.available && activeWorkflowsResult.markdown) ||
        (weatherAlertsResult?.available && weatherAlertsResult.markdown) ||
        (landlordIncentivesResult?.available && landlordIncentivesResult.markdown) ||
        (residentsList?.available && residentsList.markdown) ||
        (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) ||
        (repairsToApprove?.available && repairsToApprove.markdown) ||
        (missingUpdates?.available && missingUpdates.markdown) ||
        (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) ||
        (vendorBest?.available && vendorBest.markdown) ||
        (vendorCompletion?.available && vendorCompletion.markdown) ||
        (vendorInactive?.available && vendorInactive.markdown) ||
        (vendorOverload?.available && vendorOverload.markdown) ||
        (vendorVerification?.available && vendorVerification.markdown) ||
        (recurringRepairs?.available && recurringRepairs.markdown) ||
        (propertyInsightsForAnswer?.found && propertyInsightsForAnswer.markdown) ||
        (deepOpsInvestigation?.found && deepOpsInvestigation.markdown),
    ),
    subjectPacketSatisfied: Boolean(
      (draftCommunicationResult?.markdown) ||
        (activeWorkflowsResult?.available && activeWorkflowsResult.markdown) ||
        (weatherAlertsResult?.available && weatherAlertsResult.markdown) ||
        (landlordIncentivesResult?.available && landlordIncentivesResult.markdown) ||
        (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) ||
        (vendorBest?.available && vendorBest.markdown) ||
        (vendorCompletion?.available && vendorCompletion.markdown) || (vendorInactive?.available && vendorInactive.markdown) ||
        (vendorOverload?.available && vendorOverload.markdown) ||
        (vendorVerification?.available && vendorVerification.markdown),
    ),
    metricPacketSatisfied: Boolean(
      playbook.id === "vendor_best"
        ? vendorBest?.available && vendorBest.markdown
        : playbook.id === "vendor_speed"
          ? vendorResponseSpeed?.available && vendorResponseSpeed.markdown
          : playbook.id === "vendor_completion"
            ? vendorCompletion?.available && vendorCompletion.markdown
            : playbook.id === "vendor_inactive"
              ? vendorInactive?.available && vendorInactive.markdown
              : playbook.id === "vendor_overload"
                ? vendorOverload?.available && vendorOverload.markdown
                : playbook.id === "vendor_verification"
                  ? vendorVerification?.available && vendorVerification.markdown
                : (vendorBest?.available && vendorBest.markdown) ||
                  (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) ||
                  (vendorCompletion?.available && vendorCompletion.markdown) ||
                  (vendorInactive?.available && vendorInactive.markdown) ||
                  (vendorOverload?.available && vendorOverload.markdown) ||
                  (vendorVerification?.available && vendorVerification.markdown),
    ),
    entityPacketSatisfied: Boolean(
      entityInvestigation?.found && entityInvestigation.markdown,
    ),
    deepOpsRecordsFound: Boolean(deepOpsInvestigation?.found),
    tier1FindingsExist: Boolean(
      propertyInsightsForAnswer?.found ||
        recurringRepairs?.found ||
        repairsToApprove?.found ||
        residentsList?.found ||
        missingUpdates?.found ||
        vendorResponseSpeed?.found ||
        vendorBest?.found ||
        vendorCompletion?.found ||
        vendorInactive?.found ||
        vendorOverload?.found ||
        vendorVerification?.found,
    ),
    recurringRepairsFound: Boolean(recurringRepairs?.found),
    deepOpsWorkOrders: deepOpsInvestigation?.workOrders?.map((w) => ({
      workOrderId: w.workOrderId,
      propertyName: w.propertyName,
      unitLabel: w.unitLabel,
      estimatedCost: w.estimatedCost,
    })),
  })
  if (deepOpsInvestigation?.retrievalLog) {
    toolsUsed.push(
      `deep_ops_log:records=${deepOpsInvestigation.retrievalLog.recordCount}` +
        `;wos=${deepOpsInvestigation.retrievalLog.matchingWorkOrderIds.join("|") || "none"}` +
        `;cost=${deepOpsInvestigation.retrievalLog.estimatedCostFound}`,
    )
  }
  toolsUsed.push(`quality_gate:${qualityReport.summaryLine}`)
  if (qualityReport.block) {
    toolsUsed.push(`quality_gate:block:${qualityReport.block}`)
  }

  // Post-synthesis safety QC: never show hard legal claims without citations.
  const safetyFail = qualityReport.checks.find(
    (c) => c.id === "safety_qc" && c.status === "fail",
  )
  if (safetyFail && intentResult.intent === "legal") {
    answerWithSources = formatLegalRefuseMarkdown(
      "I drafted an answer with hard legal claims that weren’t clearly backed by the official sources I retrieved. " +
        "I won’t present those as fact. Please rephrase the question, confirm the property location, " +
        "or have a human / attorney review this.",
      jurisdiction.stateCode,
    )
    toolsUsed.push("quality_gate:safety_qc_block")
  }

  // Entity investigation: never show portfolio KPIs for a named unit / WO / resident / etc.
  const entityFail = qualityReport.checks.find(
    (c) => c.id === "entity_investigation" && c.status === "fail",
  )
  if (entityFail) {
    if (entityInvestigation?.markdown) {
      answerWithSources = entityInvestigation.markdown
      toolsUsed.push("quality_gate:entity_investigation_rewrite")
    } else {
      const entityLabel =
        entityInvestigation?.plan?.entities?.map((e) => e.label).filter(Boolean).join(", ") ||
        (entityInvestigation?.primary?.unit
          ? `Unit ${entityInvestigation.primary.unit}`
          : entityInvestigation?.primary?.displayId) ||
        null
      answerWithSources = incompleteEntityRootCauseAnswer({ label: entityLabel })
      toolsUsed.push("quality_gate:entity_investigation_block")
    }
  }

  const openTicketHint =
    oldestWaitingWorkOrder?.openCount ??
    (typeof gatedPortfolioBriefing?.facts?.openWorkOrders === "number"
      ? gatedPortfolioBriefing.facts.openWorkOrders
      : null)

  // Definition of investigation: never show a single dashboard metric for Why/Which/What should/…
  const investigationFail = qualityReport.checks.find(
    (c) => c.id === "investigation_definition" && c.status === "fail",
  )
  if (investigationFail && !entityFail) {
    if (draftCommunicationResult?.markdown) {
      answerWithSources = draftCommunicationResult.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:draft_communication")
    } else if (activeWorkflowsResult?.available && activeWorkflowsResult.markdown) {
      answerWithSources = activeWorkflowsResult.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:list_active_workflows")
    } else if (weatherAlertsResult?.available && weatherAlertsResult.markdown) {
      answerWithSources = weatherAlertsResult.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:get_weather_alerts")
    } else if (landlordIncentivesResult?.available && landlordIncentivesResult.markdown) {
      answerWithSources = landlordIncentivesResult.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:get_landlord_incentives")
    } else if (residentsList?.available && residentsList.markdown) {
      answerWithSources = residentsList.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:search_residents")
    } else if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:repairs_to_approve")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:missing_updates")
    } else if (
      playbook.id === "vendor_inactive" &&
      vendorInactive?.available &&
      vendorInactive.markdown
    ) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_inactive")
    } else if (
      playbook.id === "vendor_overload" &&
      vendorOverload?.available &&
      vendorOverload.markdown
    ) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_overload")
    } else if (
      playbook.id === "vendor_verification" &&
      vendorVerification?.available &&
      vendorVerification.markdown
    ) {
      answerWithSources = vendorVerification.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_verification")
    } else if (
      playbook.id === "vendor_completion" &&
      vendorCompletion?.available &&
      vendorCompletion.markdown
    ) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_completion")
    } else if (
      playbook.id === "vendor_best" &&
      vendorBest?.available &&
      vendorBest.markdown
    ) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_best")
    } else if (
      playbook.id === "vendor_speed" &&
      vendorResponseSpeed?.available &&
      vendorResponseSpeed.markdown
    ) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_response_speed")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_completion")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_best")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_response_speed")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:recurring_repairs")
    } else if (
      propertyInsightsForAnswer?.found &&
      propertyInsightsForAnswer.markdown &&
      playbook.preferTier1Answer
    ) {
      answerWithSources = propertyInsightsForAnswer.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:property_insights")
    } else if (deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
      answerWithSources = deepOpsInvestigation.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:deep_ops")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:catchall_search_work_orders")
    } else if (oldestWaitingWorkOrder?.markdown) {
      answerWithSources = oldestWaitingWorkOrder.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:oldest_wo")
    } else if (unitMaintenanceRanking?.markdown) {
      answerWithSources = unitMaintenanceRanking.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:unit_rank")
    } else if (periodSummary?.markdown) {
      answerWithSources = periodSummary.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:period")
    } else if (gatedPropertyRanking?.markdown) {
      answerWithSources = gatedPropertyRanking.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:property_rank")
    } else if (
      gatedPortfolioBriefing?.markdown &&
      shouldFetchPortfolioBriefing({
        intent: intentResult.intent,
        reasoningMode: reasoningEarly.mode,
        playbookId: playbook.id,
      })
    ) {
      answerWithSources = gatedPortfolioBriefing.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:briefing")
    } else if (entityInvestigation?.markdown) {
      answerWithSources = entityInvestigation.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:entity")
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:investigation_block")
    } else if (
      detectQuestionSubject(question) === "vendor" &&
      vendorBest?.available &&
      vendorBest.markdown
    ) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:vendor_best_subject")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:investigation_rewrite:catchall_search_work_orders")
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:investigation_block:subject_gate")
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:investigation_block")
    }
  }

  // Subject match: never ship vendor→property (or similar) substitutions.
  const subjectFail = qualityReport.checks.find(
    (c) => c.id === "subject_match" && c.status === "fail",
  )
  if (subjectFail && !entityFail) {
    if (draftCommunicationResult?.markdown) {
      answerWithSources = draftCommunicationResult.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:draft_communication")
    } else if (activeWorkflowsResult?.available && activeWorkflowsResult.markdown) {
      answerWithSources = activeWorkflowsResult.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:list_active_workflows")
    } else if (weatherAlertsResult?.available && weatherAlertsResult.markdown) {
      answerWithSources = weatherAlertsResult.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:get_weather_alerts")
    } else if (landlordIncentivesResult?.available && landlordIncentivesResult.markdown) {
      answerWithSources = landlordIncentivesResult.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:get_landlord_incentives")
    } else if (residentsList?.available && residentsList.markdown) {
      answerWithSources = residentsList.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:search_residents")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:vendor_completion")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:vendor_best")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:vendor_response_speed")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:missing_updates")
    } else if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:repairs_to_approve")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:recurring_repairs")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:subject_match_rewrite:catchall_search_work_orders")
    } else {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:subject_match_block")
    }
  }

  // Metric match: never answer "best" with response-speed-only framing.
  const metricFail = qualityReport.checks.find(
    (c) => c.id === "metric_match" && c.status === "fail",
  )
  if (metricFail && !entityFail) {
    if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:metric_match_rewrite:vendor_response_speed")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:metric_match_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:metric_match_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:metric_match_rewrite:vendor_completion")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:metric_match_rewrite:vendor_best")
    }
  }

  // Response Sufficiency / Evidence Threshold: earn the right to answer (internal).
  // User-facing copy must stay in landlord language.
  const sufficiencyFail = qualityReport.checks.find(
    (c) => c.id === "response_sufficiency" && c.status === "fail",
  )
  if (sufficiencyFail && !entityFail && !investigationFail) {
    if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:repairs_to_approve")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:missing_updates")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:vendor_completion")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:vendor_best")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:vendor_response_speed")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:recurring_repairs")
    } else if (
      propertyInsightsForAnswer?.found &&
      propertyInsightsForAnswer.markdown &&
      playbook.preferTier1Answer
    ) {
      answerWithSources = propertyInsightsForAnswer.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:property_insights")
    } else if (deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
      answerWithSources = deepOpsInvestigation.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:deep_ops")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:catchall_search_work_orders")
    } else if (oldestWaitingWorkOrder?.markdown) {
      answerWithSources = oldestWaitingWorkOrder.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:oldest_wo")
    } else if (unitMaintenanceRanking?.markdown) {
      answerWithSources = unitMaintenanceRanking.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:unit_rank")
    } else if (periodSummary?.markdown) {
      answerWithSources = periodSummary.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:period")
    } else if (gatedPropertyRanking?.markdown) {
      answerWithSources = gatedPropertyRanking.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:property_rank")
    } else if (
      gatedPortfolioBriefing?.markdown &&
      shouldFetchPortfolioBriefing({
        intent: intentResult.intent,
        reasoningMode: reasoningEarly.mode,
        playbookId: playbook.id,
      })
    ) {
      answerWithSources = gatedPortfolioBriefing.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:briefing")
    } else if (entityInvestigation?.markdown) {
      answerWithSources = entityInvestigation.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:entity")
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:sufficiency_block")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:sufficiency_rewrite:catchall_search_work_orders")
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:sufficiency_block:subject_gate")
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:sufficiency_block")
    }
  }

  // Task completion: never show a generic KPI substitute for a specific investigation.
  const taskFail = qualityReport.checks.find(
    (c) => c.id === "task_completion" && c.status === "fail",
  )
  if (taskFail && !entityFail && !investigationFail && !sufficiencyFail) {
    if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:repairs_to_approve")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:missing_updates")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:vendor_completion")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:vendor_response_speed")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:vendor_best")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:recurring_repairs")
    } else if (
      propertyInsightsForAnswer?.found &&
      propertyInsightsForAnswer.markdown &&
      playbook.preferTier1Answer
    ) {
      answerWithSources = propertyInsightsForAnswer.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:property_insights")
    } else if (deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
      answerWithSources = deepOpsInvestigation.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:deep_ops")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:catchall_search_work_orders")
    } else if (oldestWaitingWorkOrder?.markdown) {
      answerWithSources = oldestWaitingWorkOrder.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:oldest_wo")
    } else if (unitMaintenanceRanking?.markdown) {
      answerWithSources = unitMaintenanceRanking.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:unit_rank")
    } else if (periodSummary?.markdown) {
      answerWithSources = periodSummary.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:period")
    } else if (gatedPropertyRanking?.markdown) {
      answerWithSources = gatedPropertyRanking.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:property_rank")
    } else if (
      gatedPortfolioBriefing?.markdown &&
      shouldFetchPortfolioBriefing({
        intent: intentResult.intent,
        reasoningMode: reasoningEarly.mode,
        playbookId: playbook.id,
      })
    ) {
      answerWithSources = gatedPortfolioBriefing.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:briefing")
    } else if (catchAllWorkOrders?.found && catchAllWorkOrders.markdown) {
      answerWithSources = catchAllWorkOrders.markdown
      toolsUsed.push("quality_gate:task_completion_rewrite:catchall_search_work_orders")
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:task_completion_block:subject_gate")
    } else {
      answerWithSources = incompleteTaskAnswer()
      toolsUsed.push("quality_gate:task_completion_block")
    }
  }

  // Missing-info voice: rewrite AI-process language into landlord language.
  const missingInfoFail = qualityReport.checks.find(
    (c) => c.id === "missing_info_communication" && c.status === "fail",
  )
  if (
    missingInfoFail &&
    !entityFail &&
    !investigationFail &&
    !sufficiencyFail &&
    !taskFail
  ) {
    if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:repairs_to_approve")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:missing_updates")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:vendor_completion")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:vendor_response_speed")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:missing_info_rewrite:vendor_best")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
    } else if (
      propertyInsightsForAnswer?.found &&
      propertyInsightsForAnswer.markdown &&
      playbook.preferTier1Answer
    ) {
      answerWithSources = propertyInsightsForAnswer.markdown
    } else if (deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
      answerWithSources = deepOpsInvestigation.markdown
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
    } else if (intentResult.intent === "entity_investigation") {
      answerWithSources = incompleteEntityRootCauseAnswer()
    } else if (intentResult.intent === "oldest_waiting_work_order") {
      answerWithSources = incompleteOldestWaitingAnswer()
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
    }
    toolsUsed.push("quality_gate:missing_info_rewrite")
  }

  // Never Ignore Existing Ulo Intelligence: rewrite soft-"can't answer" when Tier 1 exists.
  const tier1Fail = qualityReport.checks.find(
    (c) => c.id === "never_ignore_ulo_intelligence" && c.status === "fail",
  )
  if (tier1Fail) {
    if (repairsToApprove?.available && repairsToApprove.markdown) {
      answerWithSources = repairsToApprove.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:repairs_to_approve")
    } else if (missingUpdates?.available && missingUpdates.markdown) {
      answerWithSources = missingUpdates.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:missing_updates")
    } else if (vendorOverload?.available && vendorOverload.markdown) {
      answerWithSources = vendorOverload.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:vendor_overload")
    } else if (vendorInactive?.available && vendorInactive.markdown) {
      answerWithSources = vendorInactive.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:vendor_inactive")
    } else if (vendorCompletion?.available && vendorCompletion.markdown) {
      answerWithSources = vendorCompletion.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:vendor_completion")
    } else if (vendorResponseSpeed?.available && vendorResponseSpeed.markdown) {
      answerWithSources = vendorResponseSpeed.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:vendor_response_speed")
    } else if (vendorBest?.available && vendorBest.markdown) {
      answerWithSources = vendorBest.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:vendor_best")
    } else if (recurringRepairs?.available && recurringRepairs.markdown) {
      answerWithSources = recurringRepairs.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite:recurring_repairs")
    } else if (propertyInsightsForAnswer?.found && propertyInsightsForAnswer.markdown) {
      answerWithSources = propertyInsightsForAnswer.markdown
      toolsUsed.push("quality_gate:tier1_intelligence_rewrite")
    }
  }

  // Recurring repairs: invalidate soft unavailable when patterns were found.
  const recurringFail = qualityReport.checks.find(
    (c) => c.id === "recurring_repairs_investigation" && c.status === "fail",
  )
  if (recurringFail && recurringRepairs?.markdown) {
    answerWithSources = recurringRepairs.markdown
    toolsUsed.push("quality_gate:recurring_repairs_rewrite")
  }

  // Deep ops: never claim "unavailable" when matching tickets were found.
  const deepOpsFail = qualityReport.checks.find(
    (c) => c.id === "deep_operational_investigation" && c.status === "fail",
  )
  if (deepOpsFail && deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
    answerWithSources = deepOpsInvestigation.markdown
    toolsUsed.push("quality_gate:deep_ops_rewrite")
  }

  // Final landlord-facing language pass (clips + retrieval leaks + jargon).
  if (intentResult.intent !== "legal") {
    answerWithSources = polishAskUloProse(humanizeOpsLanguage(answerWithSources))
  }

  // Compound vendor + market: make the dropped half explicit (single-intent router).
  if (compoundVendorMarket.isCompound) {
    const vendorMarkdown = vendorBest?.markdown?.trim() ?? ""
    const shippedVendor =
      vendorMarkdown.length > 0 &&
      (answerWithSources === vendorMarkdown ||
        answerWithSources.startsWith(vendorMarkdown.slice(0, Math.min(120, vendorMarkdown.length))))
    const shippedMarket =
      !shippedVendor &&
      (evidencePlan.subject === "market_intelligence" ||
        epistemicAsk.matched_rule === "market_intelligence" ||
        toolsUsed.some((t) => /\bmarket_data\b|get_market_intelligence/.test(t)))
    const before = answerWithSources
    answerWithSources = appendDroppedHalfIfNeeded(answerWithSources, {
      compound: compoundVendorMarket,
      shippedVendor,
      shippedMarket,
    })
    if (answerWithSources !== before) {
      toolsUsed.push("compound:dropped_half_note")
    }
  }

  const qualityChecks = formatQualityChecksForAudit(qualityReport.checks)

  const gateStatus = legalGate?.status ?? null
  const refused =
    gateStatus === "refuse" ||
    Boolean(safetyFail && intentResult.intent === "legal") ||
    qualityReport.block === "refuse"
  const clarified = gateStatus === "clarify" || qualityReport.block === "clarify"
  const knownUnknown =
    refused ||
    clarified ||
    requireCounsel ||
    fairHousingSafety.refuseDecision ||
    humanDecisionSafety.refuseDecision

  const faithfulness = buildFaithfulnessForEval({
    intent: intentResult.intent,
    answer: answerWithSources,
    citations: synthesis.citations,
    gateStatus,
    knownUnknown: refused || clarified,
  })

  const latencyMs = Date.now() - startedAt
  const promptTokens = synthesis.usage?.promptTokens ?? null
  const completionTokens = synthesis.usage?.completionTokens ?? null
  const embedTokens =
    retrievalCacheHit || !runLegalTools
      ? 0
      : estimateTokensFromText(retrievalQuestion)

  let turnId: string | null = null
  {
    const { data: turnRow, error: turnErr } = await supabase
      .from("ask_ulo_turns")
      .insert({
        landlord_id: landlordId,
        question,
        answer: answerWithSources,
        citations: synthesis.citations,
        tools_used: toolsUsed,
        model: synthesis.model,
      })
      .select("id")
      .maybeSingle()
    if (turnErr) {
      console.error("[ask_ulo] ask_ulo_turns insert failed", turnErr.message)
    } else if (typeof turnRow?.id === "string") {
      turnId = turnRow.id
    }
  }

  const failureTags = extractAskUloFailureTags(toolsUsed)
  if (failureTags.length) {
    console.log(
      "ASK_ULO_FAILURE_TAGS",
      JSON.stringify({ tags: failureTags, intent: intentResult.intent }),
    )
  }

  const evalId = await insertAskUloEval(supabase, {
    landlordId,
    conversationId: input.conversationId ?? null,
    turnId,
    questionExcerpt: question,
    intent: intentResult.intent,
    mode: synthesis.mode,
    model: synthesis.model,
    gateStatus,
    refused,
    clarified,
    requireCounsel,
    knownUnknown,
    qualityChecks: qualityReport.checks,
    qualitySummary: qualityReport.summaryLine,
    stateCode: jurisdiction.stateCode,
    countySlug: jurisdiction.countySlug,
    citySlug: jurisdiction.citySlug,
    housingProgram: jurisdiction.housingProgram,
    sensitiveTopicIds: sensitiveTopics.map((t) => t.id),
    fairHousingFlags: fairHousingSafety.flags.map((f) => f.id),
    humanDecisionFlags: humanDecisionSafety.flags.map((f) => f.id),
    citationCount: synthesis.citations.length,
    primaryOfficialCount: sourceTierCounts.primaryOfficial,
    agencyGuidanceCount: sourceTierCounts.agencyGuidance,
    discoveryMirrorCount: sourceTierCounts.discoveryMirror,
    retrievalCacheHit,
    answerConfidence,
    faithfulnessScore: faithfulness.score,
    faithfulnessDetail: faithfulness.detail,
    latencyMs,
    synthesizeMs: synthesis.synthesizeMs,
    promptTokens,
    completionTokens,
    embedTokens: embedTokens || null,
    failureTags,
  })

  if (evalId) toolsUsed.push(`eval:${evalId}`)
  toolsUsed.push(`latency_ms:${latencyMs}`)
  if (faithfulness.score != null) {
    toolsUsed.push(`faithfulness:${faithfulness.score}`)
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "ask_ulo.answered",
    source: "edge_function",
    actor_type: "landlord",
    metadata: {
      question: question.slice(0, 500),
      intent: intentResult.intent,
      intent_confidence: intentResult.confidence,
      agent_mode: agentMode,
      tools_used: toolsUsed,
      mode: synthesis.mode,
      model: synthesis.model,
      citation_count: synthesis.citations.length,
      country_code: jurisdiction.countryCode,
      state_code: jurisdiction.stateCode,
      county_slug: jurisdiction.countySlug,
      city_slug: jurisdiction.citySlug,
      court_system: jurisdiction.courtSystem,
      housing_program: jurisdiction.housingProgram,
      code_set: jurisdiction.codeSet,
      conversation_id: input.conversationId ?? null,
      history_turns: history.length,
      legal_gate: legalGate?.status ?? null,
      legal_jurisdiction_source: legalResolution?.source ?? null,
      legal_jurisdiction_confidence: legalResolution?.confidence ?? null,
      legal_sensitive_topics: sensitiveTopics.map((t) => t.id),
      legal_require_counsel: requireCounsel,
      fair_housing_refuse_decision: fairHousingSafety.refuseDecision,
      fair_housing_flags: fairHousingSafety.flags.map((f) => f.id),
      human_decision_refuse: humanDecisionSafety.refuseDecision,
      human_decision_flags: humanDecisionSafety.flags.map((f) => f.id),
      privacy_screening_isolation: screeningIsolation,
      legal_primary_official: sourceTierCounts.primaryOfficial,
      legal_agency_guidance: sourceTierCounts.agencyGuidance,
      legal_discovery_mirror: sourceTierCounts.discoveryMirror,
      legal_pending_ordinances: legal?.pendingOrdinanceCount ?? 0,
      legal_recommended_expert: recommendedExpertId,
      legal_answer_confidence: answerConfidence,
      legal_sources_used_count: sourcesUsed.length,
      quality_gate: qualityReport.summaryLine,
      quality_gate_block: qualityReport.block,
      retrieval_cache_hit: retrievalCacheHit,
      eval_id: evalId,
      latency_ms: latencyMs,
      synthesize_ms: synthesis.synthesizeMs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      embed_tokens: embedTokens || null,
      faithfulness_score: faithfulness.score,
      known_unknown: knownUnknown,
      refused,
      clarified,
    },
  })

  const legalAudit: AskUloLegalAudit | null =
    intentResult.intent === "legal"
      ? {
          gateStatus: legalGate?.status ?? null,
          sensitiveTopics: sensitiveTopics.map((t) => ({ id: t.id, label: t.label })),
          requireCounsel,
          counselNote,
          officialSourceCount: legalGate?.officialSourceCount ?? 0,
          primaryOfficialCount:
            legalGate?.primaryOfficialCount ?? sourceTierCounts.primaryOfficial,
          agencyGuidanceCount:
            legalGate?.agencyGuidanceCount ?? sourceTierCounts.agencyGuidance,
          discoveryMirrorCount: sourceTierCounts.discoveryMirror,
          pendingOrdinanceCount: legal?.pendingOrdinanceCount ?? 0,
          recommendedExpertId,
          handoffExperts: COUNSEL_EXPERT_ROLES.map((r) => ({
            id: r.id,
            label: r.label,
            shortLabel: r.shortLabel,
            description: r.description,
            whenToUse: r.whenToUse,
          })),
          propertyClarifyOptions,
          answerConfidence,
          answerConfidenceLabel: confidenceLabel(answerConfidence),
          sourcesUsed,
          qualityChecks,
        }
      : null

  return {
    answer: answerWithSources,
    citations: synthesis.citations,
    toolsUsed,
    mode: synthesis.mode,
    model: synthesis.model,
    intent: intentResult.intent,
    agentMode,
    evalId,
    jurisdiction: {
      countryCode: jurisdiction.countryCode,
      stateCode: jurisdiction.stateCode,
      countySlug: jurisdiction.countySlug,
      countyLabel: jurisdiction.countyLabel,
      citySlug: jurisdiction.citySlug,
      cityLabel: jurisdiction.cityLabel,
      courtSystem: jurisdiction.courtSystem,
      housingProgram: jurisdiction.housingProgram,
      codeSet: jurisdiction.codeSet,
    },
    legalAudit,
    safetyBoundary: null,
    visualContext: (() => {
      if (
        (intentResult.intent === "property_price_history" ||
          intentResult.intent === "price_history_ambiguous") &&
        priceHistory?.available &&
        priceHistory.chartSeries.length > 1
      ) {
        return {
          kind: "price_history" as const,
          buildingName: property?.buildingName ?? buildingFilter,
          title: "Estimated value history",
          changeLabel: priceHistory.summary.changeLabel,
          valueKind: "value" as const,
          series: priceHistory.chartSeries,
        }
      }
      if (
        intentResult.intent === "rent_history" &&
        rentHistory?.available &&
        rentHistory.chartSeries.length > 1
      ) {
        return {
          kind: "rent_history" as const,
          buildingName: property?.buildingName ?? buildingFilter,
          title: "Typical rent history",
          changeLabel: rentHistory.changeLabel,
          valueKind: "rent" as const,
          series: rentHistory.chartSeries,
        }
      }
      if (plan.visualMode === "market_analysis" || plan.visualMode === "comparable_rentals") {
        return {
          kind: plan.visualMode,
          buildingName: property?.buildingName ?? buildingFilter,
          address: property?.addressLine ?? null,
          cityLabel: property?.cityLabel ?? jurisdiction.cityLabel,
          stateCode: property?.stateCode ?? jurisdiction.stateCode,
          lat: property?.addressLine
            ? (DEMO_GEO[property.addressLine]?.lat ?? null)
            : null,
          lng: property?.addressLine
            ? (DEMO_GEO[property.addressLine]?.lng ?? null)
            : null,
          comps: (market?.comps ?? []).slice(0, 8).map((c) => ({
            address: c.address,
            rent: c.price,
            bedrooms: c.bedrooms,
            bathrooms: c.bathrooms,
            squareFootage: c.squareFootage,
            distanceMiles: c.distanceMiles,
            source: c.source ?? (market?.provider === "rentcast" ? "RentCast" : "Zillow"),
            listingUrl: c.url,
          })),
          showStreetView: plan.visualMode === "market_analysis",
        }
      }
      return null
    })(),
  }
}
