/// <reference lib="deno.ns" />

import { discoverExternalVendorsMerged } from "./discover.ts"

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
