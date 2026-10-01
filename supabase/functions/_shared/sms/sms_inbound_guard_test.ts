/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inboundHasContent,
  shouldSuppressIdenticalOutbound,
} from "./sms_inbound_guard.ts"

Deno.test("inboundHasContent treats photo-only MMS as content", () => {
  assertEquals(inboundHasContent("", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("   ", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("Leak under sink", []), true)
  assertEquals(inboundHasContent("", []), false)
  assertEquals(inboundHasContent("   ", [""]), false)
})

Deno.test("shouldSuppressIdenticalOutbound trips when one prior identical body exists", () => {
  const body =
    "Happy to help. What do you need — a repair, something about rent or your lease, or something else?"
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [body],
      candidateBody: body,
    }).trip,
    true,
  )
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [],
      candidateBody: body,
    }).trip,
    false,
  )
})
