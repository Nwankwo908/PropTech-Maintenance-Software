/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatPendingLandlordDecisionReason,
  isCriticalMaintenanceByPropertyQuestion,
  isOverdueWorkOrdersQuestion,
  isPortfolioWorkPrioritizationQuestion,
  rankWorkOrderUrgency,
  summarizeWorkOrderIssue,
} from "../../tools/maintenance/workOrderPresentation.ts"
import { sortWorkOrders } from "../../tools/maintenance/searchWorkOrders.ts"
import type { OperationalWorkOrder } from "../../tools/maintenance/searchOperationalRecords.ts"
import { formatCatchAllWorkOrdersMarkdown } from "../../retrieval/catchAllFallback.ts"

const RAMBLING =
  "Hi and thank you I was trying to see if an exterminator can come out to spray the property\nTenant update: Repeatedly this isn't the first time someone came out before.\nTenant update: There is tunneling near the foundation by the back porch\nTiming note: ahead of Thursday inspection."

function stubWo(
  partial: Partial<OperationalWorkOrder> & Pick<OperationalWorkOrder, "workOrderId">,
): OperationalWorkOrder {
  return {
    maintenanceRequestId: partial.workOrderId,
    workflowRunId: null,
    propertyName: "Test",
    unitLabel: null,
    category: "general",
    title: "Test",
    description: "",
    priority: null,
    urgency: null,
    estimatedCost: null,
    estimatedCostSource: null,
    repairScope: "Standard",
    laborEstimate: "",
    workflowStage: null,
    workflowStatus: null,
    vendorName: null,
    vendorWorkStatus: null,
    slaExpired: false,
    approvalStatus: "not_required",
    dueAt: null,
    expectedCompletion: null,
    createdAt: "2026-01-01T00:00:00Z",
    daysOpen: 1,
    estimatedMinutes: null,
    ...partial,
  }
}

Deno.test("summarizeWorkOrderIssue strips Tenant update / Timing note scaffolding", () => {
  const label = summarizeWorkOrderIssue(RAMBLING, "pest_control")
  assertEquals(/Tenant update:/i.test(label), false)
  assertEquals(/Timing note:/i.test(label), false)
  assertEquals(/Hi and thank you/i.test(label), false)
  assertMatch(label, /pest|exterminator|tunnel/i)
})

Deno.test("rankWorkOrderUrgency: fire/habitability beats routine with same age", () => {
  assertEquals(rankWorkOrderUrgency("emergency", "fire") < rankWorkOrderUrgency("medium", null), true)
  assertEquals(rankWorkOrderUrgency("urgent", null) < rankWorkOrderUrgency("low", null), true)
  assertEquals(rankWorkOrderUrgency("habitability", null), 0)
})

Deno.test("sortWorkOrders by priority: urgent fire before routine with longer wait", () => {
  const rows = [
    stubWo({
      workOrderId: "routine",
      daysOpen: 8,
      priority: "medium",
      urgency: "medium",
      title: "Dryer not heating",
      slaExpired: true,
    }),
    stubWo({
      workOrderId: "fire",
      daysOpen: 8,
      priority: "emergency",
      urgency: "fire",
      title: "Dryer that caught fire",
      slaExpired: true,
    }),
  ]
  const sorted = sortWorkOrders(rows, "priority", "desc")
  assertEquals(sorted[0]?.workOrderId, "fire")
  assertEquals(sorted[1]?.workOrderId, "routine")
})

Deno.test("formatPendingLandlordDecisionReason distinguishes estimate vs vendor choice", () => {
  assertEquals(
    formatPendingLandlordDecisionReason({ pendingEstimateApproval: true }).reason,
    "Cost estimate waiting for your approval",
  )
  assertEquals(
    formatPendingLandlordDecisionReason({ awaitingLandlordChoice: true }).reason,
    "Vendor choice waiting for your reply",
  )
})

Deno.test("isOverdueWorkOrdersQuestion matches suggested Ask Ulo prompt", () => {
  assertEquals(isOverdueWorkOrdersQuestion("Which work orders are overdue?"), true)
  assertEquals(isOverdueWorkOrdersQuestion("What needs attention today?"), false)
})

Deno.test("isPortfolioWorkPrioritizationQuestion covers open-ended focus phrasing", () => {
  assertEquals(isPortfolioWorkPrioritizationQuestion("What should I focus on today?"), true)
  assertEquals(isPortfolioWorkPrioritizationQuestion("What needs my attention?"), true)
  assertEquals(isPortfolioWorkPrioritizationQuestion("What's most urgent?"), true)
  assertEquals(isPortfolioWorkPrioritizationQuestion("Where should I start?"), true)
  assertEquals(
    isPortfolioWorkPrioritizationQuestion("Which property needs my attention first?"),
    false,
  )
  assertEquals(
    isPortfolioWorkPrioritizationQuestion("What should I focus on this month?"),
    false,
  )
})

Deno.test("isCriticalMaintenanceByPropertyQuestion matches severity-by-property asks", () => {
  assertEquals(
    isCriticalMaintenanceByPropertyQuestion("Which properties have critical maintenance?"),
    true,
  )
  assertEquals(
    isCriticalMaintenanceByPropertyQuestion("What should I focus on today?"),
    false,
  )
})

Deno.test("catch-all overdue markdown never shows Tenant update scaffolding", () => {
  const md = formatCatchAllWorkOrdersMarkdown([
    stubWo({
      workOrderId: "WO-FIRE",
      title: summarizeWorkOrderIssue(RAMBLING, "pest_control"),
      description: summarizeWorkOrderIssue(RAMBLING, "pest_control"),
      priority: "emergency",
      urgency: "fire",
      daysOpen: 8,
      slaExpired: true,
      propertyName: "Orange Grove",
    }),
  ])
  assertEquals(/Tenant update:/i.test(md), false)
  assertEquals(/Timing note:/i.test(md), false)
  assertEquals(md.includes("**Urgency:**"), true)
  assertMatch(md, /Fire|Emergency|fire/i)
})
