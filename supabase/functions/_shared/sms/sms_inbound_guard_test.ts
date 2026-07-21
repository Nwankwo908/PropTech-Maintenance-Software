/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { inboundHasContent } from "./sms_inbound_guard.ts"

Deno.test("inboundHasContent treats photo-only MMS as content", () => {
  assertEquals(inboundHasContent("", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("   ", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("Leak under sink", []), true)
  assertEquals(inboundHasContent("", []), false)
  assertEquals(inboundHasContent("   ", [""]), false)
})
