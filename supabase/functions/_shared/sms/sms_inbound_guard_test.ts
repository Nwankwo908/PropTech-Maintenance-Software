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

Deno.test("outboundCountsTowardIdenticalReplyLoop ignores failed candidates", async () => {
  const { outboundCountsTowardIdenticalReplyLoop } = await import(
    "./sms_inbound_guard.ts"
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "failed" }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({
      providerStatus: null,
      rawPayload: { send_error: "provider down" },
    }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "delivered" }),
    true,
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


Deno.test("Home Check repeat gate anchors to the exact inbound and keeps same-turn protection", async () => {
  const { shouldTripOutboundCircuit } = await import("./sms_inbound_guard.ts")
  const now = Date.now()
  const inboundAt = new Date(now - 5000).toISOString()
  const outboundAt = new Date(now - 1000).toISOString()
  const body = "What does this photo show? Reply 1–4."
  const filters: Array<[string, unknown, unknown]> = []
  let includeSameTurn = false
  const db = { from: () => {
    let cutoff = ""
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push(['eq', key, value]); return q },
      gte: (key: string, value: string) => { cutoff = value; filters.push(['gte', key, value]); return q },
      maybeSingle: async () => ({ data: { created_at: inboundAt }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [
        { body, created_at: new Date(now - 10000).toISOString(), provider_status: 'delivered' },
        ...(includeSameTurn ? [{ body, created_at: outboundAt, provider_status: 'delivered' }] : []),
      ].filter(row => row.created_at >= cutoff), error: null })),
    }
    return q
  } }
  // Normal workflows keep the hour-long protection.
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body })).trip, true)
  // A new Home Check photo may legitimately need the same clarification.
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body, replyToInboundId: 'exact-inbound' })).trip, false)
  assertEquals(filters.some(([op, key, value]) => op === 'eq' && key === 'id' && value === 'exact-inbound'), true)
  // Reprocessing that same inbound still suppresses the duplicate reply.
  includeSameTurn = true
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body, replyToInboundId: 'exact-inbound' })).trip, true)
})
