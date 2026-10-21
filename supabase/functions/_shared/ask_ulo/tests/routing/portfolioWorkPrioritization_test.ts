/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloCapability } from "../../routing/capability.ts"
import { resolveCapabilityRoute } from "../../routing/capabilityRoute.ts"
import { classifyAskUloIntent } from "../../routing/detectIntent.ts"
import { detectQuestionSubject } from "../../routing/detectSubject.ts"
import { resolvePreferPacket } from "../../retrieval/resolvePreferPacket.ts"
import { buildToolMissIncompleteSignal } from "../../guards/incompleteEvidence.ts"
import { formatCatchAllWorkOrdersMarkdown } from "../../retrieval/catchAllFallback.ts"
 // buildToolMissIncompleteSignal still used by entity-investigation refuse path below
import { isEntityInvestigationQuestion } from "../../tools/maintenance/entityInvestigation.ts"
import { isPortfolioWorkPrioritizationQuestion } from "../../tools/maintenance/workOrderPresentation.ts"
import type { OperationalWorkOrder } from "../../tools/maintenance/searchOperationalRecords.ts"

const FOCUS_PHRASES = [
  "What should I focus on today?",
  "What needs my attention?",
  "What's most urgent?",
  "Where should I start?",
]

Deno.test("open-ended daily focus phrases route to cross-system daily priorities briefing", () => {
  for (const q of FOCUS_PHRASES) {
    assertEquals(isPortfolioWorkPrioritizationQuestion(q), false)
    assertEquals(detectQuestionSubject(q), "portfolio")
    assertEquals(classifyAskUloIntent(q).intent, "executive_briefing")
    const cap = detectAskUloCapability(q)
    assertEquals(cap.capability, "summarize")
    const route = resolveCapabilityRoute({
      subject: detectQuestionSubject(q),
      capability: cap.capability,
    })
    assertEquals(route.requiredTools.includes("get_daily_priorities"), true)
    assertEquals(route.requiredTools.includes("rank_properties"), false)
  }
})

Deno.test("explicit work-order urgency ranking still uses WO search path", () => {
  const q = "Which work orders are most urgent?"
  assertEquals(isPortfolioWorkPrioritizationQuestion(q), true)
  assertEquals(detectQuestionSubject(q), "work_order")
})

Deno.test("prefer packet: focus-today uses daily priorities packet, not WO-only catchall", () => {
  const prefer = resolvePreferPacket({
    question: "What should I focus on today?",
    intent: "executive_briefing",
    reasoningMode: "executive_briefing",
    subject: "portfolio",
    capability: "summarize",
    dailyPriorities: {
      markdown:
        "Today's priorities:\n1. Flooding, 45 Oak Ave #3. Vendor needed. Reply 1 to assign.\n2. Inspection repairs due Fri, 123 Main St.",
      items: [{ position: 1 }, { position: 2 }],
    },
  })
  assertEquals(prefer.prefer, true)
  assertEquals(prefer.kind, "get_daily_priorities")
  assertMatch(prefer.markdown ?? "", /Today's priorities/i)
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
