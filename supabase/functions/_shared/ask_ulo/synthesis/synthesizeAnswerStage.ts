// @ts-nocheck
// Pipeline stage extracted from runAskUlo — types tightened incrementally.
/**
 * Synthesize answer from evidence (prefer-packet short-circuit handled upstream).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../audit/logGraphEvent.ts"
import {
  formatQualityChecksForAudit,
  plannedToolNames,
  runAnswerQualityGate,
} from "../quality/validateFinalAnswer.ts"
import { applyAskUloAgentModeBias } from "../routing/selectMode.ts"
import {
  draftCommunication,
  type DraftCommunicationResult,
} from "../tools/maintenance/draftCommunication.ts"
import {
  listActiveWorkflows,
  type ListActiveWorkflowsResult,
} from "../tools/maintenance/listActiveWorkflows.ts"
import {
  getWeatherAlerts,
  type GetWeatherAlertsResult,
} from "../tools/localMarket/getWeatherAlerts.ts"
import {
  getLandlordIncentives,
  type GetLandlordIncentivesResult,
} from "../tools/finance/getLandlordIncentives.ts"
import {
  COUNSEL_EXPERT_ROLES,
  recommendCounselExpert,
  type CounselExpertRoleId,
} from "../audit/counselHandoff.ts"
import {
  polishAskUloProse,
} from "../synthesis/formatAnswer.ts"
import { humanizeOpsLanguage } from "../synthesis/reasoningTransparency.ts"
import { classifyAskUloIntent, planToolsForIntent } from "../routing/detectIntent.ts"
import { isNarrowFactualOpsQuestion } from "../routing/briefingIntent.ts"
import { isPeriodSummaryQuestion, classifyResponseFormat } from "../routing/dynamicResponse.ts"
import { portfolioBriefingLookup } from "../tools/properties/portfolioBriefingLookup.ts"
import { propertyRankingLookup } from "../tools/properties/propertyRankingLookup.ts"
import { periodSummaryLookup } from "../tools/properties/periodSummaryLookup.ts"
import { unitMaintenanceRankingLookup } from "../tools/maintenance/unitMaintenanceRankingLookup.ts"
import { oldestWaitingWorkOrderLookup } from "../tools/maintenance/oldestWaitingWorkOrderLookup.ts"
import { entityInvestigationLookup } from "../tools/maintenance/entityInvestigationLookup.ts"
import { isOldestWaitingWorkOrderQuestion } from "../tools/maintenance/taskCompletion.ts"
import { isEntityInvestigationQuestion } from "../tools/maintenance/entityInvestigation.ts"
import { requiresDeepOperationalInvestigation } from "../tools/maintenance/deepOperationalInvestigation.ts"
import { extractBuildingFilter } from "../tools/properties/buildingFilter.ts"
import { deepOperationalInvestigationLookup } from "../tools/maintenance/deepOperationalInvestigationLookup.ts"
import { recurringRepairsLookup } from "../tools/maintenance/recurringRepairsLookup.ts"
import { missingUpdatesLookup } from "../tools/maintenance/missingUpdatesLookup.ts"
import { vendorResponseSpeedLookup } from "../tools/vendors/vendorResponseSpeedLookup.ts"
import { vendorBestLookup } from "../tools/vendors/vendorBestLookup.ts"
import { vendorCompletionLookup } from "../tools/vendors/vendorCompletionLookup.ts"
import { vendorInactiveLookup } from "../tools/vendors/vendorInactiveLookup.ts"
import { vendorVerificationStatusLookup } from "../tools/vendors/vendorVerificationStatusLookup.ts"
import { vendorOverloadLookup } from "../tools/vendors/vendorOverloadLookup.ts"
import {
  detectQuestionSubject,
  isHonestGapSubjectQuestion,
  isUloActiveTasksQuestion,
  isWeatherAlertsQuestion,
  isLandlordIncentivesQuestion,
} from "../routing/detectSubject.ts"
import {
  formatPriceHistoryMarkdown,
} from "../tools/finance/propertyPriceHistory.ts"
import {
  formatRentHistoryMarkdown,
} from "../tools/rent/rentHistoryLookup.ts"
import {
  assessAnswerConfidence,
  buildSourcesUsed,
  type AnswerConfidence,
} from "../retrieval/rankEvidence.ts"
import { synthesizeAskUloAnswer } from "../synthesis/index.ts"
import type { AskUloResponse } from "../core/types.ts"
import type { AskUloContext } from "../core/context.ts"
import type { AskUloExecutionPlan } from "../routing/buildExecutionPlan.ts"
import type { AskUloSafetyContinue } from "../guards/runSafetyChecks.ts"
import type { AskUloDraftAnswer, AskUloEvidence } from "../core/pipelineTypes.ts"
import type { PreferPacketResult } from "../retrieval/resolvePreferPacket.ts"

export async function synthesizeAnswer(input: {
  context: AskUloContext
  route: AskUloExecutionPlan
  evidence: AskUloEvidence
  safety: AskUloSafetyContinue
  /** From resolvePreferPacket — when prefer/shortCircuit, skip OpenAI. */
  preferred?: PreferPacketResult | null
}): Promise<AskUloDraftAnswer> {
  const { context, route, evidence, safety, preferred } = input
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
  const e = evidence as Record<string, any>
  const retrievalQuestion = e.retrievalQuestion ?? context.retrievalQuestion
  const portfolioJurisdiction =
    e.portfolioJurisdiction ?? context.portfolioJurisdiction
  const buildingFilter =
    e.buildingFilter ?? context.propertyScope.buildingFilter
  const toolsUsed = [...(e.toolsUsed ?? [])]
  const legalResolution = e.legalResolution
  const effectiveJurisdiction = e.effectiveJurisdiction
  const runLegalTools = e.runLegalTools
  const legal = e.legal
  const structured = e.structured
  const retrievalCacheHit = e.retrievalCacheHit
  const executionPlan = e.executionPlan
  const reasoningEarly = e.reasoningEarly
  const analytical = e.analytical
  const playbook = e.playbook
  const evidencePlan = e.evidencePlan
  const capabilityResult = e.capabilityResult
  const capabilityRoute = e.capabilityRoute
  const epistemicAsk = e.epistemicAsk
  const compoundVendorMarket = e.compoundVendorMarket
  const toolSelectLocks = e.toolSelectLocks
  const toolAllowlist = e.toolAllowlist
  const rulePlannedTools = e.rulePlannedTools
  const vendorSubjectLock = e.vendorSubjectLock
  const propertyDashboardLock = e.propertyDashboardLock
  const plannedTools = e.plannedTools
  const toolSelectSource = e.toolSelectSource
  const noToolMatched = e.noToolMatched
  const toolNeeds = e.toolNeeds
  const propertyInsightsForAnswer = e.propertyInsightsForAnswer
  const toolsCalled = e.toolsCalled
  const searchWorkOrdersHit = e.searchWorkOrdersHit
  const catchAllWorkOrders = e.catchAllWorkOrders
  const specialtyPacketAlready = e.specialtyPacketAlready
  const attemptCatchAll = e.attemptCatchAll
  const epistemicOutcome = e.epistemicOutcome
  const evidenceBundle = e.evidenceBundle
  const finalizedEvidence = e.finalizedEvidence
  const evidencePacket = e.evidencePacket
  const propertyForSynthesis = e.propertyForSynthesis
  const portfolioBuildingNames = e.portfolioBuildingNames
  const recommendedExpertId = e.recommendedExpertId
  const legalGate = e.legalGate
  const sourceTierCounts = e.sourceTierCounts
  const resolvedBuilding = e.resolvedBuilding
  const needsPropertyScope = e.needsPropertyScope
  const propertyClarifyOptions = e.propertyClarifyOptions
  const groundingReason = e.groundingReason
  const groundingOk = e.groundingOk
  const jurisdiction = e.jurisdiction
  const market = e.market
  const priceHistory = e.priceHistory
  const rentHistory = e.rentHistory
  const ops = e.ops
  const reasoning = e.reasoning
  const narrowFactual = e.narrowFactual
  const gatedPropertyRanking = e.gatedPropertyRanking
  const gatedPortfolioBriefing = e.gatedPortfolioBriefing
  // Packets from retrieve (were missing from evidence bag before)
  const residentsList = e.residentsList
  const draftCommunicationResult = e.draftCommunicationResult
  const activeWorkflowsResult = e.activeWorkflowsResult
  const weatherAlertsResult = e.weatherAlertsResult
  const landlordIncentivesResult = e.landlordIncentivesResult
  const unitMaintenanceRanking = e.unitMaintenanceRanking
  const recurringRepairs = e.recurringRepairs
  const repairsToApprove = e.repairsToApprove
  const missingUpdates = e.missingUpdates
  const vendorResponseSpeed = e.vendorResponseSpeed
  const vendorBest = e.vendorBest
  const vendorCompletion = e.vendorCompletion
  const vendorInactive = e.vendorInactive
  const vendorOverload = e.vendorOverload
  const vendorVerification = e.vendorVerification
  const propertyRanking = e.propertyRanking
  const periodSummary = e.periodSummary
  const oldestWaitingWorkOrder = e.oldestWaitingWorkOrder
  const entityInvestigation = e.entityInvestigation
  const deepOpsInvestigation = e.deepOpsInvestigation
  const property = e.property
  const portfolioBriefing = e.portfolioBriefing

  if (preferred?.shortCircuit && preferred.markdown) {
    for (const tag of preferred.tags) toolsUsed.push(tag)
    const synthesis = {
      answer: preferred.markdown,
      citations: [] as AskUloResponse["citations"],
      mode: "fallback" as const,
      model: null,
      synthesizeMs: 0,
      usage: null,
    }
    return {
      synthesis,
      answerWithSources: preferred.markdown,
      toolsUsed,
      evidence,
      ...e,
      preferredEvidence: preferred,
      fairHousingSafety,
      humanDecisionSafety,
      sensitiveTopics,
      screeningIsolation,
      requireCounsel,
      counselNote,
      intentResult,
      question,
      history,
      agentMode,
      landlordId,
      conversationId,
      startedAt,
    } as AskUloDraftAnswer
  }

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
    evidencePacket: evidencePacket ?? null,
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

  return {
    synthesis,
    answerWithSources,
    toolsUsed,
    evidence,
    // pass through for validate
    ...e,
    preferredEvidence: preferred ?? null,
    fairHousingSafety,
    humanDecisionSafety,
    sensitiveTopics,
    screeningIsolation,
    requireCounsel,
    counselNote,
    intentResult,
    question,
    history,
    agentMode,
    landlordId,
    conversationId,
    startedAt,
  } as AskUloDraftAnswer
}
