/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloCapability } from "../../routing/capability.ts"
import { resolveCapabilityRoute } from "../../routing/capabilityRoute.ts"
import { classifyAskUloIntent } from "../../routing/detectIntent.ts"
import { detectQuestionSubject } from "../../routing/detectSubject.ts"
import { resolvePreferPacket } from "../../retrieval/resolvePreferPacket.ts"
import { buildToolMissIncompleteSignal } from "../../guards/incompleteEvidence.ts"
import { formatCatchAllWorkOrdersMarkdown } from "../../retrieval/catchAllFallback.ts"
import { isEntityInvestigationQuestion } from "../../tools/maintenance/entityInvestigation.ts"
import { isPortfolioWorkPrioritizationQuestion } from "../../tools/maintenance/workOrderPresentation.ts"
import type { OperationalWorkOrder } from "../../tools/maintenance/searchOperationalRecords.ts"

const FOCUS_PHRASES = [
  "What should I focus on today?",
  "What needs my attention?",
  "What's most urgent?",
  "Where should I start?",
]

Deno.test("open-ended focus phrases route to urgency-sorted work_order search", () => {
  for (const q of FOCUS_PHRASES) {
    assertEquals(isPortfolioWorkPrioritizationQuestion(q), true)
    assertEquals(detectQuestionSubject(q), "work_order")
    assertEquals(classifyAskUloIntent(q).intent, "maintenance")
    const cap = detectAskUloCapability(q)
    assertEquals(cap.capability, "search")
    assertEquals(cap.hints.sortBy, "priority")
    assertEquals(cap.hints.order, "desc")
    const route = resolveCapabilityRoute({
      subject: detectQuestionSubject(q),
      capability: cap.capability,
    })
    assertEquals(route.requiredTools.includes("search_work_orders"), true)
    assertEquals(route.requiredTools.includes("rank_properties"), false)
  }
})

Deno.test("prefer packet: focus-today uses ranked catchall, not incomplete refuse", () => {
  const incomplete = buildToolMissIncompleteSignal({
    noToolMatched: true,
    catchallNone: true,
    subject: "work_order",
    openWorkOrders: 18,
    portfolioWorkPrioritization: true,
  })
  assertEquals(incomplete, null)

  const prefer = resolvePreferPacket({
    question: "What should I focus on today?",
    intent: "maintenance",
    reasoningMode: "recommendation",
    subject: "work_order",
    capability: "search",
    gatedPropertyRanking: {
      available: true,
      canRank: false,
      missingData: ["property-level maintenance detail"],
      portfolioOpenWorkOrders: 18,
    },
    catchAllWorkOrders: {
      found: true,
      markdown:
        "Here's what I'd focus on first across your **18** open requests — urgency first, then wait time, then anything waiting on your decision.\n\n### WO-FIRE — Orange Grove, Unit 1\n- **Urgency:** Fire\n",
    },
  })
  assertEquals(prefer.prefer, true)
  assertEquals(prefer.kind, "catchall_search_work_orders")
  assertMatch(prefer.markdown ?? "", /focus on first/i)
  assertEquals(/Rephrase with the property/i.test(prefer.markdown ?? ""), false)
})

Deno.test("prioritization catchall markdown uses urgency-first framing", () => {
  const wo: OperationalWorkOrder = {
    workOrderId: "WO-FIRE",
    maintenanceRequestId: "WO-FIRE",
    workflowRunId: null,
    propertyName: "Orange Grove",
    unitLabel: "1",
    category: "electrical",
    title: "Dryer that caught fire",
    description: "Dryer that caught fire",
    priority: "emergency",
    urgency: "fire",
    estimatedCost: null,
    estimatedCostSource: null,
    repairScope: "Standard",
    laborEstimate: "",
    workflowStage: null,
    workflowStatus: "escalated",
    vendorName: null,
    vendorWorkStatus: "unassigned",
    slaExpired: true,
    approvalStatus: "not_required",
    dueAt: null,
    expectedCompletion: null,
    createdAt: "2026-01-01T00:00:00Z",
    daysOpen: 8,
    estimatedMinutes: null,
  }
  const md = formatCatchAllWorkOrdersMarkdown([wo], { prioritization: true })
  assertMatch(md, /focus on first/i)
  assertMatch(md, /Urgency/i)
  assertEquals(/Rephrase with the property/i.test(md), false)
})

Deno.test("nonexistent entity investigation still asks for clarification path", () => {
  assertEquals(
    isEntityInvestigationQuestion("What's the status of work order WO-ZZZZ9999?"),
    true,
  )
  assertEquals(
    isPortfolioWorkPrioritizationQuestion("What's the status of work order WO-ZZZZ9999?"),
    false,
  )
  assertEquals(
    classifyAskUloIntent("What's the status of work order WO-ZZZZ9999?").intent,
    "entity_investigation",
  )
  // Without open-work prioritization flag, tool-miss refuse still asks for an anchor.
  const refuse = buildToolMissIncompleteSignal({
    noToolMatched: true,
    catchallNone: true,
    subject: "work_order",
    openWorkOrders: 0,
    portfolioWorkPrioritization: false,
  })
  assertEquals(refuse?.status, "incomplete")
  assertMatch(refuse?.markdown ?? "", /clearer work-order or unit anchor/i)
})
