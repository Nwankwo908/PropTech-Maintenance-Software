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
  assertStringIncludes(batchSms, "#101 12A Kitchen sink leak - ABC Plumbing Tue AM - est $150-250")
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
  const confirmation = buildDecisionConfirmation(
    plan.lines.map((line) => line.text),
    plan.question,
  )

  assertEquals(plan.mutations.filter((row) => row.kind === "book").length, 1)
  assertEquals(plan.mutations.filter((row) => row.kind === "snooze").length, 1)
  assertEquals(plan.mutations.find((row) => row.kind === "snooze"), {
    kind: "snooze",
    ticketId: "ticket-103",
    displayId: 103,
    until: "2026-10-16",
  })
  assertStringIncludes(confirmation, "#101 booked Tue AM with ABC Plumbing.")
  assertStringIncludes(confirmation, "#103 snoozed to Fri 10/16.")
  assertStringIncludes(confirmation, "#999 isn't in your list.")
  assertEquals(confirmation.split("\n").length, 1)
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
