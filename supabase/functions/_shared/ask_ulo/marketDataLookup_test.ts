import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { marketDataLookup, resolveMarketSearchAddress } from "./marketDataLookup.ts"

Deno.test("resolves Maple Heights demo address with ZIP", () => {
  const loc = resolveMarketSearchAddress({
    buildingName: "Maple Heights",
    cityLabel: "Hillsboro",
    stateCode: "OR",
  })
  assertEquals(loc.address?.includes("97124"), true)
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
