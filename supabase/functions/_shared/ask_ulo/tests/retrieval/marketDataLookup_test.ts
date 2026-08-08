/// <reference lib="deno.ns" />
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { marketDataLookup, resolveMarketSearchAddress } from "../../retrieval/marketDataLookup.ts"

Deno.test("resolveMarketSearchAddress prefers addressLine from properties table", () => {
  const loc = resolveMarketSearchAddress({
    buildingName: "Maple Heights",
    cityLabel: "Hillsboro",
    stateCode: "OR",
    addressLine: "901 Maple Heights Blvd, Hillsboro, OR 97124",
  })
  assertEquals(loc.address?.includes("97124"), true)
})

Deno.test("resolveMarketSearchAddress falls back to city/state when no address", () => {
  const loc = resolveMarketSearchAddress({
    buildingName: "Maple Heights",
    cityLabel: "Hillsboro",
    stateCode: "OR",
  })
  assertEquals(loc.address, null)
  assertEquals(loc.city, "Hillsboro")
  assertEquals(loc.state, "OR")
})

Deno.test({
  name: "Zillow Research ZORI returns live rent for Maple Heights ZIP",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await marketDataLookup({
      buildingName: "Maple Heights",
      cityLabel: "Hillsboro",
      stateCode: "OR",
      addressLine: "901 Maple Heights Blvd, Hillsboro, OR 97124",
    })
    assertEquals(result.available, true)
    assertEquals(result.provider, "zillow_research")
    assertExists(result.estimatedRent)
    assertEquals(result.estimatedRent! > 1000, true)
    assertEquals(result.citations[0]?.tool, "market_data")
  },
})
