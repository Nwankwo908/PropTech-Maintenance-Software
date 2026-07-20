/**
 * Catch-all work-order fallback — markdown + subject gate.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { OperationalWorkOrder } from "../searchOperationalRecords.ts"
import {
  buildCatchAllWorkOrderPacket,
  formatCatchAllWorkOrdersMarkdown,
  shouldAttemptCatchAllWorkOrderFallback,
} from "./catchAllFallback.ts"

function sampleWo(overrides: Partial<OperationalWorkOrder> = {}): OperationalWorkOrder {
  return {
    workOrderId: "WO-1234",
    maintenanceRequestId: "mr-1",
    workflowRunId: "wr-1",
    propertyName: "Oakwood",
    unitLabel: "2B",
    category: "Plumbing",
    title: "Leak under sink",
    description: "Kitchen sink leak under the cabinet",
    priority: "high",
    estimatedCost: 300,
    estimatedCostSource: "minutes_proxy",
    repairScope: "Repair",
    laborEstimate: "2 hours",
    workflowStage: "awaiting_vendor",
    workflowStatus: "active",
    vendorName: "Flex Plumbing",
    vendorWorkStatus: "assigned",
    slaExpired: false,
    approvalStatus: "not_required",
    dueAt: null,
    expectedCompletion: null,
    createdAt: new Date().toISOString(),
    daysOpen: 4,
    estimatedMinutes: 120,
    ...overrides,
  }
}

Deno.test("formatCatchAllWorkOrdersMarkdown: landlord prose, no retrieval jargon", () => {
  const md = formatCatchAllWorkOrdersMarkdown([sampleWo()])
  assertEquals(md.includes("WO-1234"), true)
  assertEquals(md.includes("Oakwood"), true)
  assertEquals(md.includes("Flex Plumbing"), true)
  assertEquals(/I found \d+/i.test(md), false)
  assertEquals(/matching records/i.test(md), false)
})

Deno.test("shouldAttemptCatchAllWorkOrderFallback: maintenance yes, vendor no", () => {
  assertEquals(
    shouldAttemptCatchAllWorkOrderFallback({
      subject: "maintenance",
      hasSpecialtyPacket: false,
    }),
    true,
  )
  assertEquals(
    shouldAttemptCatchAllWorkOrderFallback({
      subject: "vendor",
      hasSpecialtyPacket: false,
    }),
    false,
  )
  assertEquals(
    shouldAttemptCatchAllWorkOrderFallback({
      subject: "maintenance",
      hasSpecialtyPacket: true,
    }),
    false,
  )
})

Deno.test("buildCatchAllWorkOrderPacket: empty → null", () => {
  const emptyLog = {
    intentHint: null,
    category: null,
    searchFilters: {},
    tablesOrRpcs: [] as string[],
    recordCount: 0,
    matchingWorkOrderIds: [] as string[],
    estimatedCostFound: false,
    estimatedCosts: [] as Array<{
      workOrderId: string
      estimatedCost: number | null
      source: string | null
    }>,
    evidencePayloadBytes: 0,
    fallbackReason: null,
  }
  assertEquals(
    buildCatchAllWorkOrderPacket({
      available: true,
      workOrders: [],
      tablesQueried: [],
      filters: {},
      error: null,
      log: emptyLog,
      toolId: "search_work_orders",
      params: {},
    }),
    null,
  )
  const packet = buildCatchAllWorkOrderPacket({
    available: true,
    workOrders: [sampleWo()],
    tablesQueried: ["workflow_runs"],
    filters: {},
    error: null,
    log: {
      ...emptyLog,
      recordCount: 1,
      matchingWorkOrderIds: ["WO-1234"],
      estimatedCostFound: true,
    },
    toolId: "search_work_orders",
    params: {},
  })
  assertEquals(packet?.found, true)
  assertEquals(packet?.workOrderCount, 1)
  assertEquals(Boolean(packet?.markdown.includes("WO-1234")), true)
})
