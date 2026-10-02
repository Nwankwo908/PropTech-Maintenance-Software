/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  countIdenticalRecentOutbounds,
  shouldSuppressIdenticalOutbound,
} from "./sms_inbound_guard.ts"
import {
  isRecentClarifyMenuAsk,
  parseClarifyMenuSelection,
} from "./clarifyMenuIntakeSeed.ts"
import {
  buildTenantDistressHandoffSms,
  canHandleTenantDistress,
  detectTenantDistressSignals,
  shouldSuppressTicketAppendAsk,
} from "./tenantDistress.ts"

const MENU =
  "Happy to help. What do you need — a repair, something about rent or your lease, or something else?"

Deno.test("menu option echoed verbatim is recognized as a selection", () => {
  assertEquals(parseClarifyMenuSelection("Something else"), "something_else")
  assertEquals(parseClarifyMenuSelection("something else"), "something_else")
  assertEquals(parseClarifyMenuSelection("A repair"), "repair")
  assertEquals(parseClarifyMenuSelection("a repair"), "repair")
  assertEquals(
    parseClarifyMenuSelection("something about rent or your lease"),
    "rent_or_lease",
  )
  assertEquals(parseClarifyMenuSelection("rent or lease"), "rent_or_lease")
  assertEquals(isRecentClarifyMenuAsk(new Date().toISOString()), true)
  assertEquals(isRecentClarifyMenuAsk(null), false)
})

Deno.test("menu option near-verbatim typos still select", () => {
  assertEquals(parseClarifyMenuSelection("Somthing else"), "something_else")
  assertEquals(parseClarifyMenuSelection("repar"), "repair")
})

Deno.test("unrelated text is not a menu selection", () => {
  assertEquals(parseClarifyMenuSelection("What is your time zone"), null)
  assertEquals(parseClarifyMenuSelection("My dryer caught fire"), null)
})

Deno.test("identical outbound trips on the second send (one prior match)", () => {
  const body = MENU
  const once = shouldSuppressIdenticalOutbound({
    recentOutboundBodies: [body],
    candidateBody: body,
  })
  assertEquals(once.trip, true)
  assertEquals(once.hits, 1)
  assertEquals(once.reason, "identical_reply_loop")

  const none = shouldSuppressIdenticalOutbound({
    recentOutboundBodies: ["something else entirely"],
    candidateBody: body,
  })
  assertEquals(none.trip, false)
  assertEquals(none.hits, 0)

  assertEquals(countIdenticalRecentOutbounds([body, "other", body], body), 2)
})

Deno.test("profanity triggers distress and suppresses ticket-append ask", () => {
  const body = "This is stupid as shit you ain't gonna make it long"
  const signal = detectTenantDistressSignals({ body })
  assertEquals(signal.distress, true)
  assertEquals(signal.reasons.includes("profanity"), true)
  assertEquals(
    canHandleTenantDistress({
      identityType: "resident",
      body,
    }),
    true,
  )
  assertEquals(shouldSuppressTicketAppendAsk({ body }), true)
  const handoff = buildTenantDistressHandoffSms("Kenniesa")
  assertEquals(handoff.includes("Happy to help"), false)
  assertEquals(handoff.includes("a repair, something about rent"), false)
  assertEquals(handoff.includes("member of our team will follow up"), true)
})

Deno.test("don't text me language triggers distress handoff not menu", () => {
  const bodies = [
    "I don't have a pest problem and don't text me at 3am",
    "Do not text me at three a m",
    "stop texting me",
  ]
  for (const body of bodies) {
    const signal = detectTenantDistressSignals({ body })
    assertEquals(signal.distress, true, body)
    assertEquals(signal.reasons.includes("stop_texting"), true, body)
    assertEquals(shouldSuppressTicketAppendAsk({ body }), true, body)
  }
})

Deno.test("outbound loop flag alone does not distress ordinary follow-ups", () => {
  const signal = detectTenantDistressSignals({
    body: "ok",
    intakeState: { outbound_identical_reply_loop_at: new Date().toISOString() },
  })
  assertEquals(signal.distress, false)
  assertEquals(signal.reasons.includes("outbound_loop"), false)
  assertEquals(
    canHandleTenantDistress({
      identityType: "resident",
      body: "Thank you very much",
      intakeState: { outbound_identical_reply_loop_at: new Date().toISOString() },
    }),
    false,
  )
})

Deno.test("outbound loop flag + profanity still distresses", () => {
  const signal = detectTenantDistressSignals({
    body: "this is bullshit",
    intakeState: { outbound_identical_reply_loop_at: new Date().toISOString() },
  })
  assertEquals(signal.distress, true)
  assertEquals(signal.reasons.includes("profanity"), true)
  assertEquals(signal.reasons.includes("outbound_loop"), true)
})

Deno.test("ordinary unclear ask is not distress", () => {
  const body = "What is your time zone"
  assertEquals(detectTenantDistressSignals({ body }).distress, false)
  assertEquals(shouldSuppressTicketAppendAsk({ body }), false)
  assertEquals(
    canHandleTenantDistress({ identityType: "resident", body }),
    false,
  )
})
