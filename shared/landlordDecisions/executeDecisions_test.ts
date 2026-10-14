import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildLandlordPickBatchSms } from "./batchMessage.ts"
import {
  buildDecisionConfirmation,
  executeDecisionPlan,
  type BatchCandidate,
} from "./executeDecisions.ts"
import { parseDecisionReply } from "./parseDecisionReply.ts"

const now = new Date("2026-10-11T16:00:00Z")
const tz = "America/New_York"

function candidate(
  displayId: number,
  ticketClass: "reactive" | "proactive",
): BatchCandidate {
  return {
    ticketId: `ticket-${displayId}`,
    displayId,
    ticketClass,
    awaitingPick: true,
    vendorName: displayId === 101 ? "ABC Plumbing" : "Metro Electric",
    windowLabel: displayId === 101 ? "Tue AM" : "Fri AM",
    vendorAvailable: true,
    windowAvailable: true,
  }
}

Deno.test("three-ticket batch reply books one, snoozes one, and confirms once", () => {
  const items = [
    {
      displayId: 101,
      unitLabel: "12A",
      issue: "Kitchen sink leak",
      vendorName: "ABC Plumbing",
      windowLabel: "Tue AM",
      costLow: 150,
      costHigh: 250,
    },
    {
      displayId: 103,
      unitLabel: "4B",
      issue: "Outlet dead",
      vendorName: "Metro Electric",
      windowLabel: "Fri AM",
      costLow: 80,
      costHigh: 80,
    },
    {
      displayId: 104,
      unitLabel: "2",
      issue: "Filter replacement",
      vendorName: "Handy Co",
      windowLabel: "Wed PM",
      costLow: null,
      costHigh: null,
    },
  ]
  const batchSms = buildLandlordPickBatchSms(items, 0)
  assertStringIncludes(batchSms, "Ulo: 3 requests need your decision")
  assertStringIncludes(
    batchSms,
    "#101 Kitchen sink leak — Unit 12A (kitchen) - ABC Plumbing · Tue AM - est $150-250",
  )
  assertEquals(batchSms.includes("STOP"), false)

  const candidates = [
    candidate(101, "reactive"),
    candidate(103, "reactive"),
    candidate(104, "proactive"),
  ]
  const parsed = parseDecisionReply(
    "101 yes, 103 snooze fri, 999 yes",
    candidates.map((row) => ({ displayId: row.displayId, ticketClass: row.ticketClass })),
    now,
    tz,
  )
  const plan = executeDecisionPlan({ candidates, parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)

  assertEquals(plan.mutations.filter((row) => row.kind === "book").length, 1)
  assertEquals(plan.mutations.filter((row) => row.kind === "snooze").length, 1)
  assertEquals(plan.mutations.find((row) => row.kind === "snooze"), {
    kind: "snooze",
    ticketId: "ticket-103",
    displayId: 103,
    until: "2026-10-16",
  })
  assertStringIncludes(confirmation, "Done: #101 approved. #103 snoozed to Fri 10/16.")
  assertStringIncludes(confirmation, "I couldn't find #999. Your open requests are #101, #103, #104.")
  assertEquals(confirmation.includes("Done: #101 approved. #103 snoozed to Fri 10/16. I couldn't find"), false)
  assertEquals(confirmation.split("\n").length, 2)
})

Deno.test("YES ALL within 10 minutes of a replacement batch asks before booking", () => {
  const parsed = parseDecisionReply("YES ALL", [candidate(101, "reactive")], now, tz)
  const plan = executeDecisionPlan({
    candidates: [candidate(101, "reactive")],
    parsed,
    yesAllNeedsConfirm: true,
  })
  assertEquals(plan.mutations, [])
  assertEquals(plan.executed, false)
  assertStringIncludes(plan.question ?? "", "Reply YES ALL again")
})

Deno.test("a wrong id with one open request suggests that request and does not book", () => {
  const open = {
    ...candidate(102, "reactive"),
    issue: "Bedroom sink leak",
    unitLabel: "2",
  }
  const parsed = parseDecisionReply("101", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [])
  assertEquals(confirmation.includes("Done"), false)
  assertStringIncludes(confirmation, "I couldn't find #101. Did you mean the Bedroom sink leak in Unit 2?")
})

Deno.test("a bare matching number asks for an action and does not book", () => {
  const open = { ...candidate(102, "reactive"), issue: "Bedroom sink leak" }
  const parsed = parseDecisionReply("102", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [])
  assertEquals(confirmation.includes("Done"), false)
  assertStringIncludes(
    confirmation,
    "What should I do with #102 (Bedroom sink leak)? Reply YES, SNOOZE FRI, or SKIP.",
  )
})

Deno.test("YES with one open item approves it", () => {
  const open = candidate(102, "reactive")
  const parsed = parseDecisionReply("YES", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [{ kind: "book", ticketId: "ticket-102", displayId: 102 }])
  assertEquals(confirmation, "Done: #102 approved.")
})

Deno.test("mixed known yes and unknown skip keeps Done off the unknown id", () => {
  const open = candidate(102, "reactive")
  const parsed = parseDecisionReply(
    "102 yes, 999 skip",
    [{ displayId: 102, ticketClass: "reactive" }],
    now,
    tz,
  )
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations.map((row) => row.kind), ["book"])
  assertStringIncludes(confirmation, "Done: #102 approved.")
  assertStringIncludes(confirmation, "I couldn't find #999.")
  assertEquals(/^Done:.*999/m.test(confirmation), false)
})

Deno.test("skip on a tenant request does not change the ticket", () => {
  const parsed = parseDecisionReply(
    "101 skip",
    [{ displayId: 101, ticketClass: "reactive" }],
    now,
    tz,
  )
  const plan = executeDecisionPlan({
    candidates: [candidate(101, "reactive")],
    parsed,
  })
  assertEquals(plan.mutations, [])
  assertStringIncludes(plan.lines[0]?.text ?? "", "can't skip a tenant request")
})
