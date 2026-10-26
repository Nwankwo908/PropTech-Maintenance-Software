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
  assertEquals(batchSms.includes("SNOOZE"), false)
  assertEquals(batchSms.includes("SKIP"), false)

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
  assertStringIncludes(confirmation, "Reply YES or NO.")
  assertEquals(confirmation.includes("SNOOZE"), false)
  assertEquals(confirmation.includes("SKIP"), false)
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
    "What should I do with that request (Bedroom sink leak)? Reply YES or NO.",
  )
  assertEquals(confirmation.includes("SNOOZE"), false)
  assertEquals(confirmation.includes("SKIP"), false)
})

Deno.test("YES with one open item approves it without a display id", () => {
  const open = candidate(102, "reactive")
  const parsed = parseDecisionReply("YES", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [{ kind: "book", ticketId: "ticket-102", displayId: 102 }])
  assertEquals(confirmation, "Got it — approved.")
  assertEquals(confirmation.includes("#102"), false)
  assertEquals(confirmation.includes("Done:"), false)
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
  assertStringIncludes(confirmation, "Got it — approved.")
  assertStringIncludes(confirmation, "I couldn't find #999.")
  assertEquals(confirmation.includes("#102"), false)
  assertEquals(/^Done:.*999/m.test(confirmation), false)
})

Deno.test("bare no on a reactive ticket sends other options", () => {
  const open = {
    ...candidate(102, "reactive"),
    vendorName: "Ecosafe Pest Management LLC",
    issue: "Pest control",
  }
  const parsed = parseDecisionReply("no", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [{
    kind: "options",
    ticketId: "ticket-102",
    displayId: 102,
  }])
  assertEquals(plan.mutations.some((row) => row.kind === "skip"), false)
  assertEquals(
    confirmation,
    "Got it — not Ecosafe Pest Management LLC. I'll send other options for the pest job.",
  )
  assertEquals(confirmation.includes("#"), false)
})

Deno.test("bare no on a proactive ticket declines the job", () => {
  const open = {
    ...candidate(104, "proactive"),
    vendorName: "Ecosafe Pest Management LLC",
    issue: "Pest control",
    propertyAddress: "109 S Grove St",
  }
  const parsed = parseDecisionReply("NO", [{ displayId: 104, ticketClass: "proactive" }], now, tz)
  const plan = executeDecisionPlan({ candidates: [open], parsed })
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertEquals(plan.mutations, [{
    kind: "skip",
    ticketId: "ticket-104",
    displayId: 104,
  }])
  assertEquals(
    confirmation,
    "Got it — Pest control at 109 S Grove St is declined.",
  )
  assertEquals(confirmation.includes("#"), false)
})

Deno.test("102 no, 105 yes in a batch applies per item", () => {
  const candidates = [
    { ...candidate(102, "reactive"), vendorName: "Ecosafe Pest Management LLC", issue: "Pest control" },
    { ...candidate(105, "reactive"), vendorName: "Metro Electric", issue: "Outlet dead" },
  ]
  const parsed = parseDecisionReply(
    "102 no, 105 yes",
    candidates.map((row) => ({ displayId: row.displayId, ticketClass: row.ticketClass })),
    now,
    tz,
  )
  const plan = executeDecisionPlan({ candidates, parsed })
  assertEquals(plan.mutations, [
    { kind: "options", ticketId: "ticket-102", displayId: 102 },
    { kind: "book", ticketId: "ticket-105", displayId: 105 },
  ])
  const confirmation = buildDecisionConfirmation(plan.lines, plan.question)
  assertStringIncludes(confirmation, "Done:")
  assertStringIncludes(confirmation, "#102")
  assertStringIncludes(confirmation, "#105 approved.")
})

Deno.test("legacy skip on a tenant request now sends other options", () => {
  const parsed = parseDecisionReply(
    "101 skip",
    [{ displayId: 101, ticketClass: "reactive" }],
    now,
    tz,
  )
  const plan = executeDecisionPlan({
    candidates: [{ ...candidate(101, "reactive"), vendorName: "ABC Plumbing", issue: "Kitchen sink leak" }],
    parsed,
  })
  assertEquals(plan.mutations, [{
    kind: "options",
    ticketId: "ticket-101",
    displayId: 101,
  }])
  assertEquals((plan.lines[0]?.text ?? "").includes("can't skip"), false)
})

Deno.test("FIXED closes one item without a display id and leaves self open", () => {
  const only = [candidate(102, "reactive")]
  const fixed = executeDecisionPlan({
    candidates: only,
    parsed: parseDecisionReply("FIXED", [{ displayId: 102, ticketClass: "reactive" }], now, tz),
  })
  assertEquals(fixed.mutations, [{ kind: "fixed", ticketId: "ticket-102", displayId: 102 }])
  assertEquals(fixed.lines[0]?.text, "Got it — closed. No vendor booked.")

  const self = executeDecisionPlan({
    candidates: only,
    parsed: parseDecisionReply("102 self", [{ displayId: 102, ticketClass: "reactive" }], now, tz),
  })
  assertEquals(self.mutations, [{ kind: "self", ticketId: "ticket-102", displayId: 102 }])
  assertEquals(self.lines[0]?.text, "Got it — marked for you to handle.")
  assertEquals(self.mutations[0]?.kind === "fixed", false)
})

Deno.test("bare FIXED with two open items asks which one", () => {
  const candidates = [candidate(101, "reactive"), candidate(103, "reactive")]
  const plan = executeDecisionPlan({
    candidates,
    parsed: parseDecisionReply(
      "FIXED",
      candidates.map((row) => ({ displayId: row.displayId, ticketClass: row.ticketClass })),
      now,
      tz,
    ),
  })
  assertEquals(plan.mutations, [])
  assertEquals(plan.question, "Which one is fixed? Reply with the number, like 1 FIXED.")
})
