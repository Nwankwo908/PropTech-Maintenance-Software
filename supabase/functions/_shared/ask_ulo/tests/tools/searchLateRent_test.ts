/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatLateRentMarkdown,
  type LateRentRow,
} from "../../tools/rent/searchLateRent.ts"
import { toolFail, toolOk, type ToolResult } from "../../tools/_shared/toolResult.ts"
import { toSearchWorkOrdersToolResult } from "../../tools/maintenance/searchWorkOrders.ts"
import type { SearchWorkOrdersResult } from "../../tools/maintenance/searchWorkOrders.ts"

Deno.test("ToolResult helpers preserve success / evidence / error", () => {
  const ok = toolOk({ count: 2 }, [{ id: "a", source: "users", label: "Ada" }])
  assertEquals(ok.success, true)
  assertEquals(ok.data?.count, 2)
  assertEquals(ok.evidence.length, 1)
  assertEquals(ok.error, undefined)

  const fail: ToolResult<never> = toolFail("db down")
  assertEquals(fail.success, false)
  assertEquals(fail.error, "db down")
  assertEquals(fail.evidence.length, 0)
})

Deno.test("formatLateRentMarkdown empty → clear empty state", () => {
  const md = formatLateRentMarkdown([])
  assertStringIncludes(md, "No residents currently show an outstanding balance")
})

Deno.test("formatLateRentMarkdown lists balances and overdue days", () => {
  const rows: LateRentRow[] = [
    {
      residentId: "r1",
      name: "Jordan Lee",
      unitLabel: "2B",
      propertyName: "Maple Heights",
      balanceDue: 1250,
      daysOverdue: 14,
      workflowRunId: "wr1",
      workflowStatus: "active",
    },
  ]
  const md = formatLateRentMarkdown(rows)
  assertStringIncludes(md, "Jordan Lee")
  assertStringIncludes(md, "Maple Heights")
  assertStringIncludes(md, "14 day")
  assertStringIncludes(md, "$1,250")
})

Deno.test("toSearchWorkOrdersToolResult wraps legacy result", () => {
  const legacy = {
    toolId: "search_work_orders" as const,
    available: true,
    workOrders: [
      {
        workOrderId: "wo-1",
        maintenanceRequestId: "wo-1",
        workflowRunId: null,
        propertyName: "Oak Street",
        unitLabel: "1A",
        category: "plumbing",
        title: "Leak under sink",
        description: "",
        priority: "high",
        estimatedCost: null,
        estimatedCostSource: null,
        repairScope: "",
        laborEstimate: "",
        workflowStage: null,
        workflowStatus: "active",
        vendorName: null,
        vendorWorkStatus: null,
        slaExpired: false,
        approvalStatus: "not_required" as const,
        dueAt: null,
        expectedCompletion: null,
        createdAt: new Date().toISOString(),
        daysOpen: 3,
        estimatedMinutes: null,
      },
    ],
    tablesQueried: [],
    filters: {},
    error: null,
    log: {
      intentHint: null,
      category: "plumbing",
      searchFilters: {},
      tablesOrRpcs: [],
      recordCount: 1,
      matchingWorkOrderIds: ["wo-1"],
      estimatedCostFound: false,
      estimatedCosts: [],
      evidencePayloadBytes: 0,
      fallbackReason: null,
    },
    params: { recordCount: 1 },
  } satisfies SearchWorkOrdersResult

  const wrapped = toSearchWorkOrdersToolResult(legacy)
  assertEquals(wrapped.success, true)
  assertEquals(wrapped.data?.workOrders.length, 1)
  assertEquals(wrapped.evidence[0]?.id, "wo-1")
  assertStringIncludes(wrapped.evidence[0]?.excerpt ?? "", "plumbing")
})
