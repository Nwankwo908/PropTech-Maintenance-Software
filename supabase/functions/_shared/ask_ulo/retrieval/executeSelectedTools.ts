// @ts-nocheck
// Pipeline stage extracted from runAskUlo — types tightened incrementally.
/**
 * Retrieve + run selected domain tools; return the evidence bag for synthesis.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../audit/logGraphEvent.ts"
import {
  logPortfolioJurisdiction,
  logPlaybook,
  logCapabilityRoute,
  logEpistemicBucket,
  logCatchAllFallback,
  logToolsCalled,
  logEvidenceBundle,
  logEvidencePacket,
} from "../audit/logToolCalls.ts"
import {
  formatQualityChecksForAudit,
  plannedToolNames,
  runAnswerQualityGate,
} from "../quality/validateFinalAnswer.ts"
import { applyAskUloAgentModeBias } from "../routing/selectMode.ts"
import {
  COUNSEL_EXPERT_ROLES,
  recommendCounselExpert,
  type CounselExpertRoleId,
} from "../audit/counselHandoff.ts"
import { polishAskUloProse } from "../synthesis/formatAnswer.ts"
import { humanizeOpsLanguage } from "../synthesis/reasoningTransparency.ts"
import { classifyAskUloIntent, planToolsForIntent } from "../routing/detectIntent.ts"
import { isNarrowFactualOpsQuestion } from "../routing/briefingIntent.ts"
import { isPeriodSummaryQuestion, classifyResponseFormat } from "../routing/dynamicResponse.ts"
import { isOldestWaitingWorkOrderQuestion } from "../tools/maintenance/taskCompletion.ts"
import { isEntityInvestigationQuestion } from "../tools/maintenance/entityInvestigation.ts"
import { requiresDeepOperationalInvestigation } from "../tools/maintenance/deepOperationalInvestigation.ts"
import { extractBuildingFilter } from "../tools/properties/buildingFilter.ts"
import {
  detectQuestionSubject,
  isHonestGapSubjectQuestion,
  isUloActiveTasksQuestion,
  isWeatherAlertsQuestion,
  isLandlordIncentivesQuestion,
} from "../routing/detectSubject.ts"
import { shouldFetchPortfolioBriefing } from "../routing/reasoningMode.ts"
import type { AskUloClassification } from "../routing/classifyQuestion.ts"
import {
  buildOrganizedEvidencePacket,
  emptyEvidenceBundle,
  finalizeEvidenceBundle,
  recordToolExecution,
  summarizeEvidenceBundle,
  summarizeEvidencePacket,
} from "../tools/_shared/mod.ts"
import {
  type PlannedDomainToolCall,
} from "../routing/selectTools.ts"
import { applyPlannedToolsToNeeds } from "../routing/toolSelectNeeds.ts"
import { buildRetrievalToolPlan } from "../routing/buildRetrievalToolPlan.ts"
import { mergePlannedToolCalls } from "../routing/mergePlannedTools.ts"
import { resolveRetrievalNeeds, type AskUloRetrievalNeeds } from "../routing/deriveRetrievalNeeds.ts"
import { filterPlannedToolsByPermissions } from "../guards/filterPlannedToolsByPermissions.ts"
import { executeDomainTool, executePlannedDomainTools } from "../tools/_shared/executeDomainTool.ts"
import {
  buildCatchAllWorkOrderPacket,
  shouldAttemptCatchAllWorkOrderFallback,
  type CatchAllWorkOrderPacket,
} from "../retrieval/catchAllFallback.ts"
import {
  incompleteEntityRootCauseAnswer,
  incompleteInvestigationAnswer,
  incompleteMaintenanceRiskAnswer,
  incompleteOldestWaitingAnswer,
  incompleteSubjectGapAnswer,
  incompleteTaskAnswer,
} from "../guards/refusalBuilder.ts"
import {
  buildToolMissIncompleteSignal,
  resolveIncompleteRankingSignal,
} from "../guards/incompleteEvidence.ts"
import {
  classifyEpistemicAsk,
  resolveEpistemicOutcome,
  type EpistemicClassification,
} from "../routing/epistemicBucket.ts"
import { appendDroppedHalfIfNeeded } from "../routing/compoundIntent.ts"
import {
  assessLegalGrounding,
  formatLegalClarificationMarkdown,
  formatLegalRefuseMarkdown,
  resolveLegalJurisdiction,
  type LegalJurisdictionResolution,
} from "../quality/checkJurisdiction.ts"
import {
  detectLegalSensitiveTopics,
  formatSensitiveCounselNote,
  isScreeningPrivacyTopic,
  type LegalSensitiveTopic,
} from "../quality/legalSensitiveTopics.ts"
import { searchLegalSources } from "../tools/legal/searchLegalSources.ts"
import { getMarketIntelligence } from "../tools/localMarket/getMarketIntelligence.ts"
import {
  prepareRetrievalCache,
  putRetrievalCache,
} from "../retrieval/retrievalCache.ts"
import { summarizeLegalSourceTiers } from "../quality/legalSourceTrust.ts"
import { type AskUloCitation } from "../retrieval/searchInternalData.ts"
import { resolvePortfolioJurisdiction } from "../tools/properties/portfolioContext.ts"
import {
  formatPriceHistoryMarkdown,
} from "../tools/finance/propertyPriceHistory.ts"
import {
  leasingImpactFromOpsBullets,
  propertySnapshotLookup,
} from "../tools/properties/propertySnapshot.ts"
import {
  enrichPropertyContextForLegal,
  formatPropertyScopeClarifyMarkdown,
  legalOpsContextFromOpsBullets,
  needsPortfolioPropertyScope,
} from "../tools/properties/propertyContext.ts"
import {
  formatRentHistoryMarkdown,
} from "../tools/rent/rentHistoryLookup.ts"
import {
  assessAnswerConfidence,
  buildSourcesUsed,
  confidenceLabel,
  type AnswerConfidence,
} from "../retrieval/rankEvidence.ts"
import { synthesizeAskUloAnswer } from "../synthesis/index.ts"
import {
  buildFaithfulnessForEval,
  estimateTokensFromText,
  insertAskUloEval,
  extractAskUloFailureTags,
} from "../audit/buildAuditRecord.ts"
import { buildAskUloTurnContext } from "../core/context.ts"
import {
  loadLandlordPropertyRecords,
  propertyPlacesFromRecords,
} from "../tools/properties/propertyRecords.ts"
import type {
  AskUloHistoryMessage,
  AskUloLegalAudit,
  AskUloResponse,
} from "../core/types.ts"


import { applyPermissionGatesToRetrievalNeeds } from "../guards/permissionGuard.ts"
import type { AskUloContext } from "../core/context.ts"
import type { AskUloExecutionPlan } from "../routing/buildExecutionPlan.ts"
import type { AskUloSafetyContinue } from "../guards/runSafetyChecks.ts"
import type { AskUloEvidence } from "../core/pipelineTypes.ts"
import { fetchSpecialtyEvidence } from "./fetchSpecialtyEvidence.ts"

export async function executeSelectedTools(
  context: AskUloContext,
  route: AskUloExecutionPlan,
  safety: AskUloSafetyContinue,
): Promise<AskUloEvidence> {
  const {
    supabase,
    question,
    landlordId,
    agentMode,
    history,
    conversationId,
    startedAt,
    priorUserTurns,
    retrievalQuestion,
    portfolioJurisdiction,
    propertyScope,
  } = context
  const intentResult = route.intentResult
  const {
    fairHousingSafety,
    humanDecisionSafety,
    sensitiveTopics,
    screeningIsolation,
    requireCounsel,
    counselNote,
  } = safety
  const plan = route.legacyToolPlan
  const buildingFilter = propertyScope.buildingFilter
  const propertyRecords = await loadLandlordPropertyRecords(supabase, landlordId)
  const propertyPlaces = propertyPlacesFromRecords(propertyRecords)

  const toolsUsed: string[] = [
    `intent:${intentResult.intent}`,
    `route:${route.decision.action}:${route.decision.subject}`,
    `portfolio_location:${portfolioJurisdiction.locationSource}`,
  ]
  if (route.decision.propertyId) {
    toolsUsed.push(`route_property:${route.decision.propertyId}`)
  }
  for (const t of route.decision.tools) {
    toolsUsed.push(`route_tool:${t}`)
  }
  if (portfolioJurisdiction.stateCode) {
    toolsUsed.push(
      `portfolio_place:${[portfolioJurisdiction.cityLabel, portfolioJurisdiction.stateCode]
        .filter(Boolean)
        .join(",")}`,
    )
  }
  logPortfolioJurisdiction({
    landlordId,
    locationSource: portfolioJurisdiction.locationSource,
    stateCode: portfolioJurisdiction.stateCode,
    cityLabel: portfolioJurisdiction.cityLabel,
    buildingCount: portfolioJurisdiction.buildingCount,
    buildingFilter,
    userId: context.userId,
    flags: context.flags,
  })
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
      propertyPlaces,
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

  let runLegalTools =
    context.permissions.canAskLegal &&
    plan.runLegalRag &&
    legalResolution != null &&
    !legalResolution.needsClarification &&
    Boolean(legalResolution.stateCode)

  let legal: Awaited<ReturnType<typeof searchLegalSources>>["legal"] = null
  let structured: Awaited<
    ReturnType<typeof searchLegalSources>
  >["structured"] = null
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
      const legalPacket = await searchLegalSources(supabase, {
        question: retrievalQuestion,
        stateCode: effectiveJurisdiction.stateCode,
        citySlug: effectiveJurisdiction.citySlug,
        countySlug: effectiveJurisdiction.countySlug,
        countryCode: effectiveJurisdiction.countryCode,
        housingProgram: effectiveJurisdiction.housingProgram,
        includeRag: true,
        includeStructured: plan.runStructured,
      })
      legal = legalPacket.legal
      structured = legalPacket.structured
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

  const executionPlan = route
  const reasoningEarly = executionPlan.reasoningMode
  const analytical = executionPlan.analytical
  const playbook = executionPlan.playbook
  const evidencePlan = executionPlan.evidencePlan
  const capabilityResult = executionPlan.capability
  const capabilityRoute = executionPlan.capabilityRoute
  const epistemicAsk = executionPlan.epistemic
  const compoundVendorMarket = executionPlan.compound
  const toolSelectLocks = executionPlan.toolSelectLocks
  const toolAllowlist = executionPlan.toolAllowlist
  const rulePlannedTools = executionPlan.ruleToolPlan
  const vendorSubjectLock = toolSelectLocks.vendorLock
  /** Hard subject gate: never fetch property ranking / portfolio briefing for wrong subjects. */
  const propertyDashboardLock = toolSelectLocks.blockPropertyDashboard
  const classificationForPlan: AskUloClassification = {
    intentResult,
    subject: evidencePlan.subject,
    capability: capabilityResult,
    capabilityRoute,
    playbook,
    reasoningMode: reasoningEarly,
    analytical,
    responseFormat: executionPlan.responseFormat,
    compound: compoundVendorMarket,
    epistemic: epistemicAsk,
    evidencePlan,
    toolSelectLocks,
    propertyLabel: executionPlan.propertyLabel,
    propertyId: executionPlan.propertyId,
    decision: executionPlan.decision,
  }
  logPlaybook({
    id: playbook.id,
    consultTier1First: playbook.consultTier1First,
    preferTier1Answer: playbook.preferTier1Answer,
    deepOpsPrimary: playbook.deepOpsPrimary,
  })
  logCapabilityRoute({
    subject: evidencePlan.subject,
    capability: capabilityResult.capability,
    confidence: capabilityResult.confidence,
    hints: capabilityResult.hints,
    requiredTools: capabilityRoute.requiredTools,
    optionalTools: capabilityRoute.optionalTools,
  })
  logEpistemicBucket({
    classified_bucket: epistemicAsk.classified_bucket,
    matched_rule: epistemicAsk.matched_rule,
    confidence: epistemicAsk.confidence,
    fallback_reason: epistemicAsk.fallback_reason,
    secondary_signals: epistemicAsk.secondary_signals,
    compound_vendor_market: compoundVendorMarket.isCompound,
    phase: "ask",
  })

  // Tool selection belongs in planAskUloTurn; fall back for callers that only built an execution plan.
  let plannedTools: PlannedDomainToolCall[]
  let toolSelectSource: "openai" | "rules" | "skipped" | "error"
  let noToolMatched: boolean
  let toolNeeds: ReturnType<typeof applyPlannedToolsToNeeds>

  if (executionPlan.toolSelection) {
    toolSelectSource = executionPlan.toolSelection.toolSelectSource
    noToolMatched = executionPlan.toolSelection.noToolMatched
    toolNeeds = executionPlan.toolSelection.toolNeeds
    plannedTools = executionPlan.toolSelection.plannedTools
  } else {
    const { resolveToolSelection } = await import(
      "../routing/resolveToolSelection.ts"
    )
    const selection = await resolveToolSelection({
      question,
      ruleToolPlan: rulePlannedTools,
      toolAllowlist,
      toolSelectLocks,
      subject: evidencePlan.subject,
      capability: capabilityResult.capability,
    })
    plannedTools = selection.plannedTools
    toolSelectSource = selection.toolSelectSource
    noToolMatched = selection.noToolMatched
    toolNeeds = selection.toolNeeds
  }

  toolsUsed.push(`tool_select:${toolSelectSource}`)
  if (noToolMatched) toolsUsed.push("no_tool_matched")
  for (const id of toolNeeds.plannedToolIds) {
    toolsUsed.push(`tools_planned:${id}`)
  }

  const turnPlan = executionPlan as {
    plannedTools?: PlannedDomainToolCall[]
    retrievalNeeds?: AskUloRetrievalNeeds
  }
  if (turnPlan.plannedTools?.length) {
    plannedTools = turnPlan.plannedTools
  }

  let retrievalNeeds = resolveRetrievalNeeds({
    question,
    classification: classificationForPlan,
    toolNeeds,
    legacyToolPlan: plan,
    precomputed: turnPlan.retrievalNeeds,
  })

  if (!turnPlan.plannedTools?.length) {
    const retrievalToolPlan = buildRetrievalToolPlan({
      retrievalNeeds,
      classification: classificationForPlan,
      legacyToolPlan: plan,
      toolNeeds,
    })
    plannedTools = mergePlannedToolCalls(plannedTools, retrievalToolPlan)
  }

  plannedTools = filterPlannedToolsByPermissions(plannedTools, context.permissions)

  // Playbook flags below: permission audit + graph metadata — not retrieval dispatch.
  const permissionGated = applyPermissionGatesToRetrievalNeeds(
    context.permissions,
    retrievalNeeds,
    {
      runLegalTools,
      forcePropertyRanking: toolNeeds.needsRankProperties,
    },
  )
  retrievalNeeds = permissionGated.retrievalNeeds
  runLegalTools = permissionGated.runLegalTools

  if (!context.permissions.canSeeResidents && evidencePlan.subject === "resident") {
    toolsUsed.push("permission:gated:canSeeResidents")
  }
  if (!context.permissions.canSeeVendors && evidencePlan.subject === "vendor") {
    toolsUsed.push("permission:gated:canSeeVendors")
  }
  if (!context.permissions.canAskLegal && intentResult.intent === "legal") {
    toolsUsed.push("permission:gated:canAskLegal")
  }

  const specialty = await fetchSpecialtyEvidence(
    {
      runStructured: plan.runStructured,
      intentIsLegal: intentResult.intent === "legal",
      runLegalTools,
      needsMarketIntelligence:
        Boolean(plan.runMarketData) || Boolean(toolNeeds.needsMarketIntelligence),
    },
    {
      supabase,
      landlordId,
      question,
      retrievalQuestion,
      buildingFilter,
      plannedTools,
      capabilityHints: capabilityResult.hints,
      analytical,
      portfolioJurisdiction: {
        stateCode: portfolioJurisdiction.stateCode,
        citySlug: portfolioJurisdiction.citySlug,
      },
      effectiveJurisdiction: {
        stateCode: effectiveJurisdiction.stateCode,
        cityLabel: effectiveJurisdiction.cityLabel,
        citySlug: effectiveJurisdiction.citySlug,
      },
    },
  )

  const {
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
    toolsCalled,
  } = specialty

  // Recurring repairs are repair-level evidence (not Property Insights cards).
  const propertyInsightsForAnswer = propertyInsights ?? null

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

  logCatchAllFallback({
    attempted: attemptCatchAll,
    subject: evidencePlan.subject,
    specialty_packet: specialtyPacketAlready,
    wo_count: catchAllWorkOrders?.workOrderCount ?? 0,
    used: Boolean(catchAllWorkOrders?.found),
    skipped_briefing: true,
  })
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
  logEpistemicBucket({
    classified_bucket: epistemicOutcome.classified_bucket,
    matched_rule: epistemicOutcome.matched_rule,
    confidence: epistemicOutcome.confidence,
    fallback_reason: epistemicOutcome.fallback_reason,
    secondary_signals: epistemicOutcome.secondary_signals,
    compound_vendor_market: compoundVendorMarket.isCompound,
    phase: "outcome",
  })

  for (const id of toolsCalled) {
    toolsUsed.push(`tools_called:${id}`)
  }
  logToolsCalled({
    tools_planned: toolNeeds.plannedToolIds,
    tools_called: toolsCalled,
    no_tool_matched: noToolMatched,
    source: toolSelectSource,
  })

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
  logEvidenceBundle(summarizeEvidenceBundle(finalizedEvidence))

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
      propertyPlaces,
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

  const market = plan.runMarketData || toolNeeds.needsMarketIntelligence
    ? await getMarketIntelligence({
        buildingName: property?.buildingName ?? buildingFilter,
        cityLabel: property?.cityLabel ?? jurisdiction.cityLabel,
        stateCode: property?.stateCode ?? jurisdiction.stateCode,
        addressLine: property?.addressLine ?? null,
        portfolioMonthlyRent: property?.portfolioMonthlyRent ?? null,
      })
    : null

  const priceHistoryRow = intentResult.intent === "price_history_ambiguous"
    ? await executeDomainTool(
      supabase,
      {
        name: "get_property_price_history",
        arguments: {
          buildingName: property?.buildingName ?? buildingFilter,
          clarifyOnly: true,
        },
      },
      { organizationId: landlordId, question, buildingFilter },
    )
    : context.permissions.canSeeFinance && plan.runPriceHistory
    ? await executeDomainTool(
      supabase,
      {
        name: "get_property_price_history",
        arguments: {
          buildingName: property?.buildingName ?? buildingFilter,
          addressLine: property?.addressLine ?? null,
        },
      },
      { organizationId: landlordId, question, buildingFilter },
    )
    : null
  const priceHistory = priceHistoryRow?.toolId === "get_property_price_history"
    ? priceHistoryRow.result
    : null

  const rentHistoryRow = context.permissions.canSeeFinance && plan.runRentHistory
    ? await executeDomainTool(
      supabase,
      {
        name: "get_rent_history",
        arguments: {
          buildingName: property?.buildingName ?? buildingFilter,
          cityLabel: property?.cityLabel ?? jurisdiction.cityLabel,
          stateCode: property?.stateCode ?? jurisdiction.stateCode,
          addressLine: property?.addressLine ?? null,
        },
      },
      { organizationId: landlordId, question, buildingFilter },
    )
    : null
  const rentHistory = rentHistoryRow?.toolId === "get_rent_history"
    ? rentHistoryRow.result
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
  if (propertyRanking?.canRank) toolsUsed.push("rank_properties")
  else if (propertyRanking?.available) toolsUsed.push("rank_properties:incomplete")
  else if (propertyRanking) toolsUsed.push("rank_properties:unavailable")
  if (opsRaw?.found) toolsUsed.push("search_operations_graph")
  else if (opsRaw) toolsUsed.push("search_operations_graph:none")
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

  const missingForPacket: string[] = [
    ...(gatedPropertyRanking && !gatedPropertyRanking.canRank
      ? gatedPropertyRanking.missingData ?? []
      : []),
    ...(unitMaintenanceRanking && !unitMaintenanceRanking.canRank
      ? unitMaintenanceRanking.missingData ?? []
      : []),
    ...(periodSummary && !periodSummary.canSummarize
      ? periodSummary.missingData ?? []
      : []),
    ...(market?.gapNote ? [market.gapNote] : []),
    ...(priceHistory?.gapNote ? [priceHistory.gapNote] : []),
    ...(rentHistory?.gapNote ? [rentHistory.gapNote] : []),
  ]

  const evidencePacket = buildOrganizedEvidencePacket({
    bundle: finalizedEvidence,
    jurisdiction: {
      stateCode: jurisdiction.stateCode,
      cityLabel: jurisdiction.cityLabel,
      citySlug: jurisdiction.citySlug,
      countyLabel: jurisdiction.countyLabel,
      countryCode: jurisdiction.countryCode,
    },
    legal: legal
      ? { bullets: legal.bullets, citations: legal.citations }
      : null,
    market: market
      ? {
          bullets: market.bullets,
          citations: market.citations,
          provider: market.provider,
        }
      : null,
    structured: structured?.relevant
      ? { bullets: structured.bullets, citations: structured.citations }
      : null,
    ops: ops ? { bullets: ops.bullets, citations: ops.citations } : null,
    missing: missingForPacket,
  })
  logEvidencePacket(summarizeEvidencePacket(evidencePacket))

  return {
    plan,
    retrievalQuestion,
    portfolioJurisdiction,
    buildingFilter,
    toolsUsed,
    legalResolution,
    effectiveJurisdiction,
    runLegalTools,
    legal,
    structured,
    retrievalCacheHit,
    executionPlan,
    reasoningEarly,
    analytical,
    playbook,
    evidencePlan,
    capabilityResult,
    capabilityRoute,
    epistemicAsk,
    compoundVendorMarket,
    toolSelectLocks,
    toolAllowlist,
    rulePlannedTools,
    vendorSubjectLock,
    propertyDashboardLock,
    plannedTools,
    toolSelectSource,
    noToolMatched,
    toolNeeds,
    retrievalNeeds,
    propertyInsightsForAnswer,
    toolsCalled,
    searchWorkOrdersHit,
    catchAllWorkOrders,
    specialtyPacketAlready,
    attemptCatchAll,
    epistemicOutcome,
    evidenceBundle,
    finalizedEvidence,
    evidencePacket,
    propertyForSynthesis,
    portfolioBuildingNames,
    recommendedExpertId,
    legalGate,
    sourceTierCounts,
    resolvedBuilding,
    needsPropertyScope,
    propertyClarifyOptions,
    groundingReason,
    groundingOk,
    jurisdiction,
    market,
    priceHistory,
    rentHistory,
    ops,
    reasoning,
    narrowFactual,
    gatedPropertyRanking,
    gatedPortfolioBriefing,
    // Specialty packets (required by synthesis + prefer-evidence)
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
    fairHousingSafety,
    humanDecisionSafety,
    sensitiveTopics,
    screeningIsolation,
    requireCounsel,
    counselNote,
  }
}
