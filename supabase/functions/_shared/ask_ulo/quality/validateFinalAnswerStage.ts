// @ts-nocheck
// Pipeline stage: quality gate → rewrites → post-answer checks → response bag.
/**
 * Validate final answer — thin check-stage controller.
 *
 *   1. runAnswerQualityGate
 *   2. applyQualityGateRewrites (prefer / incomplete)
 *   3. runPostAnswerQualityChecks (faithfulness → completeness → privacy → confidence → jurisdiction)
 *   4. Build validated response for audit
 */

import { logPostAnswerQuality } from "../audit/logDecision.ts"
import {
  formatQualityChecksForAudit,
  plannedToolNames,
  runAnswerQualityGate,
} from "./validateFinalAnswer.ts"
import {
  formatPostAnswerFailClosedMarkdown,
  runPostAnswerQualityChecks,
} from "./runPostAnswerChecks.ts"
import { applyQualityGateRewrites } from "./applyQualityGateRewrites.ts"
import { polishAskUloProse } from "../synthesis/formatAnswer.ts"
import { humanizeOpsLanguage } from "../synthesis/reasoningTransparency.ts"
import { appendDroppedHalfIfNeeded } from "../routing/compoundIntent.ts"
import {
  assessAnswerConfidence,
  buildSourcesUsed,
  confidenceLabel,
  type AnswerConfidence,
} from "../retrieval/rankEvidence.ts"
import {
  buildFaithfulnessForEval,
  estimateTokensFromText,
} from "../audit/buildAuditRecord.ts"
import type { AskUloResponse } from "../core/types.ts"
import type { AskUloContext } from "../core/context.ts"
import type { AskUloExecutionPlan } from "../routing/buildExecutionPlan.ts"
import type { AskUloSafetyContinue } from "../guards/runSafetyChecks.ts"
import type {
  AskUloDraftAnswer,
  AskUloEvidence,
  AskUloValidatedAnswer,
} from "../core/pipelineTypes.ts"

export async function validateFinalAnswer(input: {
  answer: AskUloDraftAnswer
  evidence: AskUloEvidence
  context: AskUloContext
  route: AskUloExecutionPlan
  safety: AskUloSafetyContinue
}): Promise<AskUloValidatedAnswer> {
  const { answer, context, route, safety } = input
  const {
    supabase,
    question,
    landlordId,
    agentMode,
    history,
    conversationId,
    startedAt,
    priorUserTurns,
  } = context
  const intentResult = route.intentResult
  const fairHousingSafety = safety.fairHousingSafety
  const humanDecisionSafety = safety.humanDecisionSafety
  const sensitiveTopics = safety.sensitiveTopics
  const screeningIsolation = safety.screeningIsolation
  const requireCounsel = safety.requireCounsel
  const counselNote = safety.counselNote
  const d = answer as Record<string, any>
  const synthesis = d.synthesis
  let answerWithSources = d.answerWithSources
  let toolsUsed = d.toolsUsed as string[]
  const evidence = d.evidence as AskUloEvidence
  const plan = d.plan ?? (evidence as any).plan
  const retrievalQuestion =
    d.retrievalQuestion ??
    (evidence as any).retrievalQuestion ??
    context.retrievalQuestion
  const portfolioJurisdiction =
    d.portfolioJurisdiction ??
    (evidence as any).portfolioJurisdiction ??
    context.portfolioJurisdiction
  const buildingFilter =
    d.buildingFilter ??
    (evidence as any).buildingFilter ??
    context.propertyScope.buildingFilter
  const legalResolution = d.legalResolution ?? (evidence as any).legalResolution
  const effectiveJurisdiction = d.effectiveJurisdiction ?? (evidence as any).effectiveJurisdiction
  const runLegalTools = d.runLegalTools ?? (evidence as any).runLegalTools
  const legal = d.legal ?? (evidence as any).legal
  const structured = d.structured ?? (evidence as any).structured
  const retrievalCacheHit = d.retrievalCacheHit ?? (evidence as any).retrievalCacheHit
  const executionPlan = d.executionPlan ?? (evidence as any).executionPlan
  const reasoningEarly = d.reasoningEarly ?? (evidence as any).reasoningEarly
  const analytical = d.analytical ?? (evidence as any).analytical
  const playbook = d.playbook ?? (evidence as any).playbook
  const evidencePlan = d.evidencePlan ?? (evidence as any).evidencePlan
  const capabilityResult = d.capabilityResult ?? (evidence as any).capabilityResult
  const capabilityRoute = d.capabilityRoute ?? (evidence as any).capabilityRoute
  const epistemicAsk = d.epistemicAsk ?? (evidence as any).epistemicAsk
  const compoundVendorMarket = d.compoundVendorMarket ?? (evidence as any).compoundVendorMarket
  const toolSelectLocks = d.toolSelectLocks ?? (evidence as any).toolSelectLocks
  const toolAllowlist = d.toolAllowlist ?? (evidence as any).toolAllowlist
  const rulePlannedTools = d.rulePlannedTools ?? (evidence as any).rulePlannedTools
  const vendorSubjectLock = d.vendorSubjectLock ?? (evidence as any).vendorSubjectLock
  const propertyDashboardLock = d.propertyDashboardLock ?? (evidence as any).propertyDashboardLock
  const plannedTools = d.plannedTools ?? (evidence as any).plannedTools
  const toolSelectSource = d.toolSelectSource ?? (evidence as any).toolSelectSource
  const noToolMatched = d.noToolMatched ?? (evidence as any).noToolMatched
  const toolNeeds = d.toolNeeds ?? (evidence as any).toolNeeds
  const propertyInsightsForAnswer = d.propertyInsightsForAnswer ?? (evidence as any).propertyInsightsForAnswer
  const toolsCalled = d.toolsCalled ?? (evidence as any).toolsCalled
  const searchWorkOrdersHit = d.searchWorkOrdersHit ?? (evidence as any).searchWorkOrdersHit
  const catchAllWorkOrders = d.catchAllWorkOrders ?? (evidence as any).catchAllWorkOrders
  const specialtyPacketAlready = d.specialtyPacketAlready ?? (evidence as any).specialtyPacketAlready
  const attemptCatchAll = d.attemptCatchAll ?? (evidence as any).attemptCatchAll
  const epistemicOutcome = d.epistemicOutcome ?? (evidence as any).epistemicOutcome
  const evidenceBundle = d.evidenceBundle ?? (evidence as any).evidenceBundle
  const finalizedEvidence = d.finalizedEvidence ?? (evidence as any).finalizedEvidence
  const evidencePacket = d.evidencePacket ?? (evidence as any).evidencePacket
  const propertyForSynthesis = d.propertyForSynthesis ?? (evidence as any).propertyForSynthesis
  const portfolioBuildingNames = d.portfolioBuildingNames ?? (evidence as any).portfolioBuildingNames
  const recommendedExpertId = d.recommendedExpertId ?? (evidence as any).recommendedExpertId
  const legalGate = d.legalGate ?? (evidence as any).legalGate
  const sourceTierCounts = d.sourceTierCounts ?? (evidence as any).sourceTierCounts
  const resolvedBuilding = d.resolvedBuilding ?? (evidence as any).resolvedBuilding
  const needsPropertyScope = d.needsPropertyScope ?? (evidence as any).needsPropertyScope
  const propertyClarifyOptions = d.propertyClarifyOptions ?? (evidence as any).propertyClarifyOptions
  const groundingReason = d.groundingReason ?? (evidence as any).groundingReason
  const groundingOk = d.groundingOk ?? (evidence as any).groundingOk
  const jurisdiction = d.jurisdiction ?? (evidence as any).jurisdiction
  const market = d.market ?? (evidence as any).market
  const priceHistory = d.priceHistory ?? (evidence as any).priceHistory
  const rentHistory = d.rentHistory ?? (evidence as any).rentHistory
  const ops = d.ops ?? (evidence as any).ops
  const reasoning = d.reasoning ?? (evidence as any).reasoning
  const narrowFactual = d.narrowFactual ?? (evidence as any).narrowFactual
  const gatedPropertyRanking = d.gatedPropertyRanking ?? (evidence as any).gatedPropertyRanking
  const gatedPortfolioBriefing = d.gatedPortfolioBriefing ?? (evidence as any).gatedPortfolioBriefing
  const ev = evidence as Record<string, any>
  const residentsList = d.residentsList ?? ev.residentsList
  const draftCommunicationResult = d.draftCommunicationResult ?? ev.draftCommunicationResult
  const activeWorkflowsResult = d.activeWorkflowsResult ?? ev.activeWorkflowsResult
  const weatherAlertsResult = d.weatherAlertsResult ?? ev.weatherAlertsResult
  const landlordIncentivesResult = d.landlordIncentivesResult ?? ev.landlordIncentivesResult
  const unitMaintenanceRanking = d.unitMaintenanceRanking ?? ev.unitMaintenanceRanking
  const periodSummary = d.periodSummary ?? ev.periodSummary
  const oldestWaitingWorkOrder = d.oldestWaitingWorkOrder ?? ev.oldestWaitingWorkOrder
  const entityInvestigation = d.entityInvestigation ?? ev.entityInvestigation
  const deepOpsInvestigation = d.deepOpsInvestigation ?? ev.deepOpsInvestigation
  const repairsToApprove = d.repairsToApprove ?? ev.repairsToApprove
  const missingUpdates = d.missingUpdates ?? ev.missingUpdates
  const vendorResponseSpeed = d.vendorResponseSpeed ?? ev.vendorResponseSpeed
  const vendorBest = d.vendorBest ?? ev.vendorBest
  const vendorCompletion = d.vendorCompletion ?? ev.vendorCompletion
  const vendorInactive = d.vendorInactive ?? ev.vendorInactive
  const vendorOverload = d.vendorOverload ?? ev.vendorOverload
  const vendorVerification = d.vendorVerification ?? ev.vendorVerification
  const recurringRepairs = d.recurringRepairs ?? ev.recurringRepairs
  const toolMissPreferActive = toolsUsed.some(
    (t) =>
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

  const openTicketHint =
    oldestWaitingWorkOrder?.openCount ??
    (typeof gatedPortfolioBriefing?.facts?.openWorkOrders === "number"
      ? gatedPortfolioBriefing.facts.openWorkOrders
      : null)

  const rewritten = applyQualityGateRewrites({
    question,
    answer: answerWithSources,
    toolsUsed,
    qualityReport,
    intent: intentResult.intent,
    stateCode: jurisdiction.stateCode,
    propertyDashboardLock,
    evidencePlan,
    capabilityResult,
    reasoningEarly,
    playbook,
    intentResult,
    openTicketHint,
    entityInvestigation,
    recurringRepairs,
    deepOpsInvestigation,
    preferEvidence: {
      ...ev,
      gatedPropertyRanking,
      gatedPortfolioBriefing,
      residentsList,
      draftCommunicationResult,
      activeWorkflowsResult,
      weatherAlertsResult,
      landlordIncentivesResult,
      unitMaintenanceRanking,
      periodSummary,
      oldestWaitingWorkOrder,
      entityInvestigation,
      deepOpsInvestigation,
      repairsToApprove,
      missingUpdates,
      vendorResponseSpeed,
      vendorBest,
      vendorCompletion,
      vendorInactive,
      vendorOverload,
      vendorVerification,
      recurringRepairs,
      propertyInsightsForAnswer,
      catchAllWorkOrders,
      needsUnitRanking: Boolean(unitMaintenanceRanking),
      specialtyPacketAlready,
      propertyDashboardLock,
      playbook,
      capabilityResult,
      evidencePlan,
      reasoningEarly,
    },
  })
  answerWithSources = rewritten.answer
  toolsUsed = rewritten.toolsUsed
  const safetyFail = rewritten.safetyFail
  const entityFail = rewritten.entityFail

  // Final landlord-facing language pass (clips + retrieval leaks + jargon).
  if (intentResult.intent !== "legal") {
    answerWithSources = polishAskUloProse(humanizeOpsLanguage(answerWithSources))
  }

  // Independent post-answer checks (fail-closed):
  // faithfulness → completeness → privacy → confidence → jurisdiction
  const postAnswerReport = runPostAnswerQualityChecks({
    question,
    answer: answerWithSources,
    intent: intentResult.intent,
    citations: synthesis.citations,
    evidencePacket: evidencePacket ?? null,
    gateStatus: legalGate?.status ?? null,
    buildingFilter: buildingFilter ?? resolvedBuilding ?? null,
    portfolioBuildings: portfolioBuildingNames ?? [],
    landlordId,
    packetSatisfied: Boolean(
      (residentsList?.available && residentsList.markdown) ||
        (repairsToApprove?.available && repairsToApprove.markdown) ||
        (gatedPropertyRanking?.canRank && gatedPropertyRanking.top) ||
        (deepOpsInvestigation?.found && deepOpsInvestigation.markdown) ||
        (propertyInsightsForAnswer?.found && propertyInsightsForAnswer.markdown),
    ),
    stateCode: jurisdiction?.stateCode ?? legalResolution?.stateCode ?? null,
    cityLabel: jurisdiction?.cityLabel ?? legalResolution?.cityLabel ?? null,
    screeningIsolation,
    sensitiveTopicIds: (sensitiveTopics ?? []).map((t: { id?: string }) => t.id).filter(Boolean),
    requireCounsel,
  })
  toolsUsed.push(`post_answer:${postAnswerReport.summaryLine}`)
  logPostAnswerQuality({
    pass: postAnswerReport.pass,
    failClosed: postAnswerReport.failClosed,
    block: postAnswerReport.block,
    reasons: postAnswerReport.reasons,
  })
  if (postAnswerReport.failClosed && postAnswerReport.block) {
    answerWithSources = formatPostAnswerFailClosedMarkdown({
      block: postAnswerReport.block,
      reasons: postAnswerReport.reasons,
      question,
    })
    toolsUsed.push(`post_answer:fail_closed:${postAnswerReport.block}`)
  } else if (postAnswerReport.redactedAnswer) {
    answerWithSources = postAnswerReport.redactedAnswer
    toolsUsed.push("post_answer:privacy_redacted")
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
    qualityReport.block === "refuse" ||
    postAnswerReport.block === "refuse"
  const clarified =
    gateStatus === "clarify" ||
    qualityReport.block === "clarify" ||
    postAnswerReport.block === "clarify"
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

  const property = d.property ?? (evidence as any).property ?? null
  const propertyForSynthesis =
    d.propertyForSynthesis ?? (evidence as any).propertyForSynthesis ?? property

  const placeBits = [
    jurisdiction?.cityLabel,
    jurisdiction?.countyLabel ? `${jurisdiction.countyLabel} County` : null,
    jurisdiction?.stateCode,
  ].filter(Boolean)
  const jurisdictionLabel = placeBits.length > 0 ? placeBits.join(", ") : null

  const sourcesUsed =
    intentResult.intent === "legal"
      ? buildSourcesUsed({
          citations: synthesis.citations,
          propertyBuildingName:
            propertyForSynthesis?.buildingName ?? property?.buildingName,
          propertyBullets:
            propertyForSynthesis?.bullets ?? property?.bullets,
          hasOpsContext: Boolean(ops?.bullets?.length),
          housingProgram: jurisdiction?.housingProgram,
          jurisdictionLabel,
        })
      : []

  const answerConfidence =
    intentResult.intent === "legal"
      ? assessAnswerConfidence({
          intent: intentResult.intent,
          gateStatus,
          requireCounsel,
          primaryOfficialCount:
            legalGate?.primaryOfficialCount ?? sourceTierCounts?.primaryOfficial ?? 0,
          agencyGuidanceCount:
            legalGate?.agencyGuidanceCount ?? sourceTierCounts?.agencyGuidance ?? 0,
          discoveryMirrorCount: sourceTierCounts?.discoveryMirror ?? 0,
          pendingOrdinanceCount: legal?.pendingOrdinanceCount ?? 0,
          hasPortfolioContext: Boolean(
            propertyForSynthesis?.bullets?.length || property?.bullets?.length,
          ),
        })
      : ("medium" as AnswerConfidence)

  const evalId = d.evalId ?? null
  const legalAudit =
    intentResult.intent === "legal"
      ? {
          gateStatus,
          sensitiveTopics: sensitiveTopics ?? [],
          requireCounsel: Boolean(requireCounsel),
          counselNote: counselNote ?? null,
          officialSourceCount: legalGate?.officialSourceCount ?? 0,
          primaryOfficialCount:
            legalGate?.primaryOfficialCount ?? sourceTierCounts?.primaryOfficial ?? 0,
          agencyGuidanceCount:
            legalGate?.agencyGuidanceCount ?? sourceTierCounts?.agencyGuidance ?? 0,
          discoveryMirrorCount: sourceTierCounts?.discoveryMirror ?? 0,
          pendingOrdinanceCount: legal?.pendingOrdinanceCount ?? 0,
          recommendedExpertId: recommendedExpertId ?? null,
          handoffExperts: d.handoffExperts ?? [],
          propertyClarifyOptions: propertyClarifyOptions ?? [],
          answerConfidence,
          answerConfidenceLabel: confidenceLabel(answerConfidence),
          sourcesUsed,
          qualityChecks,
        }
      : null

  const response: AskUloResponse = {
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
          lat: property?.latitude ?? null,
          lng: property?.longitude ?? null,
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

  return {
    response,
    toolsUsed,
    evidence,
    synthesis,
    answerWithSources,
    qualityReport,
    postAnswerReport,
    preferredEvidence: answer.preferredEvidence ?? null,
    gateStatus,
    refused,
    clarified,
    knownUnknown,
    requireCounsel,
    sensitiveTopics,
    fairHousingSafety,
    humanDecisionSafety,
    jurisdiction,
    legalResolution,
    legalGate,
    legal,
    sourceTierCounts,
    recommendedExpertId,
    answerConfidence,
    sourcesUsed,
    qualityChecks,
    retrievalCacheHit,
    faithfulness,
    latencyMs,
    promptTokens,
    completionTokens,
    embedTokens,
    propertyClarifyOptions,
    screeningIsolation,
    intentResult,
    question,
    history,
    agentMode,
    landlordId,
    conversationId,
    startedAt,
  } as AskUloValidatedAnswer
}
