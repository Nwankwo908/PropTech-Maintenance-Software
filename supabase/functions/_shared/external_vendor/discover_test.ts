/// <reference lib="deno.ns" />

import { discoverExternalVendors, discoverExternalVendorsMerged, landlordAllowsMockExternalVendors, workflowLocationHintFromRuns } from "./discover.ts"
import { ALPHA_PRODUCTION_LANDLORD_ID, DEMO_SHOWCASE_LANDLORD_ID } from "../demo_workflow_ids.ts"

Deno.test("discoverExternalVendorsMerged falls back to mock without API keys", async () => {
  const suggestions = await discoverExternalVendorsMerged({
    issueCategory: "plumbing",
    searchLocation: "Oakwood Apartments",
    googleApiKey: null,
    yelpApiKey: null,
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
    googleApiKey: null,
    yelpApiKey: null,
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
    googleApiKey: null,
    yelpApiKey: null,
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
