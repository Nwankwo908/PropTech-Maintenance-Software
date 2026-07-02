/// <reference lib="deno.ns" />

import { MockExternalVendorProvider } from "./mock.ts"
import { buildExternalSearchQuery } from "../trade_terms.ts"

Deno.test("mock provider returns plumbing suggestions", async () => {
  const provider = new MockExternalVendorProvider()
  const { tradeTerms, textQuery, searchLocation } = buildExternalSearchQuery(
    "plumbing",
    "Austin, TX",
  )
  const hits = await provider.search({
    issueCategory: "plumbing",
    searchLocation,
    tradeTerms,
    textQuery,
  })
  if (hits.length < 2) {
    throw new Error(`expected mock plumbing hits, got ${hits.length}`)
  }
  if (!hits.every((h) => h.source === "mock")) {
    throw new Error("expected mock source on all hits")
  }
})

Deno.test("mock provider is always configured", () => {
  const provider = new MockExternalVendorProvider()
  if (!provider.isConfigured()) {
    throw new Error("mock provider should always be configured")
  }
})
