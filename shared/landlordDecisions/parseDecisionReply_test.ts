import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { parseDecisionReply, type DecisionCandidate } from "./parseDecisionReply.ts"
import { filterLlmDecisionProposals } from "./filterLlmDecisionProposals.ts"

const now = new Date("2026-10-11T16:00:00Z")
const tz = "America/New_York"
const friday = new Date("2026-10-16T16:00:00Z")

const three: DecisionCandidate[] = [
  { displayId: 101, ticketClass: "reactive" },
  { displayId: 103, ticketClass: "reactive" },
  { displayId: 104, ticketClass: "proactive" },
]

Deno.test("101 yes, 103 snooze fri", () => {
  const parsed = parseDecisionReply("101 yes, 103 snooze fri", three, now, tz)
  assertEquals(parsed.yesAll, false)
  assertEquals(parsed.unclear, [])
  assertEquals(parsed.intents, [
    { displayId: 101, action: "yes" },
    { displayId: 103, action: "snooze", snoozeUntil: "2026-10-16" },
  ])
})

Deno.test("YES ALL marks every candidate without listing them", () => {
  const parsed = parseDecisionReply("YES ALL", three, now, tz)
  assertEquals(parsed.yesAll, true)
  assertEquals(parsed.intents, [])
  const phrase = parseDecisionReply("yes to all", three, now, tz)
  assertEquals(phrase.yesAll, true)
})

Deno.test("bare yes applies only when there is one candidate", () => {
  const one = parseDecisionReply("yes", [three[0]!], now, tz)
  assertEquals(one.intents, [{ displayId: 101, action: "yes" }])
  assertEquals(one.unclear, [])

  const many = parseDecisionReply("approve", three, now, tz)
  assertEquals(many.intents, [])
  assertEquals(many.unclear, ["approve"])
})

Deno.test("a bare number is unclear and is not an intent", () => {
  const parsed = parseDecisionReply("101", three, now, tz)
  assertEquals(parsed.intents, [])
  assertEquals(parsed.unclear, ["101"])
  const hash = parseDecisionReply("#102", [{ displayId: 102, ticketClass: "reactive" }], now, tz)
  assertEquals(hash.intents, [])
  assertEquals(hash.unclear, ["#102"])
})

Deno.test("bare SNOOZE FRI and SKIP apply only when one request is open", () => {
  const one = [{ displayId: 102, ticketClass: "reactive" as const }]
  const snooze = parseDecisionReply("SNOOZE FRI", one, now, tz)
  assertEquals(snooze.intents, [
    { displayId: 102, action: "snooze", snoozeUntil: "2026-10-16" },
  ])
  const skip = parseDecisionReply("SKIP", [{ displayId: 104, ticketClass: "proactive" }], now, tz)
  assertEquals(skip.intents, [{ displayId: 104, action: "skip" }])
  const many = parseDecisionReply("SNOOZE FRI", three, now, tz)
  assertEquals(many.intents, [])
  assertEquals(many.unclear, ["SNOOZE FRI"])
})

Deno.test("decline / nope parse as no; bare no applies with one open item", () => {
  const one = [{ displayId: 102, ticketClass: "reactive" as const }]
  assertEquals(parseDecisionReply("no", one, now, tz).intents, [
    { displayId: 102, action: "no" },
  ])
  assertEquals(parseDecisionReply("nope", one, now, tz).intents, [
    { displayId: 102, action: "no" },
  ])
  assertEquals(parseDecisionReply("decline", one, now, tz).intents, [
    { displayId: 102, action: "no" },
  ])
  const many = parseDecisionReply("no", three, now, tz)
  assertEquals(many.intents, [])
  assertEquals(many.unclear, ["no"])
  assertEquals(parseDecisionReply("102 no, 105 yes", [
    { displayId: 102, ticketClass: "reactive" },
    { displayId: 105, ticketClass: "reactive" },
  ], now, tz).intents, [
    { displayId: 102, action: "no" },
    { displayId: 105, action: "yes" },
  ])
})

Deno.test("LLM proposals accept no and still drop skip on reactive", () => {
  const accepted = filterLlmDecisionProposals(
    [
      { display_id: 101, action: "no", confidence: 0.9 },
      { display_id: 103, action: "skip", confidence: 0.99 },
    ],
    three,
  )
  assertEquals(accepted, [{ displayId: 101, action: "no" }])
})

Deno.test("a unit number that is not a candidate stays unclear", () => {
  const parsed = parseDecisionReply("unit 12 is fine", three, now, tz)
  assertEquals(parsed.intents, [])
  assertEquals(parsed.unclear, ["unit 12 is fine"])
})

Deno.test("snooze fri on a Friday means next week", () => {
  const parsed = parseDecisionReply(
    "103 snooze fri",
    three,
    friday,
    tz,
  )
  assertEquals(parsed.intents, [
    { displayId: 103, action: "snooze", snoozeUntil: "2026-10-23" },
  ])
})

Deno.test("cancel is not skip and is not an opt-out", () => {
  const parsed = parseDecisionReply("103 cancel", three, now, tz)
  assertEquals(parsed.intents, [])
  assertEquals(parsed.unclear, ["103 cancel"])
})

Deno.test("duplicate ids: the last instruction wins", () => {
  const parsed = parseDecisionReply("101 yes, 101 snooze tomorrow", three, now, tz)
  assertEquals(parsed.intents, [
    { displayId: 101, action: "snooze", snoozeUntil: "2026-10-12" },
  ])
})

Deno.test("snooze with no date uses 48h for reactive and 7 days for proactive", () => {
  const reactive = parseDecisionReply("101 snooze", three, now, tz)
  assertEquals(reactive.intents[0]?.snoozeUntil, "2026-10-13")
  const proactive = parseDecisionReply("104 snooze", three, now, tz)
  assertEquals(proactive.intents[0]?.snoozeUntil, "2026-10-18")
})

Deno.test("a past calendar date is unclear", () => {
  const parsed = parseDecisionReply("101 snooze 10/1", three, now, tz)
  assertEquals(parsed.intents, [])
  assertEquals(parsed.unclear, ["101 snooze 10/1"])
})

Deno.test("LLM proposals below 0.8, unknown ids, and skip on reactive are dropped", () => {
  const accepted = filterLlmDecisionProposals(
    [
      { display_id: 101, action: "yes", confidence: 0.9 },
      { display_id: 104, action: "skip", confidence: 0.95 },
      { display_id: 103, action: "skip", confidence: 0.99 },
      { display_id: 999, action: "yes", confidence: 0.99 },
      { display_id: 101, action: "self", confidence: 0.5 },
    ],
    three,
  )
  assertEquals(accepted, [
    { displayId: 101, action: "yes" },
    { displayId: 104, action: "skip" },
  ])
})
