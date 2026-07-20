/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { vendorDisplayName } from "./vendorNames.ts"

Deno.test("vendorDisplayName prefers real name over empty aliases", () => {
  assertEquals(vendorDisplayName({ name: "Acme Plumbing" }), "Acme Plumbing")
  assertEquals(
    vendorDisplayName({ business_name: "  Sparky Electric  ", name: "x" }),
    "Sparky Electric",
  )
  assertEquals(vendorDisplayName({ name: "   " }), null)
  assertEquals(vendorDisplayName({}), null)
})
