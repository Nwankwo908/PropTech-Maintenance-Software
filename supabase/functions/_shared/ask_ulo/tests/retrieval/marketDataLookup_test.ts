/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { resolveMarketSearchAddress } from "../../retrieval/marketDataLookup.ts"

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
