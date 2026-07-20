/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { synthesizeTemperatureForIntent } from "./synthesizeTemperature.ts"

Deno.test("legal stays coldest", () => {
  assertEquals(synthesizeTemperatureForIntent("legal"), 0.15)
})

Deno.test("finance and price history stay cold", () => {
  assertEquals(synthesizeTemperatureForIntent("finance"), 0.2)
  assertEquals(synthesizeTemperatureForIntent("property_price_history"), 0.2)
})

Deno.test("general is warmest for conversational drafts", () => {
  assertEquals(synthesizeTemperatureForIntent("general"), 0.55)
})

Deno.test("ops and maintenance sit mid-range", () => {
  assertEquals(synthesizeTemperatureForIntent("ops"), 0.4)
  assertEquals(synthesizeTemperatureForIntent("maintenance"), 0.4)
})
