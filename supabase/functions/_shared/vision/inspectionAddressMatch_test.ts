/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { inspectionReportAddressMatches } from "./inspectionAddressMatch.ts"

const expected = {
  expectedStreet: "12 Maple Street",
  expectedCity: "Newark",
  expectedState: "NJ",
  expectedZip: "07104",
  expectedBuilding: "12 Maple St",
}

Deno.test("accepts the same street with abbreviations", () => {
  assertEquals(
    inspectionReportAddressMatches({
      ...expected,
      extracted: {
        street: "12 Maple St",
        city: "Newark",
        state: "NJ",
        zip: "07104",
        raw: "12 Maple St, Newark, NJ 07104",
      },
    }),
    true,
  )
})

Deno.test("rejects a different street number", () => {
  assertEquals(
    inspectionReportAddressMatches({
      ...expected,
      extracted: {
        street: "90 Maple Street",
        city: "Newark",
        state: "NJ",
        zip: "07104",
        raw: "90 Maple Street, Newark, NJ 07104",
      },
    }),
    false,
  )
})

Deno.test("rejects a different ZIP code", () => {
  assertEquals(
    inspectionReportAddressMatches({
      ...expected,
      extracted: {
        street: "12 Maple Street",
        city: "Newark",
        state: "NJ",
        zip: "07105",
        raw: "12 Maple Street, Newark, NJ 07105",
      },
    }),
    false,
  )
})
