/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatLaborEstimate,
  formatWorkOrderId,
  parseBuildingAndUnit,
  resolveOperationalEstimatedCost,
} from "./searchOperationalRecords.ts"
import {
  buildOperationalFindingMarkdown,
} from "./deepOperationalInvestigationLookup.ts"
import {
  classifyDeepOperationalInvestigation,
  evaluateDeepOperationalInvestigationQc,
  expandCategoryTerms,
  textMatchesOpsTerms,
} from "./deepOperationalInvestigation.ts"
import type { OperationalWorkOrder } from "./searchOperationalRecords.ts"

function sampleWo(overrides: Partial<OperationalWorkOrder> = {}): OperationalWorkOrder {
  return {
    workOrderId: "WO-783E",
    maintenanceRequestId: "783e7a5f-134c-4c50-8273-2c6f604500aa",
    workflowRunId: "ee7041d0-52ef-44d9-82bf-f920229590af",
    propertyName: "Maple Heights",
    unitLabel: "207",
    category: "hvac",
    title: "AC compressor failed during heat advisory",
    description:
      "AC compressor failed during heat advisory. SLA expired with no HVAC vendor left on roster.",
    priority: "high",
    estimatedCost: 300,
    estimatedCostSource: "minutes_proxy",
    repairScope: "Standard Diagnostic + Repair",
    laborEstimate: "1–2 hours",
    workflowStage: "escalated_review",
    workflowStatus: "escalated",
    vendorName: null,
    vendorWorkStatus: "unassigned",
    slaExpired: true,
    approvalStatus: "review_required",
    dueAt: new Date(Date.now() - 8 * 3600_000).toISOString(),
    expectedCompletion: new Date(Date.now() - 8 * 3600_000).toISOString(),
    createdAt: new Date(Date.now() - 28 * 3600_000).toISOString(),
    daysOpen: 1,
    estimatedMinutes: null,
    ...overrides,
  }
}

Deno.test("WO short id matches workflow detail formatter", () => {
  assertEquals(
    formatWorkOrderId("783e7a5f-134c-4c50-8273-2c6f604500aa"),
    "WO-783E",
  )
})

Deno.test("estimated cost from minutes proxy defaults to $300 (UI parity)", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { estimated_minutes: null },
    invoice: null,
    metadata: {},
  })
  assertEquals(cost.amount, 300)
  assertEquals(cost.source, "minutes_proxy")
})

Deno.test("estimated cost from workflow metadata", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { estimated_minutes: 120 },
    invoice: null,
    metadata: { estimated_cost: 875 },
  })
  assertEquals(cost.amount, 875)
  assertEquals(cost.source, "workflow_metadata")
})

Deno.test("estimated cost from maintenance request recognized spend", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { recognized_spend_amount: 450, estimated_minutes: 60 },
    invoice: null,
    metadata: {},
  })
  assertEquals(cost.amount, 450)
  assertEquals(cost.source, "recognized_spend")
})

Deno.test("estimated cost from invoice beats metadata", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { recognized_spend_amount: 100 },
    invoice: { total_cost: 1200 },
    metadata: { estimated_cost: 300 },
  })
  assertEquals(cost.amount, 1200)
  assertEquals(cost.source, "invoice")
})

Deno.test("labor estimate mirrors detail panel minutes mapping", () => {
  assertEquals(formatLaborEstimate(null), "1–2 hours")
  assertEquals(formatLaborEstimate(60), "1 hour")
  assertEquals(formatLaborEstimate(120), "2 hours")
})

Deno.test("parse Maple Heights · 207 unit field", () => {
  const parsed = parseBuildingAndUnit("Maple Heights · 207", {})
  assertEquals(parsed.propertyName, "Maple Heights")
  assertEquals(parsed.unitLabel, "207")
})

Deno.test("1) HVAC work order with estimated cost → answer includes $300", () => {
  const plan = classifyDeepOperationalInvestigation(
    "Estimate the repair cost for the HVAC issues.",
  )
  const md = buildOperationalFindingMarkdown([sampleWo()], plan)
  assertStringIncludes(md, "WO-783E")
  assertStringIncludes(md, "Maple Heights")
  assertStringIncludes(md, "207")
  assertStringIncludes(md, "$300")
  assertStringIncludes(md, "compressor")
})

Deno.test("2) HVAC work order without estimate → record found, gap explained", () => {
  const plan = classifyDeepOperationalInvestigation(
    "Estimate the repair cost for the HVAC issues.",
  )
  const md = buildOperationalFindingMarkdown(
    [sampleWo({ estimatedCost: null, estimatedCostSource: null })],
    plan,
  )
  assertStringIncludes(md, "WO-783E")
  assertStringIncludes(md, "still needs a vendor estimate")
})

Deno.test("3) HVAC synonym AC compressor matches search terms", () => {
  assertEquals(
    textMatchesOpsTerms(
      "AC compressor failed during heat advisory",
      expandCategoryTerms("hvac"),
    ),
    true,
  )
})

Deno.test("4) Multiple HVAC work orders listed as related", () => {
  const plan = classifyDeepOperationalInvestigation(
    "Estimate the repair cost for the HVAC issues.",
  )
  const md = buildOperationalFindingMarkdown(
    [
      sampleWo(),
      sampleWo({
        workOrderId: "WO-58C9",
        unitLabel: "312",
        title: "Preventive HVAC filter",
        description: "Preventive maintenance: HVAC filter replacement",
        estimatedCost: 300,
      }),
    ],
    plan,
  )
  assertStringIncludes(md, "Related work to watch")
  assertStringIncludes(md, "WO-58C9")
  assertEquals(/\bin scope\b/i.test(md), false)
})

Deno.test("5) Property-specific finding uses property name", () => {
  const plan = classifyDeepOperationalInvestigation(
    "Estimate HVAC repair cost at Maple Heights",
  )
  const md = buildOperationalFindingMarkdown([sampleWo()], plan)
  assertStringIncludes(md, "Maple Heights")
})

Deno.test("6) Unit-specific finding uses unit label", () => {
  const plan = classifyDeepOperationalInvestigation(
    "What's the HVAC repair cost for unit 207?",
  )
  const md = buildOperationalFindingMarkdown([sampleWo()], plan)
  assertStringIncludes(md, "Unit 207")
})

Deno.test("7) No matching HVAC records — no false ticket claim", () => {
  const plan = classifyDeepOperationalInvestigation(
    "Estimate the repair cost for the HVAC issues.",
  )
  const md = buildOperationalFindingMarkdown([], plan)
  assertStringIncludes(md, "don't yet see")
  assertEquals(/\bin scope\b/i.test(md), false)
  assertEquals(/\bI found\b/i.test(md), false)
})

Deno.test("8) QC fails when answer ignores retrieved estimate", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  const qc = evaluateDeepOperationalInvestigationQc({
    question: q,
    answer: "I found an HVAC ticket at Maple Heights Unit 207 (WO-783E) but cannot price it.",
    foundMatchingRecords: true,
    workOrders: [
      {
        workOrderId: "WO-783E",
        propertyName: "Maple Heights",
        unitLabel: "207",
        estimatedCost: 300,
      },
    ],
  })
  assertEquals(qc.status, "fail")
})

Deno.test("9) Estimated cost from workflow metadata classified correctly", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: {},
    invoice: null,
    metadata: { estimated_cost: "300" },
  })
  assertEquals(cost.source, "workflow_metadata")
  assertEquals(cost.amount, 300)
})

Deno.test("10) Estimated cost on maintenance request (recognized spend)", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { recognized_spend_amount: "300" },
    invoice: null,
    metadata: {},
  })
  assertEquals(cost.source, "recognized_spend")
  assertEquals(cost.amount, 300)
})

Deno.test("QC passes finding-backed HVAC estimate answer", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  const md = buildOperationalFindingMarkdown([sampleWo()], classifyDeepOperationalInvestigation(q))
  const qc = evaluateDeepOperationalInvestigationQc({
    question: q,
    answer: md,
    foundMatchingRecords: true,
    workOrders: [
      {
        workOrderId: "WO-783E",
        propertyName: "Maple Heights",
        unitLabel: "207",
        estimatedCost: 300,
      },
    ],
  })
  assertEquals(qc.status, "pass", qc.summary)
})

Deno.test("high-level portfolio dodge still rejected when records exist", () => {
  const qc = evaluateDeepOperationalInvestigationQc({
    question: "Estimate the repair cost for the HVAC issues.",
    answer:
      "I can only see high-level activity across your portfolio and cannot find request-level information.",
    foundMatchingRecords: true,
    workOrders: [{ workOrderId: "WO-783E", estimatedCost: 300 }],
  })
  assertEquals(qc.status, "fail")
})
