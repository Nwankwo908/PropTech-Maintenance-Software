import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  resolvePreferPacket,
  preferPacketBagFromEvidence,
  handlePreferredEvidence,
  type PreferPacketBag,
} from "../../retrieval/resolvePreferPacket.ts"

function baseBag(overrides: Partial<PreferPacketBag> = {}): PreferPacketBag {
  return {
    question: "Who is late on rent?",
    intent: "ops",
    reasoningMode: "lookup",
    subject: "resident",
    capability: "search",
    ...overrides,
  }
}

Deno.test("resolvePreferPacket short-circuits on residents packet", () => {
  const result = resolvePreferPacket(
    baseBag({
      residents: { available: true, markdown: "## Late rent\n- Ada" },
    }),
  )
  assertEquals(result.prefer, true)
  assertEquals(result.shortCircuit, true)
  assertEquals(result.kind, "search_residents")
  assertEquals(result.tags[0], "prefer_packet:search_residents")
  assertEquals(result.markdown?.includes("Ada"), true)
})

Deno.test("resolvePreferPacket prefers incomplete ranking over specialty when ranking-primary", () => {
  const result = resolvePreferPacket(
    baseBag({
      question: "Which property needs attention first?",
      intent: "property_priority",
      reasoningMode: "recommendation",
      gatedPropertyRanking: {
        available: true,
        canRank: false,
        missingData: ["property assignments on open work orders"],
        portfolioOpenWorkOrders: 12,
      },
      residents: { available: true, markdown: "should not win" },
    }),
  )
  assertEquals(result.prefer, true)
  assertEquals(result.kind?.startsWith("incomplete_"), true)
  assertEquals(result.markdown?.includes("should not win"), false)
})

Deno.test("resolvePreferPacket prefers vendor inactive over briefing-style packets", () => {
  const result = resolvePreferPacket(
    baseBag({
      question: "Which vendors have not accepted jobs?",
      playbookId: "vendor_inactive",
      subject: "vendor",
      vendorInactive: { available: true, markdown: "## Inactive\n- Ace Plumbing" },
      propertyInsights: { found: true, markdown: "## Insights" },
    }),
  )
  assertEquals(result.kind, "vendor_inactive")
})

Deno.test("resolvePreferPacket prefers catch-all work orders", () => {
  const result = resolvePreferPacket(
    baseBag({
      question: "Any open HVAC tickets?",
      subject: "work_order",
      catchAllWorkOrders: {
        found: true,
        markdown: "## Work orders\n- WO-1 HVAC",
      },
    }),
  )
  assertEquals(result.kind, "catchall_search_work_orders")
})

Deno.test("resolvePreferPacket does not short-circuit without packets", () => {
  const result = resolvePreferPacket(
    baseBag({
      question: "How is the portfolio doing?",
      intent: "ops",
      specialtyPacketAlready: true,
      noToolMatched: false,
      capability: "summarize",
      subject: "property",
      reasoningMode: "diagnosis",
    }),
  )
  assertEquals(result.prefer, false)
  assertEquals(result.markdown, null)
})

Deno.test("handlePreferredEvidence still works as stage wrapper", () => {
  const result = handlePreferredEvidence({
    context: { question: "Who is late on rent?" } as any,
    route: {
      intentResult: { intent: "ops", label: "Ops", confidence: "high" },
      capability: { capability: "search", confidence: "high", hints: {} },
      evidencePlan: { subject: "resident", blockPropertyDashboard: true },
      reasoningMode: { mode: "lookup" },
    } as any,
    evidence: {
      toolsUsed: [],
      plan: {},
      executionPlan: {},
      residentsList: { available: true, markdown: "## Late rent\n- Ada" },
      capabilityResult: { capability: "search", hints: { residentFilter: "late_rent" } },
      evidencePlan: { subject: "resident" },
      reasoningEarly: { mode: "lookup" },
    } as any,
  })
  assertEquals(result.prefer, true)
  assertEquals(result.kind, "search_residents")
})

Deno.test("preferPacketBagFromEvidence maps residentsList", () => {
  const bag = preferPacketBagFromEvidence({
    question: "late rent?",
    route: {
      intentResult: { intent: "ops" },
      capability: { capability: "search", hints: {} },
      evidencePlan: { subject: "resident" },
      reasoningMode: { mode: "lookup" },
    } as any,
    evidence: {
      residentsList: { available: true, markdown: "x" },
    } as any,
  })
  assertEquals(bag.residents?.markdown, "x")
})
