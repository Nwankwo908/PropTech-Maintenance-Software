/// <reference lib="deno.ns" />

import { buildingLineFromInspectionDescription, discoverExternalVendors, discoverExternalVendorsMerged, landlordAllowsMockExternalVendors, workflowLocationHintFromRuns } from "./discover.ts"
import { ALPHA_PRODUCTION_LANDLORD_ID, DEMO_SHOWCASE_LANDLORD_ID } from "../demo_workflow_ids.ts"

Deno.test("discoverExternalVendorsMerged falls back to mock without API keys", async () => {
  const suggestions = await discoverExternalVendorsMerged({
    issueCategory: "plumbing",
    searchLocation: "Oakwood Apartments",
  })
  if (suggestions.length === 0) {
    throw new Error("expected mock suggestions")
  }
  if (typeof suggestions[0].rankScore !== "number") {
    throw new Error("expected rankScore on suggestions")
  }
})

Deno.test("discoverExternalVendorsMerged ranks mock plumbing vendors", async () => {
  const suggestions = await discoverExternalVendorsMerged({
    issueCategory: "plumbing",
    searchLocation: "90210",
  })
  const names = suggestions.map((s) => s.name)
  if (!names.includes("Rapid Plumb Co.")) {
    throw new Error(`expected Rapid Plumb Co. in ${names.join(", ")}`)
  }
})

Deno.test("discoverExternalVendorsMerged returns electrical mocks", async () => {
  const suggestions = await discoverExternalVendorsMerged({
    issueCategory: "electrical",
    searchLocation: "Chicago, IL",
  })
  const names = suggestions.map((s) => s.name)
  if (!names.includes("BrightWire Electric")) {
    throw new Error(`expected BrightWire Electric in ${names.join(", ")}`)
  }
})

Deno.test("Alpha does not receive mock external vendors", async () => {
  const allowDemo = await landlordAllowsMockExternalVendors(
    null,
    DEMO_SHOWCASE_LANDLORD_ID,
  )
  const allowAlpha = await landlordAllowsMockExternalVendors(
    null,
    ALPHA_PRODUCTION_LANDLORD_ID,
  )
  if (!allowDemo) throw new Error("demo landlord should allow mock vendors")
  if (allowAlpha) throw new Error("Alpha must not allow mock vendors")

  const alpha = await discoverExternalVendors(null, {
    issueCategory: "electrical",
    searchLocation: "Newark, NJ",
    landlordId: ALPHA_PRODUCTION_LANDLORD_ID,
    allowMock: true,
    forceMock: true,
  })
  if (alpha.suggestions.some((s) => /compliant spark|brightwire|safepanel/i.test(s.name))) {
    throw new Error(`Alpha should not get demo vendors: ${alpha.suggestions.map((s) => s.name).join(", ")}`)
  }
  if (alpha.providersUsed.includes("mock")) {
    throw new Error("Alpha providers should not include mock")
  }

  const demo = await discoverExternalVendors(null, {
    issueCategory: "electrical",
    searchLocation: "Chicago, IL",
    landlordId: DEMO_SHOWCASE_LANDLORD_ID,
    allowMock: true,
  })
  if (!demo.suggestions.some((s) => s.name === "BrightWire Electric")) {
    throw new Error("demo account should still get mock vendors")
  }
})

Deno.test("the maintenance test account does not search outside vendors", async () => {
  const blocked = await discoverExternalVendors(null, {
    issueCategory: "electrical",
    searchLocation: "Newark, NJ 07102",
    landlordId: "d15a0000-0000-4000-8000-000000000001",
    allowMock: true,
    forceMock: true,
  })
  if (blocked.suggestions.length !== 0) {
    throw new Error("test account must not receive outside vendors")
  }
  if (blocked.providersUsed.length !== 0) {
    throw new Error("test account must not call an outside provider")
  }

  const other = await discoverExternalVendors(null, {
    issueCategory: "electrical",
    searchLocation: "Chicago, IL",
    landlordId: DEMO_SHOWCASE_LANDLORD_ID,
    allowMock: true,
  })
  if (!other.suggestions.some((row) => row.name === "BrightWire Electric")) {
    throw new Error("other accounts still search outside vendors")
  }
})

Deno.test("workflow location hint prefers the work-order building over a duplicate unit label", () => {
  const hint = workflowLocationHintFromRuns([
    {
      unit_id: "unit-grove",
      metadata: { building: "109 S Grove St", unit_label: "A" },
    },
  ])
  if (hint.building !== "109 S Grove St") {
    throw new Error(`expected Grove St, got ${hint.building}`)
  }
  if (hint.unitId !== "unit-grove") {
    throw new Error(`expected unit-grove, got ${hint.unitId}`)
  }
})

Deno.test("inspection description keeps the building line for vendor search", () => {
  const building = buildingLineFromInspectionDescription(
    "Property inspection visit\n\nTarget day: 2026-10-26\nBuilding: 14 Maple Ave\nUnit: 1",
  )
  if (building !== "14 Maple Ave") throw new Error(`expected 14 Maple Ave, got ${building}`)
})
