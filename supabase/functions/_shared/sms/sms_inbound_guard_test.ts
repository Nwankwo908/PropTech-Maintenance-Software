/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inboundHasContent,
  normalizeOutboundForLoopCompare,
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

Deno.test("normalizeOutboundForLoopCompare strips Hi there / Hi Name greetings", () => {
  const there =
    "Hi there,\n\nI'm sorry this has been frustrating.\n\nA member of our team will follow up with you here shortly."
  const named =
    "Hi Shahita,\n\nI'm sorry this has been frustrating.\n\nA member of our team will follow up with you here shortly."
  assertEquals(
    normalizeOutboundForLoopCompare(there),
    normalizeOutboundForLoopCompare(named),
  )
  assertEquals(
    normalizeOutboundForLoopCompare(there).includes("hi there"),
    false,
  )
})
