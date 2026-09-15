/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  normalizeUsStateCode,
  vendorCoversJobState,
  vendorServiceStateCodes,
} from "./vendorServiceArea.ts"

Deno.test("normalizeUsStateCode accepts codes and names", () => {
  assertEquals(normalizeUsStateCode("md"), "MD")
  assertEquals(normalizeUsStateCode("Maryland"), "MD")
  assertEquals(normalizeUsStateCode("NJ"), "NJ")
  assertEquals(normalizeUsStateCode("not-a-state"), null)
})

Deno.test("vendorServiceStateCodes reads verification service area and license", () => {
  assertEquals(
    vendorServiceStateCodes({
      serviceArea: { counties: ["NJ"], centerAddress: "Newark, NJ 07102" },
    }),
    ["NJ"],
  )
  assertEquals(
    vendorServiceStateCodes({
      serviceArea: { centerAddress: "Baltimore, Maryland 21218" },
    }).includes("MD"),
    true,
  )
  assertEquals(
    vendorServiceStateCodes({
      serviceArea: {},
      licenseState: "MD",
    }),
    ["MD"],
  )
})

Deno.test("vendorCoversJobState requires the same state when the job state is known", () => {
  assertEquals(vendorCoversJobState(["MD"], "Maryland"), true)
  assertEquals(vendorCoversJobState(["NJ"], "MD"), false)
  assertEquals(vendorCoversJobState([], "MD"), false)
  assertEquals(vendorCoversJobState(["NJ"], null), true)
})
