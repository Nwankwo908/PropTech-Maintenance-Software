/**
 * Unit tests for searchWorkOrders post-filters (no DB).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { OperationalWorkOrder } from "../../tools/maintenance/searchOperationalRecords.ts"
import { sortWorkOrders } from "../../tools/maintenance/searchWorkOrders.ts"

/** Mirror of sort/filter behavior in searchWorkOrders for pure unit tests. */
function applySearchWorkOrdersPostFilters(
  rows: OperationalWorkOrder[],
  params: {
    approvalRequired?: boolean
    slaExpired?: boolean
    sortBy?: "created_at" | "days_open" | "priority"
    sortOrder?: "asc" | "desc"
    limit?: number
  },
): OperationalWorkOrder[] {
  let workOrders = [...rows]
  if (params.approvalRequired) {
    workOrders = workOrders.filter((w) => w.approvalStatus === "review_required")
  }
  if (params.slaExpired) {
    workOrders = workOrders.filter((w) => w.slaExpired)
  }
  const sortBy = params.sortBy ?? (params.slaExpired ? "priority" : "created_at")
  const sortOrder = params.sortOrder ?? "desc"
  workOrders = sortWorkOrders(workOrders, sortBy, sortOrder)
  if (params.limit != null) workOrders = workOrders.slice(0, params.limit)
  return workOrders
}

function stubWo(
  partial: Partial<OperationalWorkOrder> & Pick<OperationalWorkOrder, "workOrderId">,
): OperationalWorkOrder {
  return {
    maintenanceRequestId: partial.workOrderId,
    workflowRunId: null,
    propertyName: "Test",
    unitLabel: null,
    category: "hvac",
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

Deno.test("searchWorkOrders post-filter: approvalRequired + days_open sort", () => {
  const rows = [
    stubWo({
      workOrderId: "a",
      daysOpen: 2,
      approvalStatus: "not_required",
      slaExpired: false,
    }),
    stubWo({
      workOrderId: "b",
      daysOpen: 9,
      approvalStatus: "review_required",
      slaExpired: true,
      createdAt: "2026-01-02T00:00:00Z",
    }),
    stubWo({
      workOrderId: "c",
      daysOpen: 4,
      approvalStatus: "review_required",
      slaExpired: false,
    }),
  ]
  const filtered = applySearchWorkOrdersPostFilters(rows, {
    approvalRequired: true,
    sortBy: "days_open",
    sortOrder: "desc",
  })
  assertEquals(filtered.map((w) => w.workOrderId), ["b", "c"])
})

Deno.test("searchWorkOrders post-filter: slaExpired", () => {
  const rows = [
    stubWo({ workOrderId: "a", slaExpired: false }),
    stubWo({ workOrderId: "b", slaExpired: true }),
  ]
  const filtered = applySearchWorkOrdersPostFilters(rows, { slaExpired: true })
  assertEquals(filtered.map((w) => w.workOrderId), ["b"])
})

Deno.test("searchWorkOrders: slaExpired defaults to urgency-first sort", () => {
  const rows = [
    stubWo({
      workOrderId: "routine",
      slaExpired: true,
      daysOpen: 8,
      priority: "medium",
      urgency: "medium",
    }),
    stubWo({
      workOrderId: "fire",
      slaExpired: true,
      daysOpen: 8,
      priority: "emergency",
      urgency: "fire",
    }),
  ]
  const filtered = applySearchWorkOrdersPostFilters(rows, { slaExpired: true })
  assertEquals(filtered.map((w) => w.workOrderId), ["fire", "routine"])
})
