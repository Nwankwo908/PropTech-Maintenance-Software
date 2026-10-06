/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  attemptGroundedRetryAfterFiguresRejection,
  formatUnsupportedFiguresClarifyMarkdown,
  isUnsupportedFiguresRejection,
} from "../../quality/groundedRetryAfterFiguresRejection.ts"
import { formatPostAnswerFailClosedMarkdown } from "../../quality/runPostAnswerChecks.ts"
import { checkAnswerFaithfulness } from "../../quality/checkFaithfulness.ts"
import { detectAskUloCapability } from "../../routing/capability.ts"
import { resolveCapabilityRoute } from "../../routing/capabilityRoute.ts"
import { detectQuestionSubject } from "../../routing/detectSubject.ts"
import { resolvePreferPacket } from "../../retrieval/resolvePreferPacket.ts"
import {
  formatCriticalMaintenanceByPropertyMarkdown,
  type RankedProperty,
} from "../../tools/properties/propertyRankingLookup.ts"
import { isCriticalMaintenanceByPropertyQuestion } from "../../tools/maintenance/workOrderPresentation.ts"
import type { AskUloEvidencePacket } from "../../retrieval/buildEvidencePacket.ts"

function stubRanked(partial: Partial<RankedProperty> & Pick<RankedProperty, "building">): RankedProperty {
  return {
    rankScore: 100,
    healthScore: 70,
    healthDelta4w: null,
    openWorkOrders: 3,
    criticalWorkOrders: 2,
    agingWorkOrders: 1,
    oldestOpenDays: 8,
    escalatedWorkflows: 1,
    awaitingDecision: 0,
    repeatHotspots: [],
    vacancyUnits: 0,
    trackedUnits: 10,
    occupancyPct: 90,
    signals: [],
    whyLines: ["2 critical/urgent work orders"],
    recommendedActions: ["Review critical requests first"],
    ...partial,
  }
}

const packetWithOpenWork: AskUloEvidencePacket = {
  internal: [
    {
      id: "wo1",
      channel: "internal",
      source: "maintenance_requests",
      label: "Orange Grove",
      excerpt: "Dryer fire · emergency · 8d open",
      asOf: "2026-10-05",
      stale: false,
      strength: 90,
    },
  ],
  legal: [],
  market: [],
  missing: [],
  meta: {
    asOf: "2026-10-05",
    jurisdiction: { stateCode: "MD", cityLabel: "Baltimore" },
    subject: "property",
    capability: "rank",
    hasEvidence: true,
    staleCount: 0,
    toolExecutions: [],
  },
}

Deno.test("unsupported figures rejection is detected; labels never shown to landlord", () => {
  const reasons = ["non_legal_intent", "unsupported_figures:$4,200,14 days"]
  assertEquals(isUnsupportedFiguresRejection(reasons), true)
  const md = formatPostAnswerFailClosedMarkdown({
    block: "refuse",
    reasons,
    question: "Which properties have critical maintenance and what will they cost?",
  })
  assertEquals(/unsupported_figures/i.test(md), false)
  assertEquals(/non_legal_intent/i.test(md), false)
  assertMatch(md, /cost data recorded/i)
})

Deno.test("figures-unsupported draft retries with grounded property ranking and succeeds", async () => {
  const draft = checkAnswerFaithfulness({
    intent: "property_priority",
    answer:
      "Oakwood needs about $12,500 of emergency work within 14 days. Harbor will cost $8,000 if ignored.",
    citations: [],
    evidenceText: "Oakwood 2 critical open. Harbor 1 urgent open. No dollar amounts on file.",
    hasEvidence: true,
    gateStatus: "ok",
  })
  assertEquals(draft.failClosed, true)
  assertEquals(isUnsupportedFiguresRejection(draft.reasons), true)

  const retry = await attemptGroundedRetryAfterFiguresRejection({
    question: "Which properties have critical maintenance?",
    gatedPropertyRanking: {
      available: true,
      canRank: true,
      ranked: [
        stubRanked({ building: "Oakwood Apartments", criticalWorkOrders: 2, rankScore: 200 }),
        stubRanked({ building: "Harbor Point", criticalWorkOrders: 1, rankScore: 120 }),
      ],
      portfolioOpenWorkOrders: 8,
    },
  })
  assertEquals(Boolean(retry.markdown), true)
  assertEquals(retry.source, "property_ranking")
  assertMatch(retry.markdown ?? "", /Oakwood Apartments/)
  assertMatch(retry.markdown ?? "", /critical or urgent/i)
  assertEquals(/\$12,500|\$8,000|unsupported_figures|non_legal_intent/i.test(retry.markdown ?? ""), false)
})

Deno.test("grounded retry clarify is plain language when no packets", async () => {
  const retry = await attemptGroundedRetryAfterFiguresRejection({
    question: "How much will critical repairs cost across my properties?",
  })
  assertEquals(retry.markdown, null)
  const clarify = formatUnsupportedFiguresClarifyMarkdown(
    "How much will critical repairs cost across my properties?",
  )
  assertMatch(clarify, /cost data recorded/i)
  assertEquals(/unsupported_figures|non_legal_intent/i.test(clarify), false)
})

Deno.test("which properties have critical maintenance routes to rank_properties + urgency search", () => {
  const q = "Which properties have critical maintenance?"
  assertEquals(isCriticalMaintenanceByPropertyQuestion(q), true)
  const subj = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subj)
  assertEquals(cap.capability, "rank")
  assertEquals(cap.hints.sortBy, "priority")
  const route = resolveCapabilityRoute({ subject: subj, capability: cap.capability })
  assertEquals(route.requiredTools.includes("rank_properties"), true)
  assertEquals(route.requiredTools.includes("search_work_orders"), true)
})

Deno.test("prefer packet: critical maintenance returns ranked severity list, not refuse", () => {
  const prefer = resolvePreferPacket({
    question: "Which properties have critical maintenance?",
    intent: "property_priority",
    reasoningMode: "comparison_ranking",
    subject: "property",
    capability: "rank",
    gatedPropertyRanking: {
      available: true,
      canRank: true,
      missingData: [],
      portfolioOpenWorkOrders: 5,
      ranked: [
        stubRanked({ building: "Maple Heights", criticalWorkOrders: 3 }),
        stubRanked({ building: "Cedar Court", criticalWorkOrders: 0, openWorkOrders: 2 }),
      ],
    },
  })
  assertEquals(prefer.prefer, true)
  assertEquals(prefer.kind, "critical_maintenance_by_property")
  assertMatch(prefer.markdown ?? "", /Maple Heights/)
  assertEquals(/Cedar Court/.test(prefer.markdown ?? ""), false)
  assertEquals(/unsupported_figures|non_legal_intent|Rephrase with the property/i.test(prefer.markdown ?? ""), false)
})

Deno.test("formatCriticalMaintenanceByPropertyMarkdown is severity-only", () => {
  const md = formatCriticalMaintenanceByPropertyMarkdown([
    stubRanked({ building: "Orange Grove", criticalWorkOrders: 2 }),
  ])
  assertMatch(md, /Orange Grove/)
  assertMatch(md, /Critical \/ urgent open/)
  assertEquals(/\$\d|within \d+ days|unsupported_figures/i.test(md), false)
})

Deno.test("faithfulness still flags invented figures when evidence lacks them", () => {
  const r = checkAnswerFaithfulness({
    intent: "property_priority",
    answer:
      "Oakwood needs about $12,500 of emergency work within 14 days. Harbor will cost $8,000 if ignored.",
    citations: [],
    evidenceText: packetWithOpenWork.internal[0]!.excerpt + " Oakwood 2 critical. Harbor 1 urgent.",
    hasEvidence: true,
    gateStatus: "ok",
  })
  assertEquals(r.failClosed, true)
  assertEquals(isUnsupportedFiguresRejection(r.reasons), true)
})
