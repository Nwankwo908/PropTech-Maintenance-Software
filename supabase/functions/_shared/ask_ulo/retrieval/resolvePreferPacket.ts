/**
 * resolvePreferPacket — single policy for “don’t send this to OpenAI / don’t guess.”
 *
 * Ordered decisions:
 * 1. Incomplete / fail-closed (ranking gaps, tool miss, honest gap)
 * 2. Prepared specialty packets (drafts, residents, vendors, …)
 * 3. Catch-all work-order fallback
 * 4. Else → let write synthesize normally
 */

import { logIncompleteEvidence } from "../audit/logDecision.ts"
import {
  buildToolMissIncompleteSignal,
  resolveIncompleteRankingSignal,
} from "../guards/incompleteEvidence.ts"
import { incompleteSubjectGapAnswer } from "../guards/refusalBuilder.ts"
import {
  isHonestGapSubjectQuestion,
  isLandlordIncentivesQuestion,
  isWeatherAlertsQuestion,
  detectQuestionSubject,
} from "../routing/detectSubject.ts"
import type { AskUloContext } from "../core/context.ts"
import type { AskUloTurnPlan } from "../routing/planAskUloTurn.ts"
import type { AskUloEvidence } from "../core/pipelineTypes.ts"

export type PreferPacketResult =
  | {
      prefer: true
      shortCircuit: true
      markdown: string
      tags: string[]
      kind: string
    }
  | {
      prefer: false
      shortCircuit: false
      markdown: null
      tags: []
      kind: null
    }

/** Normalized packet shapes the prefer policy inspects. */
export type PreferPacketBag = {
  question: string
  intent: string
  reasoningMode?: string | null
  playbookId?: string | null
  preferTier1Answer?: boolean
  subject?: string | null
  capability?: string | null
  residentFilter?: string | null
  needsUnitRanking?: boolean
  noToolMatched?: boolean
  attemptCatchAll?: boolean
  specialtyPacketAlready?: boolean
  propertyDashboardLock?: boolean
  openWorkOrdersHint?: number | null
  gatedPropertyRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    portfolioOpenWorkOrders: number
    markdown?: string | null
  } | null
  unitMaintenanceRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    requestCount?: number | null
    unlinkedRequestCount?: number | null
    timeframeLabel?: string | null
    scopeLabel?: string | null
    markdown?: string | null
  } | null
  draftCommunication?: { markdown?: string | null } | null
  activeWorkflows?: { available?: boolean; markdown?: string | null } | null
  weatherAlerts?: { available?: boolean; markdown?: string | null } | null
  landlordIncentives?: { available?: boolean; markdown?: string | null } | null
  residents?: { available?: boolean; markdown?: string | null } | null
  repairsToApprove?: { available?: boolean; markdown?: string | null } | null
  missingUpdates?: { available?: boolean; markdown?: string | null } | null
  vendorInactive?: { available?: boolean; markdown?: string | null } | null
  vendorOverload?: { available?: boolean; markdown?: string | null } | null
  vendorVerification?: { available?: boolean; markdown?: string | null } | null
  vendorCompletion?: { available?: boolean; markdown?: string | null } | null
  vendorBest?: { available?: boolean; markdown?: string | null } | null
  vendorResponseSpeed?: { available?: boolean; markdown?: string | null } | null
  recurringRepairs?: { available?: boolean; markdown?: string | null } | null
  propertyInsights?: {
    found?: boolean
    available?: boolean
    markdown?: string | null
  } | null
  deepOpsInvestigation?: {
    found?: boolean
    markdown?: string | null
    isRepairCostQuestion?: boolean
  } | null
  oldestWaitingWorkOrder?: { markdown?: string | null; found?: boolean } | null
  entityInvestigation?: { markdown?: string | null; found?: boolean } | null
  periodSummary?: { markdown?: string | null; canSummarize?: boolean } | null
  catchAllWorkOrders?: { found?: boolean; markdown?: string | null } | null
}

function hit(
  kind: string,
  markdown: string,
  tagSuffix?: string,
): PreferPacketResult {
  return {
    prefer: true,
    shortCircuit: true,
    markdown,
    tags: [`prefer_packet:${tagSuffix ?? kind}`],
    kind,
  }
}

function none(): PreferPacketResult {
  return {
    prefer: false,
    shortCircuit: false,
    markdown: null,
    tags: [],
    kind: null,
  }
}

function availableMarkdown(
  p: { available?: boolean; markdown?: string | null } | null | undefined,
): string | null {
  if (!p?.markdown) return null
  if (p.available === false) return null
  return p.markdown
}

function isMarketQuestion(bag: PreferPacketBag): boolean {
  return (
    bag.intent === "market_rent_estimate" ||
    bag.intent === "comparable_rentals" ||
    bag.intent === "market_analysis" ||
    detectQuestionSubject(bag.question) === "market_intelligence"
  )
}

function pickVendorPacket(bag: PreferPacketBag): PreferPacketResult | null {
  const playbook = bag.playbookId ?? ""
  const ordered: Array<{ id: string; packet: PreferPacketBag["vendorBest"] }> = []

  const push = (
    id: string,
    packet: PreferPacketBag["vendorBest"],
  ) => {
    if (packet) ordered.push({ id, packet })
  }

  // Playbook-specific first, then remaining vendors.
  if (playbook === "vendor_inactive") {
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_best", bag.vendorBest)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  } else if (playbook === "vendor_overload") {
    push("vendor_overload", bag.vendorOverload)
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_best", bag.vendorBest)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  } else if (playbook === "vendor_verification") {
    push("vendor_verification", bag.vendorVerification)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_best", bag.vendorBest)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  } else if (playbook === "vendor_completion") {
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_best", bag.vendorBest)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  } else if (playbook === "vendor_best") {
    push("vendor_best", bag.vendorBest)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  } else if (playbook === "vendor_speed") {
    push("vendor_response_speed", bag.vendorResponseSpeed)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_best", bag.vendorBest)
  } else {
    push("vendor_inactive", bag.vendorInactive)
    push("vendor_overload", bag.vendorOverload)
    push("vendor_verification", bag.vendorVerification)
    push("vendor_completion", bag.vendorCompletion)
    push("vendor_best", bag.vendorBest)
    push("vendor_response_speed", bag.vendorResponseSpeed)
  }

  const seen = new Set<string>()
  for (const { id, packet } of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    const md = availableMarkdown(packet)
    if (md) return hit(id, md)
  }
  return null
}

/**
 * Core prefer policy. Pure (aside from incomplete-evidence audit log).
 */
export function resolvePreferPacket(bag: PreferPacketBag): PreferPacketResult {
  const rankingPrimary =
    bag.intent === "property_priority" ||
    bag.intent === "unit_maintenance_ranking" ||
    bag.reasoningMode === "comparison_ranking" ||
    bag.reasoningMode === "diagnosis" ||
    bag.reasoningMode === "recommendation"

  const incompleteRanking = resolveIncompleteRankingSignal({
    propertyRanking: bag.gatedPropertyRanking
      ? {
          available: bag.gatedPropertyRanking.available,
          canRank: bag.gatedPropertyRanking.canRank,
          missingData: bag.gatedPropertyRanking.missingData,
          portfolioOpenWorkOrders: bag.gatedPropertyRanking.portfolioOpenWorkOrders,
        }
      : null,
    unitMaintenanceRanking: bag.unitMaintenanceRanking
      ? {
          available: bag.unitMaintenanceRanking.available,
          canRank: bag.unitMaintenanceRanking.canRank,
          missingData: bag.unitMaintenanceRanking.missingData,
          requestCount: bag.unitMaintenanceRanking.requestCount,
          unlinkedRequestCount: bag.unitMaintenanceRanking.unlinkedRequestCount,
          timeframeLabel: bag.unitMaintenanceRanking.timeframeLabel,
          scopeLabel: bag.unitMaintenanceRanking.scopeLabel,
        }
      : null,
    reasoningMode: bag.reasoningMode,
    preferUnit:
      bag.intent === "unit_maintenance_ranking" || Boolean(bag.needsUnitRanking),
  })

  if (incompleteRanking && rankingPrimary) {
    logIncompleteEvidence({
      kind: incompleteRanking.kind,
      status: incompleteRanking.status,
      missing: incompleteRanking.missing,
      known: incompleteRanking.known,
      authority: "code",
    })
    return hit(
      `incomplete_${incompleteRanking.kind}`,
      incompleteRanking.markdown,
      `incomplete_${incompleteRanking.kind}:${incompleteRanking.status}`,
    )
  }

  const draftMd = bag.draftCommunication?.markdown
  if (draftMd) return hit("draft_communication", draftMd)

  const workflowsMd = availableMarkdown(bag.activeWorkflows)
  if (workflowsMd) return hit("list_active_workflows", workflowsMd)

  const weatherMd = availableMarkdown(bag.weatherAlerts)
  if (weatherMd) return hit("get_weather_alerts", weatherMd)

  const incentivesMd = availableMarkdown(bag.landlordIncentives)
  if (incentivesMd) return hit("get_landlord_incentives", incentivesMd)

  const residentsMd = availableMarkdown(bag.residents)
  if (residentsMd) return hit("search_residents", residentsMd)

  const repairsMd = availableMarkdown(bag.repairsToApprove)
  if (repairsMd) return hit("repairs_to_approve", repairsMd)

  const missingMd = availableMarkdown(bag.missingUpdates)
  if (missingMd) return hit("missing_updates", missingMd)

  const vendorHit = pickVendorPacket(bag)
  if (vendorHit) return vendorHit

  const recurringMd = availableMarkdown(bag.recurringRepairs)
  if (recurringMd) return hit("recurring_repairs", recurringMd)

  if (
    !isMarketQuestion(bag) &&
    bag.preferTier1Answer &&
    bag.propertyInsights?.markdown &&
    (bag.propertyInsights.found || bag.propertyInsights.available)
  ) {
    return hit("property_insights", bag.propertyInsights.markdown)
  }

  if (
    bag.deepOpsInvestigation?.markdown &&
    (bag.deepOpsInvestigation.found ||
      bag.deepOpsInvestigation.isRepairCostQuestion)
  ) {
    return hit("deep_ops", bag.deepOpsInvestigation.markdown)
  }

  if (bag.oldestWaitingWorkOrder?.markdown) {
    return hit("oldest_waiting_work_order", bag.oldestWaitingWorkOrder.markdown)
  }

  if (bag.entityInvestigation?.markdown) {
    return hit("entity_investigation", bag.entityInvestigation.markdown)
  }

  if (
    bag.unitMaintenanceRanking?.markdown &&
    bag.unitMaintenanceRanking.canRank
  ) {
    return hit("unit_maintenance_ranking", bag.unitMaintenanceRanking.markdown)
  }

  if (bag.periodSummary?.markdown && bag.periodSummary.canSummarize !== false) {
    return hit("period_summary", bag.periodSummary.markdown)
  }

  if (bag.catchAllWorkOrders?.found && bag.catchAllWorkOrders.markdown) {
    return hit(
      "catchall_search_work_orders",
      bag.catchAllWorkOrders.markdown,
    )
  }

  if (
    (bag.noToolMatched ||
      (bag.attemptCatchAll && !bag.catchAllWorkOrders?.found)) &&
    !bag.specialtyPacketAlready
  ) {
    const toolMiss = buildToolMissIncompleteSignal({
      noToolMatched: Boolean(bag.noToolMatched),
      catchallNone: Boolean(
        bag.attemptCatchAll && !bag.catchAllWorkOrders?.found,
      ),
      subject: bag.subject ?? "other",
      openWorkOrders: bag.openWorkOrdersHint ?? null,
    })
    if (toolMiss) {
      logIncompleteEvidence({
        kind: toolMiss.kind,
        status: toolMiss.status,
        missing: toolMiss.missing,
        known: toolMiss.known,
        authority: "code",
      })
      return hit(
        `incomplete_${toolMiss.kind}`,
        toolMiss.markdown,
        `incomplete_${toolMiss.kind}:${toolMiss.status}`,
      )
    }
  }

  if (
    isHonestGapSubjectQuestion(bag.question) &&
    bag.capability !== "draft" &&
    !isWeatherAlertsQuestion(bag.question) &&
    !isLandlordIncentivesQuestion(bag.question) &&
    /\b(forecast|predict|might\s+not\s+renew|before\s+winter|most\s+likely\s+to\s+need)\b/i
      .test(bag.question)
  ) {
    return hit(
      "honest_gap",
      incompleteSubjectGapAnswer({
        subject: bag.subject ?? "other",
        openCount: bag.openWorkOrdersHint ?? null,
        residentFilter: bag.residentFilter ?? null,
        capability: bag.capability ?? null,
        question: bag.question,
      }),
    )
  }

  return none()
}

/** Build prefer bag from retrieve evidence + plan. */
export function preferPacketBagFromEvidence(input: {
  question: string
  route: AskUloTurnPlan | {
    intentResult: { intent: string }
    capability?: {
      capability?: string
      hints?: { residentFilter?: string | null }
    }
    evidencePlan?: { subject?: string }
    reasoningMode?: { mode?: string }
    playbook?: { id?: string; preferTier1Answer?: boolean }
  }
  evidence: AskUloEvidence | Record<string, unknown>
}): PreferPacketBag {
  const e = input.evidence as Record<string, any>
  const route = input.route as Record<string, any>
  const capability = e.capabilityResult ?? route.capability
  const evidencePlan = e.evidencePlan ?? route.evidencePlan
  const reasoning = e.reasoningEarly ?? route.reasoningMode
  const playbook = e.playbook ?? route.playbook

  return {
    question: input.question,
    intent: route.intentResult?.intent ?? e.intentResult?.intent ?? "ops",
    reasoningMode: reasoning?.mode ?? null,
    playbookId: playbook?.id ?? null,
    preferTier1Answer: Boolean(playbook?.preferTier1Answer),
    subject: evidencePlan?.subject ?? null,
    capability: capability?.capability ?? null,
    residentFilter: capability?.hints?.residentFilter ?? null,
    needsUnitRanking: Boolean(e.needsUnitRanking),
    noToolMatched: Boolean(e.noToolMatched),
    attemptCatchAll: Boolean(e.attemptCatchAll),
    specialtyPacketAlready: Boolean(e.specialtyPacketAlready),
    propertyDashboardLock: Boolean(
      e.propertyDashboardLock ?? evidencePlan?.blockPropertyDashboard,
    ),
    openWorkOrdersHint:
      typeof e.gatedPortfolioBriefing?.facts?.openWorkOrders === "number"
        ? e.gatedPortfolioBriefing.facts.openWorkOrders
        : typeof e.oldestWaitingWorkOrder?.openCount === "number"
        ? e.oldestWaitingWorkOrder.openCount
        : null,
    gatedPropertyRanking: e.gatedPropertyRanking ?? e.propertyRanking ?? null,
    unitMaintenanceRanking: e.unitMaintenanceRanking
      ? {
          available: e.unitMaintenanceRanking.available,
          canRank: e.unitMaintenanceRanking.canRank,
          missingData: e.unitMaintenanceRanking.missingData ?? [],
          requestCount: e.unitMaintenanceRanking.scopedRequestCount,
          unlinkedRequestCount: e.unitMaintenanceRanking.unlinkedRequestCount,
          timeframeLabel: e.unitMaintenanceRanking.timeframeLabel,
          scopeLabel: e.unitMaintenanceRanking.scopeLabel,
          markdown: e.unitMaintenanceRanking.markdown,
        }
      : null,
    draftCommunication: e.draftCommunicationResult ?? null,
    activeWorkflows: e.activeWorkflowsResult ?? null,
    weatherAlerts: e.weatherAlertsResult ?? null,
    landlordIncentives: e.landlordIncentivesResult ?? null,
    residents: e.residentsList ?? e.residents ?? null,
    repairsToApprove: e.repairsToApprove ?? null,
    missingUpdates: e.missingUpdates ?? null,
    vendorInactive: e.vendorInactive ?? null,
    vendorOverload: e.vendorOverload ?? null,
    vendorVerification: e.vendorVerification ?? null,
    vendorCompletion: e.vendorCompletion ?? null,
    vendorBest: e.vendorBest ?? null,
    vendorResponseSpeed: e.vendorResponseSpeed ?? null,
    recurringRepairs: e.recurringRepairs ?? null,
    propertyInsights: e.propertyInsightsForAnswer ?? e.propertyInsights ?? null,
    deepOpsInvestigation: e.deepOpsInvestigation ?? null,
    oldestWaitingWorkOrder: e.oldestWaitingWorkOrder ?? null,
    entityInvestigation: e.entityInvestigation ?? null,
    periodSummary: e.periodSummary ?? null,
    catchAllWorkOrders: e.catchAllWorkOrders ?? null,
  }
}

/** Pipeline stage entry — same contract as former handlePreferredEvidence. */
export function handlePreferredEvidence(input: {
  context: AskUloContext
  route: AskUloTurnPlan | {
    intentResult: AskUloTurnPlan["intentResult"]
    capability: AskUloTurnPlan["capability"]
    evidencePlan: AskUloTurnPlan["evidencePlan"]
    reasoningMode?: AskUloTurnPlan["reasoningMode"]
    playbook?: AskUloTurnPlan["playbook"]
  }
  evidence: AskUloEvidence
}): PreferPacketResult {
  const bag = preferPacketBagFromEvidence({
    question: input.context.question,
    route: input.route,
    evidence: input.evidence,
  })
  return resolvePreferPacket(bag)
}

/** Build prefer bag from AskUloToolPackets (synthesis path). */
export function preferPacketBagFromToolPackets(
  packets: Record<string, any>,
): PreferPacketBag {
  const um = packets.unitMaintenanceRanking
  return {
    question: String(packets.question ?? ""),
    intent: String(packets.intent ?? "ops"),
    reasoningMode: packets.reasoningMode ?? null,
    playbookId: packets.investigationPlaybook?.id ?? null,
    preferTier1Answer: Boolean(packets.investigationPlaybook?.preferTier1Answer),
    gatedPropertyRanking: packets.propertyRanking ?? null,
    unitMaintenanceRanking: um
      ? {
          available: um.available,
          canRank: um.canRank,
          missingData: um.missingData ?? [],
          requestCount: um.requestCount ?? um.scopedRequestCount,
          unlinkedRequestCount: um.unlinkedRequestCount,
          timeframeLabel: um.timeframeLabel,
          scopeLabel: um.scopeLabel,
          markdown: um.markdown,
        }
      : null,
    residents: packets.residents ?? null,
    repairsToApprove: packets.repairsToApprove ?? null,
    missingUpdates: packets.missingUpdates ?? null,
    vendorInactive: packets.vendorInactive ?? null,
    vendorOverload: packets.vendorOverload ?? null,
    vendorVerification: packets.vendorVerification ?? null,
    vendorCompletion: packets.vendorCompletion ?? null,
    vendorBest: packets.vendorBest ?? null,
    vendorResponseSpeed: packets.vendorResponseSpeed ?? null,
    recurringRepairs: packets.recurringRepairs ?? null,
    propertyInsights: packets.propertyInsights ?? null,
    deepOpsInvestigation: packets.deepOpsInvestigation ?? null,
    oldestWaitingWorkOrder: packets.oldestWaitingWorkOrder ?? null,
    entityInvestigation: packets.entityInvestigation ?? null,
    periodSummary: packets.periodSummary ?? null,
  }
}

/** @deprecated Alias for PreferPacketResult — kept for pipelineTypes imports. */
export type PreferredEvidenceResult = PreferPacketResult

