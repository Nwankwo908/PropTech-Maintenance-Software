/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  collectFromOnboardingProperties,
  majorityJurisdiction,
  parseStateCityFromAddress,
} from "./portfolioContext.ts"

Deno.test("collectFromOnboardingProperties reads city/state fields", () => {
  const rows = collectFromOnboardingProperties([
    {
      name: "Peachtree Flats",
      streetAddress: "100 Peachtree St",
      city: "Atlanta",
      state: "ga",
      zipCode: "30303",
    },
  ])
  assertEquals(rows.length, 1)
  assertEquals(rows[0].city, "Atlanta")
  assertEquals(rows[0].state, "GA")
  assertEquals(rows[0].name, "Peachtree Flats")
})

Deno.test("collectFromOnboardingProperties parses address when city/state split missing", () => {
  const rows = collectFromOnboardingProperties([
    {
      name: "Midtown Lofts",
      streetAddress: "200 Spring St, Atlanta, GA 30308",
      city: "",
      state: "",
      zipCode: "",
    },
  ])
  assertEquals(rows.length, 1)
  assertEquals(rows[0].city, "Atlanta")
  assertEquals(rows[0].state, "GA")
})

Deno.test("majorityJurisdiction prefers Georgia over empty", () => {
  const voted = majorityJurisdiction([
    { city: "Atlanta", state: "GA" },
    { city: "Atlanta", state: "GA" },
    { city: "Savannah", state: "GA" },
  ])
  assertEquals(voted.stateCode, "GA")
  assertEquals(voted.cityLabel, "Atlanta")
  assertEquals(voted.citySlug, "atlanta")
})

Deno.test("parseStateCityFromAddress handles US street format", () => {
  const parsed = parseStateCityFromAddress("812 Oakwood Ave, Portland, OR 97214")
  assertEquals(parsed?.city, "Portland")
  assertEquals(parsed?.state, "OR")
})

Deno.test("empty onboarding properties yield no locations", () => {
  assertEquals(collectFromOnboardingProperties(undefined).length, 0)
  assertEquals(collectFromOnboardingProperties([]).length, 0)
  assertEquals(collectFromOnboardingProperties({}).length, 0)
})
