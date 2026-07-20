/**
 * Bounded tool select — allowlist, filter, needs patch.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { resolveCapabilityRoute } from "../capabilityRoute.ts"
import {
  buildOpenAiToolDefs,
  filterPlannedTools,
} from "./openaiToolSelect.ts"
import {
  applyPlannedToolsToNeeds,
  buildToolSelectAllowlist,
  planToolsFromCapabilityRoute,
} from "./toolSelectNeeds.ts"

Deno.test("buildToolSelectAllowlist: live tools only, vendor lock drops insights", () => {
  const route = resolveCapabilityRoute({
    subject: "vendor",
    capability: "rank",
  })
  const allow = buildToolSelectAllowlist(route, {
    blockPropertyDashboard: true,
    vendorLock: true,
  })
  assertEquals(allow.includes("rank_vendors"), true)
  assertEquals(allow.includes("get_property_insights"), false)
  assertEquals(allow.every((id) => id !== "rank_properties"), true)
})

Deno.test("buildOpenAiToolDefs: only allowlisted schemas", () => {
  const defs = buildOpenAiToolDefs(["rank_vendors", "search_work_orders", "rank_properties"])
  assertEquals(defs.map((d) => d.function.name).sort(), [
    "rank_vendors",
    "search_work_orders",
  ].sort())
})

Deno.test("filterPlannedTools: drops off-allowlist and duplicates", () => {
  const filtered = filterPlannedTools(
    [
      { name: "rank_vendors", arguments: { metric: "inactive" } },
      { name: "rank_properties", arguments: {} },
      { name: "rank_vendors", arguments: { metric: "workload" } },
      { name: "search_work_orders", arguments: {} },
    ],
    new Set(["rank_vendors", "search_work_orders"]),
  )
  assertEquals(filtered.length, 2)
  assertEquals(filtered[0].name, "rank_vendors")
  assertEquals(filtered[0].arguments.metric, "inactive")
  assertEquals(filtered[1].name, "search_work_orders")
})

Deno.test("planToolsFromCapabilityRoute: vendor rank → rank_vendors", () => {
  const route = resolveCapabilityRoute({ subject: "vendor", capability: "rank" })
  const planned = planToolsFromCapabilityRoute({
    route,
    hints: { metric: "response_time" },
    locks: { blockPropertyDashboard: true, vendorLock: true },
  })
  assertEquals(planned.some((p) => p.name === "rank_vendors"), true)
  const rank = planned.find((p) => p.name === "rank_vendors")
  assertEquals(rank?.arguments.metric, "response_time")
})

Deno.test("applyPlannedToolsToNeeds: inactive metric → vendor inactive", () => {
  const patch = applyPlannedToolsToNeeds(
    [{ name: "rank_vendors", arguments: { metric: "inactive" } }],
    { blockPropertyDashboard: true, vendorLock: true },
  )
  assertEquals(patch.needsVendorInactive, true)
  assertEquals(patch.needsVendorBest, false)
  assertEquals(patch.needsPropertyInsights, false)
})

Deno.test("applyPlannedToolsToNeeds: awaiting decisions + residents", () => {
  const patch = applyPlannedToolsToNeeds(
    [
      { name: "get_awaiting_decisions", arguments: {} },
      { name: "search_residents", arguments: { filter: "late_rent" } },
    ],
    { blockPropertyDashboard: true, vendorLock: false },
  )
  assertEquals(patch.needsApproveRepairs, true)
  assertEquals(patch.needsListResidents, true)
})
