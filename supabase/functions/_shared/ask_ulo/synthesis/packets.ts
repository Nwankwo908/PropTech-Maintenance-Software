/**
 * Packet helpers for synthesis — citations, transparency, source chips.
 */

import {
  appendReasoningTransparency,
  humanizeOpsLanguage,
  type TransparencyPacketHints,
} from "./reasoningTransparency.ts"
import { classifyLegalSourceTrust } from "../quality/legalSourceTrust.ts"
import type { AskUloCitation } from "../retrieval/searchInternalData.ts"
import { polishAskUloProse } from "./formatAnswer.ts"
import type { AskUloToolPackets } from "./toolPackets.ts"

export function mergeCitations(packets: AskUloToolPackets): AskUloCitation[] {
  const out: AskUloCitation[] = []
  const seen = new Set<string>()
  for (const group of [
    packets.residents,
    packets.repairsToApprove,
    packets.missingUpdates,
    packets.vendorBest,
    packets.vendorCompletion,
    packets.vendorInactive,
    packets.vendorOverload,
    packets.vendorVerification,
    packets.vendorResponseSpeed,
    packets.recurringRepairs,
    packets.propertyInsights,
    packets.portfolioBriefing,
    packets.periodSummary,
    packets.propertyRanking,
    packets.unitMaintenanceRanking,
    packets.oldestWaitingWorkOrder,
    packets.entityInvestigation,
    packets.deepOpsInvestigation,
    packets.priceHistory,
    packets.rentHistory,
    packets.market,
    packets.ops,
    packets.legal,
    packets.structured,
    packets.property,
  ]) {
    if (!group || !("citations" in group) || !group.citations) continue
    for (const c of group.citations) {
      const key = `${c.tool}|${c.title}|${c.citation ?? ""}|${c.url ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      if (c.tool === "legal_rag" || c.tool === "structured") {
        const tier = c.sourceTier ?? classifyLegalSourceTrust(c).tier
        out.push({ ...c, sourceTier: tier })
      } else {
        out.push(c)
      }
    }
  }
  // Prefer official / agency over mirrors in the chip list.
  out.sort((a, b) => {
    const rank = (t?: AskUloCitation["sourceTier"]) => {
      if (t === "primary_official") return 0
      if (t === "agency_guidance") return 1
      if (t === "discovery_mirror") return 2
      if (t === "untrusted") return 3
      return 4
    }
    return rank(a.sourceTier) - rank(b.sourceTier)
  })
  return out
}

export function packetsToTransparencyHints(packets: AskUloToolPackets): TransparencyPacketHints {
  return {
    intent: packets.intent,
    reasoningMode: packets.reasoningMode,
    narrowFactual: packets.narrowFactual,
    toolsUsed: packets.toolsUsed,
    propertyRanking: packets.propertyRanking
      ? {
          available: packets.propertyRanking.available,
          canRank: packets.propertyRanking.canRank,
          missingData: packets.propertyRanking.missingData,
          portfolioOpenWorkOrders: packets.propertyRanking.portfolioOpenWorkOrders,
          top: packets.propertyRanking.top
            ? {
                building: packets.propertyRanking.top.building,
                whyLines: packets.propertyRanking.top.whyLines,
                criticalWorkOrders: packets.propertyRanking.top.criticalWorkOrders,
                escalatedWorkflows: packets.propertyRanking.top.escalatedWorkflows,
                openWorkOrders: packets.propertyRanking.top.openWorkOrders,
              }
            : null,
        }
      : null,
    unitMaintenanceRanking: packets.unitMaintenanceRanking
      ? {
          available: packets.unitMaintenanceRanking.available,
          canRank: packets.unitMaintenanceRanking.canRank,
          missingData: packets.unitMaintenanceRanking.missingData,
          timeframeLabel: packets.unitMaintenanceRanking.timeframeLabel,
          top: packets.unitMaintenanceRanking.top
            ? {
                unitLabel: packets.unitMaintenanceRanking.top.unitLabel,
                building: packets.unitMaintenanceRanking.top.building,
                totalRequests: packets.unitMaintenanceRanking.top.totalRequests,
                openRequests: packets.unitMaintenanceRanking.top.openRequests,
              }
            : null,
        }
      : null,
    portfolioBriefing: packets.portfolioBriefing
      ? {
          available: packets.portfolioBriefing.available,
          healthScore: packets.portfolioBriefing.healthScore,
          facts: packets.portfolioBriefing.facts,
        }
      : null,
    ops: packets.ops,
    property: packets.property,
    market: packets.market
      ? { available: packets.market.available, gapNote: packets.market.gapNote }
      : null,
    priceHistory: packets.priceHistory
      ? { available: packets.priceHistory.available }
      : null,
    rentHistory: packets.rentHistory
      ? { available: packets.rentHistory.available }
      : null,
    legal: packets.legal,
    structured: packets.structured,
  }
}

/** Ensure analytical answers include Why I reached this conclusion + Confidence. */
export function ensureReasoningTransparency(
  answerMarkdown: string,
  packets: AskUloToolPackets,
): string {
  const withEvidence = appendReasoningTransparency(
    answerMarkdown,
    packetsToTransparencyHints(packets),
  )
  // Landlord-facing polish: translate ops jargon + clip/retrieval leaks.
  // Skip legal answers so statute language stays intact.
  if (packets.intent === "legal") return withEvidence
  return polishAskUloProse(humanizeOpsLanguage(withEvidence))
}
