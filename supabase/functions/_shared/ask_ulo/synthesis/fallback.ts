/**
 * Deterministic fallback answers when OpenAI is unavailable or skipped.
 * Portfolio summaries, priority lists, market/legal formatting.
 */

import {
  incompleteEntityRootCauseAnswer,
  incompleteOldestWaitingAnswer,
} from "../guards/refusalBuilder.ts"
import {
  buildPropertyRankingIncompleteSignal,
  buildUnitRankingIncompleteSignal,
} from "../guards/incompleteEvidence.ts"
import {
  preferPacketBagFromToolPackets,
  resolvePreferPacket,
} from "../retrieval/resolvePreferPacket.ts"
import { detectQuestionSubject } from "../routing/detectSubject.ts"
import { isAnyVendorMetricQuestion } from "../tools/_shared/questionMetricContext.ts"
import { formatCounselHandoffMarkdown } from "../audit/counselHandoff.ts"
import { formatLegalAttributionMarkdown } from "../quality/legalAnswerAttribution.ts"
import type { AskUloToolPackets } from "./toolPackets.ts"
import { mergeCitations } from "./packets.ts"

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function buildFallbackExecutiveBriefing(packets: AskUloToolPackets): string {
  const b = packets.portfolioBriefing
  if (!b?.available) {
    return [
      "## Overall Assessment",
      "I couldn't assemble a full portfolio briefing from live ops data yet.",
      "",
      "## Recommended Next Steps",
      "- Confirm your portfolio has units and open tickets loaded, then ask again.",
    ].join("\n")
  }

  const facts = b.facts as {
    openWorkOrders?: number
    criticalWorkOrders?: number
    escalatedWorkflows?: number
    occupancyPct?: number | null
    recurringHotspots?: string[]
    recentUloActions?: string[]
    agingWorkOrders?: number
    awaitingDecision?: number
  }

  const parts: string[] = []
  parts.push("## Overall Assessment")
  if (b.healthScore != null) {
    parts.push(
      `Overall, your portfolio is **${b.assessment.toLowerCase()}** at **${b.healthScore}/100**` +
        (facts.criticalWorkOrders
          ? `, with maintenance performance needing attention.`
          : `.`),
    )
  } else {
    parts.push(
      `Overall assessment: **${b.assessment}**. Property Health score is unavailable from current signals.`,
    )
  }

  const goingWell: string[] = []
  if (facts.occupancyPct != null && facts.occupancyPct >= 90) {
    goingWell.push(`Occupancy remains strong at ${facts.occupancyPct}%.`)
  }
  if ((facts.openWorkOrders ?? 0) === 0) {
    goingWell.push("There are no open maintenance work orders right now.")
  }
  if ((facts.escalatedWorkflows ?? 0) === 0 && (facts.openWorkOrders ?? 0) > 0) {
    goingWell.push("Nothing currently requires your urgent decision.")
  }
  parts.push("")
  parts.push("## What's Going Well")
  if (goingWell.length) {
    for (const line of goingWell.slice(0, 3)) parts.push(`- ${line}`)
  } else {
    parts.push("- No strong positive signals stood out in the latest packet beyond baseline operations.")
  }

  parts.push("")
  parts.push("## What Needs Attention")
  const attention: string[] = []
  if ((facts.openWorkOrders ?? 0) > 0) {
    attention.push(
      `You have ${facts.openWorkOrders} open work orders` +
        ((facts.criticalWorkOrders ?? 0) > 0
          ? `, including ${facts.criticalWorkOrders} critical/urgent.`
          : "."),
    )
  }
  if ((facts.escalatedWorkflows ?? 0) > 0) {
    attention.push(
      `${facts.escalatedWorkflows} item(s) require your attention and need follow-up.`,
    )
  }
  if ((facts.awaitingDecision ?? 0) > 0) {
    attention.push(
      `${facts.awaitingDecision} item(s) are waiting on your decision.`,
    )
  }
  if ((facts.agingWorkOrders ?? 0) > 0) {
    attention.push(
      `${facts.agingWorkOrders} repair request(s) have been waiting longer than expected.`,
    )
  }
  for (const h of (facts.recurringHotspots ?? []).slice(0, 2)) {
    attention.push(h)
  }
  if (attention.length) {
    for (const line of attention.slice(0, 5)) parts.push(`- ${line}`)
  } else {
    parts.push("- No critical risks were flagged in the current packet.")
  }

  parts.push("")
  parts.push("## Recommended Next Steps")
  const hasHardRisk =
    (facts.escalatedWorkflows ?? 0) > 0 ||
    (facts.criticalWorkOrders ?? 0) > 0 ||
    (facts.agingWorkOrders ?? 0) > 0 ||
    (facts.recurringHotspots ?? []).length > 0 ||
    (facts.awaitingDecision ?? 0) > 0
  if ((facts.escalatedWorkflows ?? 0) > 0) {
    parts.push(
      "- Follow up on items that require your attention first — assign the job to a different vendor or make the pending decision.",
    )
  }
  if ((facts.criticalWorkOrders ?? 0) > 0) {
    parts.push("- Review critical/urgent requests first and confirm a vendor is on the way.")
  }
  if ((facts.agingWorkOrders ?? 0) > 0) {
    parts.push(
      "- Prioritize repair requests that have been waiting longer than expected.",
    )
  }
  if ((facts.recurringHotspots ?? []).length > 0) {
    parts.push(
      `- Schedule a preventive inspection for the recurring hotspot: ${facts.recurringHotspots![0]}.`,
    )
  }
  if ((facts.awaitingDecision ?? 0) > 0 && !((facts.escalatedWorkflows ?? 0) > 0)) {
    parts.push("- Resolve items waiting on your decision so operations can move forward.")
  }
  if (!hasHardRisk) {
    if ((facts.openWorkOrders ?? 0) === 0) {
      parts.push("- No action is needed right now.")
      parts.push("- Continue monitoring new maintenance requests as they come in.")
    } else {
      parts.push("- Keep an eye on open requests, but nothing here needs emergency escalation today.")
    }
  }

  const actions = facts.recentUloActions ?? []
  if (actions.length) {
    parts.push("")
    parts.push("## What Ulo Handled")
    for (const a of actions.slice(0, 2)) parts.push(`- ${a}`)
  }

  return parts.join("\n")
}

function buildFallbackPropertyPriority(packets: AskUloToolPackets): string {
  const ranking = packets.propertyRanking
  const mode = packets.reasoningMode ?? "comparison_ranking"

  if (!ranking?.available) {
    return (
      buildPropertyRankingIncompleteSignal({
        available: false,
        canRank: false,
        missingData: ["property-level maintenance signals"],
        portfolioOpenWorkOrders: 0,
        reasoningMode: mode,
      })?.markdown ??
      [
        "## Top Priority",
        "I couldn't load property-level signals for a reliable ranking right now.",
      ].join("\n")
    )
  }

  if (!ranking.canRank || !ranking.top) {
    return (
      buildPropertyRankingIncompleteSignal({
        available: ranking.available,
        canRank: false,
        missingData: ranking.missingData,
        portfolioOpenWorkOrders: ranking.portfolioOpenWorkOrders,
        reasoningMode: mode,
      })?.markdown ??
      [
        "## Top Priority",
        "I couldn't reliably compare your properties from portfolio totals alone.",
      ].join("\n")
    )
  }

  const top = ranking.top
  const parts: string[] = []

  if (mode === "diagnosis") {
    parts.push("## What's Becoming a Problem")
    parts.push(
      `**${top.building}** is the clearest operational pressure point right now.`,
    )
    parts.push("")
    parts.push("## What's Driving It")
  } else {
    parts.push(mode === "recommendation" ? "## Do This First" : "## Top Priority")
    parts.push(
      mode === "recommendation"
        ? `If I owned this portfolio, I'd start with **${top.building}**.`
        : `**${top.building} needs your attention first.**`,
    )
    parts.push("")
    parts.push(mode === "recommendation" ? "## Why That First" : "## Why It Ranks First")
  }

  for (const line of top.whyLines.slice(0, 4)) {
    parts.push(`- ${line}`)
  }
  if (top.whyLines.length === 0) {
    parts.push(
      `- ${top.openWorkOrders} open work orders` +
        (top.criticalWorkOrders ? ` including ${top.criticalWorkOrders} critical/urgent` : "") +
        ".",
    )
  }

  parts.push("")
  parts.push("## Recommended Actions")
  top.recommendedActions.forEach((a, i) => {
    parts.push(`${i + 1}. ${a}`)
  })

  if (ranking.watch.length > 0) {
    parts.push("")
    parts.push("## Also Watch")
    for (const w of ranking.watch.slice(0, 2)) {
      const why = w.whyLines[0] ?? `${w.openWorkOrders} open work orders`
      parts.push(`- **${w.building}**: ${why}`)
    }
  }

  return parts.join("\n")
}

function buildFallbackUnitMaintenanceRanking(packets: AskUloToolPackets): string {
  const ranking = packets.unitMaintenanceRanking
  if (ranking && !ranking.canRank) {
    return (
      buildUnitRankingIncompleteSignal({
        available: ranking.available,
        canRank: false,
        missingData: ranking.missingData,
        requestCount: ranking.scopedRequestCount,
        unlinkedRequestCount: ranking.unlinkedRequestCount,
        timeframeLabel: ranking.timeframeLabel,
        scopeLabel: ranking.scopeLabel,
      })?.markdown ??
      ranking.markdown
    )
  }
  if (ranking?.markdown) return ranking.markdown

  return (
    buildUnitRankingIncompleteSignal({
      available: false,
      canRank: false,
      missingData: ["which units those maintenance requests belong to"],
    })?.markdown ??
    [
      "## Quick Answer",
      "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
    ].join("\n")
  )
}

function buildFallbackPeriodSummary(packets: AskUloToolPackets): string {
  const summary = packets.periodSummary
  if (summary?.markdown) return summary.markdown

  return [
    "## This Week at a Glance",
    "I can see current maintenance totals, but I do not have the event history needed to create a reliable weekly summary.",
  ].join("\n")
}

/** Deterministic answer when OpenAI is unavailable. */
export function buildFallbackAskUloAnswer(packets: AskUloToolPackets): string {
  if (
    packets.intent === "legal" &&
    packets.legalGate &&
    (packets.legalGate.status === "clarify" || packets.legalGate.status === "refuse") &&
    packets.legalGate.markdown
  ) {
    return packets.legalGate.markdown
  }

  if (
    packets.intent === "property_price_history" ||
    packets.intent === "price_history_ambiguous"
  ) {
    if (packets.priceHistory?.markdown) return packets.priceHistory.markdown
    return [
      "## Price History",
      "I couldn't load sale/valuation history for that property yet.",
      "",
      "## Next Steps",
      "- Name the building (e.g. Maple Heights) and ask again.",
    ].join("\n")
  }

  if (packets.intent === "rent_history") {
    if (packets.rentHistory?.markdown) return packets.rentHistory.markdown
    return [
      "## Rent History",
      packets.rentHistory?.gapNote ?? "Rent history is not available yet.",
    ].join("\n")
  }

  if (packets.intent === "period_summary") {
    return buildFallbackPeriodSummary(packets)
  }

  if (packets.intent === "oldest_waiting_work_order") {
    return (
      packets.oldestWaitingWorkOrder?.markdown ??
      incompleteOldestWaitingAnswer()
    )
  }

  if (packets.intent === "entity_investigation") {
    return (
      packets.entityInvestigation?.markdown ??
      incompleteEntityRootCauseAnswer()
    )
  }

  // Specialty / incomplete / catch-all — same policy as prefer stage.
  const preferredFallback = resolvePreferPacket(preferPacketBagFromToolPackets(packets))
  if (preferredFallback.prefer) return preferredFallback.markdown

  if (packets.intent === "unit_maintenance_ranking") {
    return buildFallbackUnitMaintenanceRanking(packets)
  }

  if (packets.intent === "property_priority") {
    return buildFallbackPropertyPriority(packets)
  }

  if (packets.intent === "executive_briefing" || packets.intent === "property_health") {
    return buildFallbackExecutiveBriefing(packets)
  }

  // Ranking-style questions that somehow kept another intent still use the packet.
  if (packets.entityInvestigation?.markdown) {
    return packets.entityInvestigation.markdown
  }

  if (packets.oldestWaitingWorkOrder?.markdown) {
    return packets.oldestWaitingWorkOrder.markdown
  }

  if (packets.periodSummary) {
    return buildFallbackPeriodSummary(packets)
  }

  if (packets.unitMaintenanceRanking) {
    return buildFallbackUnitMaintenanceRanking(packets)
  }

  if (
    packets.propertyRanking &&
    !isAnyVendorMetricQuestion(packets.question) &&
    detectQuestionSubject(packets.question) !== "vendor" &&
    (packets.reasoningMode === "comparison_ranking" ||
      packets.reasoningMode === "diagnosis" ||
      packets.reasoningMode === "recommendation")
  ) {
    return buildFallbackPropertyPriority(packets)
  }

  // Never answer a vendor question with a portfolio briefing packet.
  if (
    detectQuestionSubject(packets.question) === "vendor" &&
    packets.portfolioBriefing?.markdown
  ) {
    // Prefer any vendor packet already handled above; if we got here, say what's missing.
    return [
      "I need vendor activity data to answer that — not a portfolio health summary.",
      "",
      "### What I'd do",
      "Ask which vendors haven't accepted jobs, who responds fastest, or who has the best completion rate, and I'll rank from vendor scores.",
    ].join("\n")
  }

  if (packets.narrowFactual && packets.ops?.bullets.length) {
    const openLine =
      packets.ops.bullets.find((b) => /open maintenance tickets/i.test(b)) ??
      packets.ops.bullets[0]
    return [
      "## Quick Answer",
      humanizeRetrievalLine(openLine),
      "",
      "## Recommended Next Steps",
      "- Review critical and overdue items first.",
    ].join("\n")
  }

  const j = packets.jurisdiction
  const parts: string[] = []

  if (packets.intent === "comparable_rentals") {
    parts.push("## Comparable Rentals")
    if (packets.market?.available) {
      parts.push("Here are nearby rentals grounded in live market data.")
      parts.push("_Interactive comps with View Listing links appear below._")
    } else {
      parts.push(packets.market?.gapNote ?? "Live comps aren't available yet.")
    }
    parts.push("## Next Steps")
    parts.push("- Ask for a full market analysis if you want Street View and rent positioning.")
    return parts.join("\n")
  }

  if (packets.intent === "market_rent_estimate") {
    parts.push("## Quick Answer")
    if (packets.market?.estimatedRent != null) {
      parts.push(
        `I'd price around **${money(packets.market.estimatedRent)}/mo**` +
          (packets.market.rentRangeLow != null && packets.market.rentRangeHigh != null
            ? ` (typical range ${money(packets.market.rentRangeLow)}–${money(packets.market.rentRangeHigh)})`
            : "") +
          ".",
      )
    } else {
      parts.push(packets.market?.gapNote ?? "I don't have a live rent estimate yet.")
    }
    parts.push("## Next Steps")
    parts.push("- Ask for comps if you want to inspect nearby listings.")
    return parts.join("\n")
  }

  if (packets.intent === "market_analysis") {
    parts.push("## Market Summary")
    const building = packets.property?.buildingName
    const place = [j.cityLabel, j.stateCode].filter(Boolean).join(", ")

    if (packets.market?.available && packets.market.estimatedRent != null) {
      const src =
        packets.market.provider === "zillow_research"
          ? "Zillow Research (ZORI)"
          : packets.market.provider === "zillow_rapidapi"
            ? "Zillow listings"
            : packets.market.provider === "rentcast"
              ? "RentCast"
              : "live market data"
      parts.push(
        `I'd price around **${money(packets.market.estimatedRent)}/mo` +
          (packets.market.rentRangeLow != null && packets.market.rentRangeHigh != null
            ? `** (typical range ${money(packets.market.rentRangeLow)}–${money(packets.market.rentRangeHigh)})`
            : "**") +
          (place ? ` based on ${src} for **${place}**.` : ` based on ${src}.`),
      )
    } else if (packets.market?.available) {
      parts.push(
        place
          ? `Here's a live rental-market read for **${place}**.`
          : "Here's a live rental-market read from the comps I could pull.",
      )
    } else {
      parts.push(
        packets.market?.gapNote ??
          "Live rental market comps aren't available yet for this request.",
      )
    }

    if (packets.market?.available) {
      parts.push("## Estimated Rent Position")
      for (const b of packets.market.bullets) {
        if (/^comparable rentals:/i.test(b)) continue
        if (b.startsWith("- ")) continue
        if (/market data provider/i.test(b)) continue
        parts.push(`- ${b}`)
      }

      const material = selectMaterialPropertyBullets([
        ...(packets.property?.bullets ?? []),
        ...(packets.ops?.bullets ?? []),
      ]).slice(0, 4)
      if (material.length) {
        parts.push("## How this applies to your property")
        if (building) {
          parts.push(
            `A few details at **${building}** that can change pricing or timing:`,
          )
        }
        for (const b of material) parts.push(`- ${b}`)
      }

      const compLines = packets.market.bullets.filter((b) => b.startsWith("- "))
      if (compLines.length) {
        parts.push("## Comparable Rentals")
        parts.push("_Interactive comps with View Listing links appear below._")
      }
    } else if (packets.market?.gapNote) {
      parts.push("## What's Missing")
      parts.push(`- ${packets.market.gapNote}`)
    }

    parts.push("## Recommended Next Steps")
    if (packets.market?.available && packets.market.estimatedRent != null) {
      parts.push(
        `- Price renewals and vacant units with the ${money(packets.market.estimatedRent)}/mo market estimate in mind.`,
      )
      parts.push("- Review the comps below for unit mix and amenity gaps.")
    } else {
      parts.push(
        "- Retry with a full street address, or set `RENTCAST_API_KEY` for listing-level comps.",
      )
    }
    parts.push("- Ask for price history if you want sale/valuation over time.")
    return parts.join("\n")
  }

  if (packets.intent === "legal") {
    const placeBits = [
      j.cityLabel,
      j.countyLabel ? `${j.countyLabel} County` : null,
      j.stateCode === "OR" ? "Oregon" : j.stateCode,
    ].filter(Boolean)
    const place = placeBits.join(", ")
    const building = packets.property?.buildingName
    const ruleLead =
      packets.structured?.bullets[0] ??
      ((packets.legalGate?.primaryOfficialCount ?? 0) > 0
        ? packets.legal?.bullets[0]
        : null) ??
      null
    const pendingOrdinance = (packets.legal?.pendingOrdinanceCount ?? 0) > 0
    const sensitiveIds = new Set(
      (packets.legalGate?.sensitiveTopics ?? []).map((t) => t.id),
    )
    const highStakes =
      Boolean(packets.legalGate?.requireCounsel) ||
      sensitiveIds.has("eviction") ||
      sensitiveIds.has("fair_housing") ||
      sensitiveIds.has("disability_accommodation") ||
      sensitiveIds.has("lead_environmental") ||
      sensitiveIds.has("tenant_screening") ||
      sensitiveIds.has("application_denial") ||
      sensitiveIds.has("domestic_violence") ||
      sensitiveIds.has("retaliation") ||
      sensitiveIds.has("illegal_self_help") ||
      Boolean(packets.fairHousing?.refuseDecision) ||
      Boolean(packets.humanDecision?.refuseDecision)

    if (packets.fairHousing?.refuseDecision) {
      parts.push("## I won’t decide approve or deny")
      parts.push(
        "I can explain lawful screening rules and Fair Housing risk, but **you** (with company policy and counsel) make the applicant decision. I won’t recommend approve/deny based on protected traits or proxies.",
      )
      parts.push("")
    }
    if (packets.humanDecision?.refuseDecision) {
      parts.push("## I won’t make this decision")
      parts.push(
        "This is a high-stakes housing situation. I can explain the rules and organize the facts, but a qualified professional must decide the outcome.",
      )
      parts.push("")
    }

    parts.push("## Quick Answer")
    if (packets.legalGate?.requireCounsel && packets.legalGate.counselNote) {
      parts.push(`⚠ **Watch out:** ${packets.legalGate.counselNote}`)
    } else if (pendingOrdinance) {
      parts.push(
        "⚠ **Watch out:** A recent city law may not appear on every government website yet. Ulo checked the newest available information.",
      )
    }
    if (ruleLead) {
      const plain = humanizeRetrievalLine(ruleLead)
      parts.push(
        place
          ? `Here's what matters under the local rules for **${place}**.`
          : "Here's what matters under the rules I could confirm.",
      )
      parts.push(plain)
    } else if (place) {
      parts.push(
        `I don't have a clear rule I can confirm yet for **${place}**. I'd double-check the official text or get a second opinion before you act.`,
      )
    } else {
      parts.push(
        "I need to know which property (or city/state) this is for before I can give solid advice.",
      )
    }

    const ruleBullets =
      packets.structured?.bullets.length
        ? packets.structured.bullets
        : (packets.legalGate?.primaryOfficialCount ?? 0) > 0 && packets.legal?.bullets.length
          ? packets.legal.bullets.slice(0, 3)
          : []
    if (ruleBullets.length > 0) {
      parts.push("## What this means")
      for (const b of ruleBullets) {
        const line = humanizeRetrievalLine(b)
        // Skip repeating the same lead line
        if (ruleLead && humanizeRetrievalLine(ruleLead) === line) continue
        parts.push(`- ${line}`)
      }
      if (parts[parts.length - 1] === "## What this means") {
        parts.pop()
      }
    }

    const mindLines: string[] = []
    if (j.housingProgram === "section_8_hcv") {
      mindLines.push(
        "Some units may use Section 8 Housing Choice Vouchers. Rent changes on those units usually need housing authority approval first.",
      )
    }
    // Soft agency notes only when we didn't already dump them as hard rules, and skip if pending already warned
    const softNotes =
      packets.structured?.bullets.length && packets.legal?.bullets.length
        ? packets.legal.bullets.slice(0, 2)
        : (packets.legalGate?.agencyGuidanceCount ?? 0) > 0
          ? (packets.legal?.bullets ?? []).slice(0, 2)
          : []
    for (const b of softNotes) {
      const line = humanizeRetrievalLine(b)
      if (ruleLead && humanizeRetrievalLine(ruleLead) === line) continue
      mindLines.push(line)
    }
    if (mindLines.length) {
      parts.push("## Things to keep in mind")
      for (const line of mindLines) parts.push(`- ${line}`)
    }

    const material = selectMaterialPropertyBullets([
      ...(packets.property?.bullets ?? []),
      ...(packets.ops?.bullets ?? []),
    ]).slice(0, 4)
    if (material.length) {
      parts.push("## Looking at your property")
      parts.push(
        building
          ? `Looking specifically at **${building}**, a few details change how I'd apply this:`
          : "Looking at your property information, a few details change how I'd apply this:",
      )
      for (const b of material) parts.push(`- ${humanizePropertyBullet(b)}`)
    }

    parts.push(
      ...formatCounselHandoffMarkdown({
        requireCounsel: Boolean(packets.legalGate?.requireCounsel),
        counselNote: packets.legalGate?.counselNote ?? null,
        recommendedExpertId:
          packets.legalGate?.recommendedExpertId ?? "regional_property_manager",
        include: highStakes,
      }),
    )

    parts.push("## Recommended Next Steps")
    parts.push("Before you act, I'd recommend:")
    parts.push("- Review the lease terms for the affected units.")
    if (material.some((b) => /maintenance|habitability|inspection/i.test(b))) {
      parts.push("- Resolve any major maintenance issues that could affect habitability.")
    }
    if (
      j.housingProgram === "section_8_hcv" ||
      material.some((b) => /section 8|hcv|voucher/i.test(b))
    ) {
      parts.push("- Confirm Section 8 approval requirements if they apply.")
    }
    if (!building) {
      parts.push("- Tell me which property this is for if the rules differ across your buildings.")
    }
    if (highStakes) {
      parts.push("- Use thumbs down if you want this flagged for human review.")
    }
    parts.push("")
    parts.push(
      formatLegalAttributionMarkdown({
        jurisdiction: {
          countryCode: j.countryCode,
          stateCode: j.stateCode,
          countyLabel: j.countyLabel,
          cityLabel: j.cityLabel,
        },
        citations: mergeCitations(packets),
        primaryOfficialCount: packets.legalGate?.primaryOfficialCount,
        agencyGuidanceCount: packets.legalGate?.agencyGuidanceCount,
      }),
    )
    return parts.join("\n")
  }

  parts.push("## Quick Answer")
  const materialDefault = selectMaterialPropertyBullets([
    ...(packets.property?.bullets ?? []),
    ...(packets.ops?.bullets ?? []),
  ]).slice(0, 5)
  if (packets.structured?.bullets.length) {
    parts.push(humanizeRetrievalLine(packets.structured.bullets[0]!))
  } else if (materialDefault.length) {
    parts.push(humanizePropertyBullet(materialDefault[0]!))
  } else if (packets.ops?.bullets.length) {
    parts.push(humanizeRetrievalLine(packets.ops.bullets[0]!))
  } else {
    parts.push(
      "I can't fully answer that with what I can see right now. Once the relevant request history is available, I'll give you a clear finding.",
    )
  }

  if (packets.structured?.bullets.length && packets.structured.bullets.length > 1) {
    parts.push("## What this means")
    for (const b of packets.structured.bullets.slice(1, 4)) {
      parts.push(`- ${humanizeRetrievalLine(b)}`)
    }
  }
  if (materialDefault.length > 1) {
    parts.push("## Looking at your property")
    for (const b of materialDefault.slice(packets.structured?.bullets.length ? 0 : 1, 5)) {
      parts.push(`- ${humanizePropertyBullet(b)}`)
    }
  }

  parts.push("## Recommended Next Steps")
  if (materialDefault.some((b) => /critical|escalat|aging|overdue|waiting longer/i.test(b))) {
    parts.push("- Review critical items and anything waiting longer than expected first.")
  } else {
    parts.push("- No action is needed right now unless a new issue appears.")
  }
  if (packets.property?.buildingName) {
    parts.push(
      `- Ask about **${packets.property.buildingName}** specifically if you want a property-level read.`,
    )
  }
  return parts.join("\n")
}

/** Strip leftover retrieval tags / keys from packet lines for user-facing fallback text. */
function humanizeRetrievalLine(raw: string): string {
  let s = raw.trim()
  if (s.startsWith("- ")) s = s.slice(2)
  s = s.replace(/^\(\d+\)\s*/, "")
  s = s.replace(/\s*\[(?:official|agency guidance|guidance|requirement|mirror[^\]]*|adopted[^\]]*|effective[^\]]*)\]/gi, "")
  s = s.replace(/\bhud_fmr_(\d)br\b/gi, (_m, n) => {
    const labels = ["studio", "one-bedroom", "two-bedroom", "three-bedroom"]
    return `HUD Fair Market Rent for a ${labels[Number(n)] ?? `${n}-bedroom`}`
  })
  s = s.replace(/\busd_per_month\b/gi, "per month")
  s = s.replace(/\bportfolio sample\b/gi, "typical rent")
  s = s.replace(/\bSection 8\s*\/\s*Housing Choice Voucher(?:\s*\(HCV\))?/gi, "Section 8 Housing Choice Voucher")
  s = s.replace(/\s{2,}/g, " ").trim()
  return s
}

function humanizePropertyBullet(raw: string): string {
  let s = humanizeRetrievalLine(raw)
  s = s.replace(/^Your company policy:\s*/i, "Your company requires: ")
  s = s.replace(/^Company policy:\s*/i, "Your company requires: ")
  if (/balance due/i.test(s) && !/before/i.test(s)) {
    return `${s} This matters if you're timing a rent increase or notice.`
  }
  if (/lease ends|month-to-month|confirm lease term/i.test(s) && !/because|matters|before/i.test(s)) {
    return `${s} That affects which notice rules apply.`
  }
  if (/section 8|voucher/i.test(s) && !/approval/i.test(s)) {
    return `${s} Confirm housing authority approval before changing rent on those units.`
  }
  return s
}

/** Portfolio inventory (counts, type, avg rent) — omit unless it changes the recommendation. */
function isInventoryPropertyBullet(bullet: string): boolean {
  const b = bullet.trim()
  if (/^property type:/i.test(b)) return true
  if (/typical in-place rent|average rent|avg\.?\s*rent|portfolio sample/i.test(b)) return true
  if (/^active \/ pending residents on file/i.test(b)) return true
  if (/housing programs:\s*no voucher/i.test(b)) return true
  if (/^maintenance history \(recent sample\)/i.test(b)) return true
  if (/^vendor performance/i.test(b)) return true
  if (/\b\d+\s+units?\b/i.test(b) && /occupancy|vacant|occupied/i.test(b)) return true
  if (/^address:|^street address:/i.test(b)) return true
  return false
}

/** Keep only property/ops facts that typically change legal or pricing advice. */
function selectMaterialPropertyBullets(bullets: string[]): string[] {
  return bullets.filter((b) => {
    const t = b.trim()
    if (!t || isInventoryPropertyBullet(t)) return false
    return (
      /^company policy:|^your company policy:/i.test(t) ||
      /section 8|housing choice voucher|hcv|pha rules|housing authority/i.test(t) ||
      /balance due|past due/i.test(t) ||
      /lease ends|month-to-month|expired end date|confirm lease term/i.test(t) ||
      /inspection/i.test(t) ||
      /habitability|open maintenance|still open/i.test(t) ||
      /prior conversation|handoff|decision/i.test(t) ||
      /must |required to|stricter/i.test(t)
    )
  })
}
