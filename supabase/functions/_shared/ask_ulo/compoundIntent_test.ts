/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  appendDroppedHalfIfNeeded,
  detectCompoundVendorMarketIntent,
  formatDroppedHalfNote,
} from "./compoundIntent.ts"

Deno.test("compound: vendor + fair rate is compound", () => {
  const c = detectCompoundVendorMarketIntent(
    "Find a plumber outside my network and tell me what a fair rate is",
  )
  assertEquals(c.vendor, true)
  assertEquals(c.market, true)
  assertEquals(c.isCompound, true)
})

Deno.test("compound: vendor-only is not compound", () => {
  const c = detectCompoundVendorMarketIntent("Find a local plumber outside my roster")
  assertEquals(c.vendor, true)
  assertEquals(c.isCompound, false)
})

Deno.test("compound: dropped-half note invites separate ask", () => {
  const note = formatDroppedHalfNote({ handled: "vendor", dropped: "market" })
  assertStringIncludes(note, "One thing at a time")
  assertStringIncludes(note, "fair")
})

Deno.test("compound: append only when one half shipped", () => {
  const base = "Here are three local plumbers."
  const compound = detectCompoundVendorMarketIntent(
    "Find a plumber outside my network and is $200/hr a fair rate?",
  )
  const out = appendDroppedHalfIfNeeded(base, {
    compound,
    shippedVendor: true,
    shippedMarket: false,
  })
  assertStringIncludes(out, "One thing at a time")
  assertEquals(
    appendDroppedHalfIfNeeded(base, {
      compound,
      shippedVendor: true,
      shippedMarket: true,
    }),
    base,
  )
})
