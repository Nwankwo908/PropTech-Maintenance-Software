/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildServiceAreaFromVendorLocation,
  mergeServiceAreaWithVendorLocation,
  normalizeUsStateCode,
  serviceAreaHasCityOrState,
} from "./serviceAreaFromVendorLocation.ts"

Deno.test("normalizeUsStateCode accepts codes and names", () => {
  assertEquals(normalizeUsStateCode("il"), "IL")
  assertEquals(normalizeUsStateCode("Illinois"), "IL")
  assertEquals(normalizeUsStateCode(""), "")
})

Deno.test("buildServiceAreaFromVendorLocation seeds city and state", () => {
  const area = buildServiceAreaFromVendorLocation({
    city: "Atlanta",
    state: "GA",
  })
  assertExists(area)
  assertEquals(area!.cities, ["Atlanta"])
  assertEquals(area!.counties, ["GA"])
  assertEquals(area!.centerAddress, "Atlanta, GA")
})

Deno.test("mergeServiceAreaWithVendorLocation prefers existing area", () => {
  const merged = mergeServiceAreaWithVendorLocation(
    { cities: ["Chicago"], counties: ["IL"], zips: [], centerAddress: "Chicago, IL" },
    { city: "Atlanta", state: "GA" },
  )
  assertEquals(merged.cities, ["Chicago"])
  assertEquals(merged.counties, ["IL"])
})

Deno.test("mergeServiceAreaWithVendorLocation fills empty area from roster", () => {
  const merged = mergeServiceAreaWithVendorLocation({}, {
    city: "dallas",
    state: "texas",
  })
  assertEquals(serviceAreaHasCityOrState(merged), true)
  assertEquals(merged.cities, ["dallas"])
  assertEquals(merged.counties, ["TX"])
})
