/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import {
  detectVendorMetric,
  isVendorBestQuestion,
} from "./questionMetricContext.ts"
import { isVendorRankingQuestion } from "./questionSubjectMatch.ts"
import { vendorIncludedForTrade } from "./vendorBestLookup.ts"
import { aggregateTradeJobs } from "./vendorTradeJobHistory.ts"

Deno.test("Compare my HVAC vendors routes to vendor_best", () => {
  const q = "Compare my HVAC vendors."
  assertEquals(isVendorBestQuestion(q), true)
  assertEquals(isVendorRankingQuestion(q), true)
  assertEquals(detectVendorMetric(q), "overall_quality")
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_best")
})

Deno.test("generalist with HVAC job history is included for HVAC compare", () => {
  assertEquals(
    vendorIncludedForTrade({
      category: null,
      tradeSlug: "hvac",
      tradeLabel: "HVAC tech",
      history: {
        vendorId: "v1",
        completedJobs: 1,
        openJobs: 0,
        sampleLocations: ["Birch Tower · 107"],
      },
    }),
    true,
  )
  assertEquals(
    vendorIncludedForTrade({
      category: null,
      tradeSlug: "hvac",
      tradeLabel: "HVAC tech",
      history: undefined,
    }),
    false,
  )
  assertEquals(
    vendorIncludedForTrade({
      category: "plumbing",
      tradeSlug: "hvac",
      tradeLabel: "HVAC tech",
      history: undefined,
    }),
    false,
  )
})

Deno.test("aggregateTradeJobs counts HVAC tickets and sample locations", () => {
  const map = aggregateTradeJobs(
    [
      {
        assigned_vendor_id: "summit",
        vendor_work_status: "completed",
        unit: "Birch Tower · 107",
        issue_category: "hvac",
      },
      {
        assigned_vendor_id: "summit",
        vendor_work_status: "completed",
        unit: "Maple Heights · 207",
        issue_category: "hvac",
      },
      {
        assigned_vendor_id: "summit",
        vendor_work_status: "pending_accept",
        unit: "Oakwood · 1",
        issue_category: "hvac",
      },
      {
        assigned_vendor_id: "apex",
        vendor_work_status: "completed",
        unit: "Oakwood · 2",
        issue_category: "plumbing",
      },
    ],
    "hvac",
  )
  const summit = map.get("summit")!
  assertEquals(summit.completedJobs, 2)
  assertEquals(summit.openJobs, 1)
  assertStringIncludes(summit.sampleLocations.join(" "), "Birch Tower")
  assertEquals(map.has("apex"), false)
})
