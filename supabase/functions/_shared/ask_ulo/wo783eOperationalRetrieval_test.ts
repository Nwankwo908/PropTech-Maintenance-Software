/// <reference lib="deno.ns" />
/**
 * Building-filter regression + WO-783E operational integration test.
 *
 * Root cause fixed: extractBuildingFilter("…for the HVAC issues") returned "HVAC"
 * which filtered Maple Heights out of Ask Ulo retrieval.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  extractBuildingFilter,
  looksLikeOpsCategoryToken,
  sanitizeBuildingFilter,
} from "./buildingFilter.ts"
import { classifyDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import { deepOperationalInvestigationLookup } from "./deepOperationalInvestigationLookup.ts"
import {
  formatWorkOrderId,
  getOperationalWorkOrders,
  resolveOperationalEstimatedCost,
} from "./searchOperationalRecords.ts"

const DEMO_LANDLORD_ID = "de300000-0000-4000-8000-000000000001"
const WO_783E_TICKET_ID = "783e7a5f-134c-4c50-8273-2c6f604500aa"
const REPAIR_COST_Q = "Estimate the repair cost for the HVAC issues."

Deno.test("extractBuildingFilter must not treat HVAC as a property", () => {
  assertEquals(extractBuildingFilter(REPAIR_COST_Q), null)
  assertEquals(extractBuildingFilter("What's wrong with the Plumbing?"), null)
  assertEquals(extractBuildingFilter("Cost for the AC issues"), null)
  assertEquals(looksLikeOpsCategoryToken("HVAC"), true)
  assertEquals(sanitizeBuildingFilter("HVAC"), null)
})

Deno.test("extractBuildingFilter still accepts real properties", () => {
  assertEquals(extractBuildingFilter("What's open at Maple Heights?"), "Maple Heights")
  assertEquals(extractBuildingFilter("Tell me about Oakwood Apartments"), "Oakwood Apartments")
})

Deno.test("minutes-proxy cost for WO-783E ticket is $300", () => {
  const cost = resolveOperationalEstimatedCost({
    ticket: { estimated_minutes: null },
    invoice: null,
    metadata: {},
  })
  assertEquals(cost.amount, 300)
  assertEquals(formatWorkOrderId(WO_783E_TICKET_ID), "WO-783E")
})

Deno.test({
  name: "integration: HVAC repair-cost retrieval returns WO-783E with $300",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const url =
      Deno.env.get("SUPABASE_URL")?.trim() ||
      Deno.env.get("VITE_SUPABASE_URL")?.trim() ||
      ""
    const key =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
      Deno.env.get("SERVICE_ROLE_KEY")?.trim() ||
      ""

    if (!url || !key) {
      console.warn(
        "SKIP integration: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run live WO-783E test",
      )
      return
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Reproduce the exact bug path: pre-fix building filter would be "HVAC"
    const buggyFilter = "HVAC"
    assertEquals(sanitizeBuildingFilter(buggyFilter), null)

    const plan = classifyDeepOperationalInvestigation(REPAIR_COST_Q)
    assertEquals(plan.isRepairCostQuestion, true)
    assertEquals(plan.categories.includes("hvac"), true)

    const buildingFilter = extractBuildingFilter(REPAIR_COST_Q)
    assertEquals(buildingFilter, null)

    const result = await getOperationalWorkOrders(supabase, {
      organizationId: DEMO_LANDLORD_ID,
      buildingFilter, // must be null — not "HVAC"
      category: "hvac",
      searchTerms: plan.searchTerms,
      status: "open",
      dateRangeDays: 120,
      limit: 20,
    })

    assertEquals(result.available, true, result.error ?? "unavailable")
    assertEquals(result.workOrders.length > 0, true, "expected HVAC work orders")

    const wo783e = result.workOrders.find((w) => w.workOrderId === "WO-783E")
    assertEquals(Boolean(wo783e), true, `WO-783E missing; got ${result.workOrders.map((w) => w.workOrderId).join(",")}`)
    assertEquals(wo783e!.propertyName.toLowerCase().includes("maple"), true)
    assertEquals(wo783e!.unitLabel, "207")
    assertEquals(wo783e!.category.toLowerCase().includes("hvac"), true)
    assertEquals(wo783e!.estimatedCost, 300)
    assertStringIncludes(wo783e!.description.toLowerCase(), "compressor")

    const deep = await deepOperationalInvestigationLookup(supabase, {
      landlordId: DEMO_LANDLORD_ID,
      question: REPAIR_COST_Q,
      buildingFilter: buggyFilter, // raw buggy value — must be sanitized inside lookup
    })

    assertEquals(deep.found, true, deep.markdown.slice(0, 200))
    assertEquals(
      deep.workOrders.some((w) => w.workOrderId === "WO-783E"),
      true,
    )
    assertStringIncludes(deep.markdown, "WO-783E")
    assertStringIncludes(deep.markdown, "$300")
    assertEquals(
      /Maple Heights|Unit 207/i.test(deep.markdown),
      true,
    )
    assertEquals(
      /request-level|high-level activity|cannot access/i.test(deep.markdown),
      false,
      "must not claim request-level data unavailable",
    )
  },
})
