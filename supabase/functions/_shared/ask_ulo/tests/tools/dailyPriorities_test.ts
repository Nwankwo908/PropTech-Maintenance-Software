/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "../../routing/detectIntent.ts"
import { detectQuestionSubject } from "../../routing/detectSubject.ts"
import { classifyAskUloReasoningMode } from "../../routing/reasoningMode.ts"
import { classifyResponseFormat } from "../../routing/dynamicResponse.ts"
import { isDailyPrioritiesQuestion } from "../../tools/ops/dailyPrioritiesDetect.ts"
import {
  buildDailyPrioritiesResult,
  filterDailyPriorityCandidates,
  dailyPrioritySelectionMessage,
  formatDailyPrioritiesList,
  instantIsOnLocalDay,
  localDayBoundsUtc,
  rankDailyPriorityCandidates,
  resolveDailyPriorityReplyToken,
  type DailyPriorityCandidate,
} from "../../tools/ops/dailyPriorities.ts"
import { isPortfolioWorkPrioritizationQuestion } from "../../tools/maintenance/workOrderPresentation.ts"
import { vendorTradeMatchesForDispatch } from "../../../vendor_trades.ts"

const DAILY_PROMPTS = [
  "What should I prioritize today?",
  "What should I do today?",
  "What's urgent?",
  "Anything I need to handle?",
  "What should I focus on today?",
  "What needs my attention?",
  "Rank today's priorities.",
]

Deno.test("daily priority prompts route to executive_briefing + portfolio (SMS+chat contract)", () => {
  for (const q of DAILY_PROMPTS) {
    assertEquals(isDailyPrioritiesQuestion(q), true, q)
    assertEquals(isPortfolioWorkPrioritizationQuestion(q), false, q)
    assertEquals(detectQuestionSubject(q), "portfolio", q)
    assertEquals(classifyAskUloReasoningMode(q).mode, "executive_briefing", q)
    assertEquals(classifyAskUloIntent(q).intent, "executive_briefing", q)
    assertEquals(classifyResponseFormat(q), "executive_briefing", q)
  }
})

Deno.test("narrow scoped / entity questions stay off daily priorities", () => {
  assertEquals(
    isDailyPrioritiesQuestion("What's the status of work order WO-0102?"),
    false,
  )
  assertEquals(
    isDailyPrioritiesQuestion("Which property needs my attention first?"),
    false,
  )
  assertEquals(
    isDailyPrioritiesQuestion("What should I worry about over the next 30 days?"),
    false,
  )
})

function candidate(
  partial: Partial<DailyPriorityCandidate> &
    Pick<DailyPriorityCandidate, "dedupeKey" | "category" | "entityId" | "title">,
): DailyPriorityCandidate {
  return {
    entityType: "maintenance_request",
    propertyLabel: null,
    unitLabel: null,
    instantAt: null,
    blocker: null,
    addressKnown: true,
    canAssign: false,
    ...partial,
  }
}

Deno.test("mixed account ranks emergency → deadline → approval → visit; dedupes same job", () => {
  const floodId = "t-flood"
  const rows = [
    candidate({
      dedupeKey: `ticket:${floodId}`,
      category: "emergency",
      entityId: floodId,
      title: "Flooding",
      propertyLabel: "45 Oak Ave",
      unitLabel: "3",
      blocker: "Vendor needed",
      canAssign: true,
      urgencyRank: 0,
    }),
    // Duplicate same flood under approval category must not occupy two slots.
    candidate({
      dedupeKey: `ticket:${floodId}`,
      category: "approval",
      entityId: floodId,
      title: "Flooding",
      propertyLabel: "45 Oak Ave",
      unitLabel: "3",
      blocker: "Needs approval",
      landlordOnly: true,
      urgencyRank: 15,
    }),
    candidate({
      dedupeKey: "inspection:insp-1",
      category: "deadline",
      entityType: "inspection",
      entityId: "insp-1",
      title: "Inspection repairs",
      propertyLabel: "123 Main St",
      instantAt: "2026-10-24T17:00:00.000Z",
      blocker: "Due Fri — financial risk if missed",
      landlordOnly: true,
      urgencyRank: 8,
    }),
    candidate({
      dedupeKey: "ticket:t-sink",
      category: "approval",
      entityType: "estimate",
      entityId: "t-sink",
      displayId: 102,
      title: "Sink leak",
      blocker: "Needs approval",
      landlordOnly: true,
      urgencyRank: 15,
    }),
    candidate({
      dedupeKey: "ticket:t-visit",
      category: "visit_today",
      entityType: "appointment",
      entityId: "t-visit",
      title: "HVAC service",
      propertyLabel: "9 Pine",
      instantAt: "2026-10-21T18:00:00.000Z",
      blocker: "Visit scheduled today",
      urgencyRank: 20,
    }),
  ]
  const items = rankDailyPriorityCandidates(rows)
  assertEquals(items.length, 4)
  assertEquals(items[0]?.title, "Flooding")
  assertEquals(items[0]?.category, "emergency")
  assertEquals(items[1]?.category, "deadline")
  assertEquals(items[2]?.category, "approval")
  assertEquals(items[2]?.displayId, 102)
  assertEquals(items[3]?.category, "visit_today")
  // Flood appears once.
  assertEquals(items.filter((i) => i.entityId === floodId).length, 1)

  const { smsText } = formatDailyPrioritiesList(items)
  assertMatch(smsText, /^Today's priorities:/)
  assertMatch(smsText, /1\. Flooding/)
  assertMatch(smsText, /Reply 102 YES/)
  assertMatch(smsText, /not approved until you reply APPROVE or DECLINE/)
  assertMatch(items[0]?.replyInstruction ?? "", /not assigned until you confirm/)
  assertEquals(/Reply 1 to assign/.test(smsText), false)
})

Deno.test("priority selection names the chosen job and does not claim the work is done", () => {
  const flood = {
    title: "Flooding",
    displayId: 88011,
    offeredAction: "assign" as const,
  }
  const sink = {
    title: "Sink leak",
    displayId: 102,
    offeredAction: "approve" as const,
  }
  const floodMsg = dailyPrioritySelectionMessage(flood)
  const sinkMsg = dailyPrioritySelectionMessage(sink)
  assertMatch(floodMsg, /I selected Flooding/)
  assertMatch(floodMsg, /A vendor is not assigned/)
  assertEquals(/Sink leak/.test(floodMsg), false)
  assertEquals(/approved/.test(floodMsg), false)
  assertMatch(sinkMsg, /I selected Sink leak \(request 102\)/)
  assertMatch(sinkMsg, /The estimate is not approved/)
  assertMatch(sinkMsg, /Reply APPROVE/)
  assertMatch(sinkMsg, /DECLINE/)
  assertEquals(/Flooding/.test(sinkMsg), false)
  assertMatch(dailyPrioritySelectionMessage(sink, true), /I already selected Sink leak/)
  assertMatch(dailyPrioritySelectionMessage(sink, true), /Nothing was assigned or approved/)
  assertEquals(/completed/i.test(dailyPrioritySelectionMessage(flood, true)), false)
})

Deno.test("empty actionable set discloses clearly; partial retrieval discloses incompleteness", () => {
  const empty = buildDailyPrioritiesResult({
    role: "landlord",
    candidates: [],
  })
  assertEquals(empty.emptyReason, "no_actionable")
  assertMatch(empty.smsText, /Nothing actionable/i)

  const partial = buildDailyPrioritiesResult({
    role: "landlord",
    candidates: [],
    available: false,
    partialSources: ["maintenance_requests"],
  })
  assertMatch(partial.smsText, /unavailable|incomplete/i)
})

Deno.test("tenant auth filter: only own requests; no landlord approvals in tool results", () => {
  const candidates = [
    candidate({
      dedupeKey: "a",
      category: "emergency",
      entityId: "mine",
      title: "My leak",
      residentId: "res-1",
    }),
    candidate({
      dedupeKey: "b",
      category: "emergency",
      entityId: "theirs",
      title: "Other leak",
      residentId: "res-2",
    }),
    candidate({
      dedupeKey: "c",
      category: "approval",
      entityId: "est-1",
      title: "Needs approval",
      landlordOnly: true,
      residentId: "res-1",
    }),
  ]
  const scoped = filterDailyPriorityCandidates({
    role: "tenant",
    residentId: "res-1",
    candidates,
  })
  assertEquals(scoped.map((c) => c.entityId), ["mine"])

  const unresolved = filterDailyPriorityCandidates({
    role: "unresolved",
    candidates,
  })
  assertEquals(unresolved.length, 0)

  const otherTenant = buildDailyPrioritiesResult({
    role: "tenant",
    residentId: "res-2",
    candidates,
  })
  assertEquals(otherTenant.items.every((i) => i.entityId !== "mine"), true)
  assertEquals(otherTenant.items.every((i) => i.category !== "approval"), true)
})

Deno.test("reply tokens bind to original list positions — not re-ranked globals", () => {
  const items = rankDailyPriorityCandidates([
    candidate({
      dedupeKey: "1",
      category: "emergency",
      entityId: "e1",
      title: "Flooding",
      canAssign: true,
      urgencyRank: 0,
    }),
    candidate({
      dedupeKey: "2",
      category: "approval",
      entityType: "estimate",
      entityId: "e2",
      displayId: 102,
      title: "Sink leak",
      landlordOnly: true,
    }),
  ])
  const one = resolveDailyPriorityReplyToken("1", items)
  assertEquals(one.ok, true)
  if (one.ok) assertEquals(one.item.entityId, "e1")

  const approve = resolveDailyPriorityReplyToken("102 YES", items)
  assertEquals(approve.ok, true)
  if (approve.ok) assertEquals(approve.item.entityId, "e2")

  // Bare display id without YES is not a global ticket approve.
  const bare102 = resolveDailyPriorityReplyToken("102", items)
  assertEquals(bare102.ok, false)
})

Deno.test("requester timezone: same instant → same local-day membership across server TZs", () => {
  // 2026-03-08 05:30 UTC — still March 7 evening in LA, March 8 morning in NY/Tokyo.
  const instant = "2026-03-08T05:30:00.000Z"
  const now = new Date("2026-03-08T12:00:00.000Z")

  const zones = [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Tokyo",
  ] as const

  for (const zone of zones) {
    const { localDate } = localDayBoundsUtc(now, zone)
    assertEquals(typeof localDate, "string")
    // Deterministic for a fixed now+zone.
    assertEquals(localDayBoundsUtc(now, zone).localDate, localDate)
  }

  // Fixed visit instant: 2026-10-21 15:00 UTC.
  // NY (EDT, UTC-4) → Oct 21 11:00; LA (PDT, UTC-7) → Oct 21 08:00;
  // Tokyo (UTC+9) → Oct 22 00:00 — not on Oct 21 local when "now" is still Oct 21 UTC morning.
  const visit = "2026-10-21T15:00:00.000Z"
  const morningUtc = new Date("2026-10-21T10:00:00.000Z")
  assertEquals(instantIsOnLocalDay(visit, morningUtc, "America/New_York"), true)
  assertEquals(instantIsOnLocalDay(visit, morningUtc, "America/Los_Angeles"), true)
  assertEquals(instantIsOnLocalDay(visit, morningUtc, "UTC"), true)
  assertEquals(instantIsOnLocalDay(visit, morningUtc, "Asia/Tokyo"), false)

  // Same visit + Tokyo "now" on Oct 22 local → membership flips with requester TZ.
  const tokyoAfternoon = new Date("2026-10-21T18:00:00.000Z") // Oct 22 03:00 Tokyo
  assertEquals(instantIsOnLocalDay(visit, tokyoAfternoon, "Asia/Tokyo"), true)

  // Midnight DST spring-forward day in NY: local day still 24h wall span.
  const dstNow = new Date("2026-03-08T17:00:00.000Z")
  const bounds = localDayBoundsUtc(dstNow, "America/New_York")
  assertEquals(bounds.end.getTime() - bounds.start.getTime(), 24 * 3600_000)
})

Deno.test("pest assign gate preserved: generalists never match pest jobs", () => {
  assertEquals(vendorTradeMatchesForDispatch("general", "pest_control"), false)
  assertEquals(vendorTradeMatchesForDispatch("handyman", "pest"), false)
  assertEquals(vendorTradeMatchesForDispatch("pest_control", "pest"), true)

  const pest = rankDailyPriorityCandidates([
    candidate({
      dedupeKey: "pest",
      category: "emergency",
      entityId: "p1",
      title: "Roaches",
      issueCategory: "pest_control",
      addressKnown: true,
      // Lookup must leave canAssign false for pest without specialist.
      canAssign: false,
    }),
  ])
  assertEquals(pest[0]?.offeredAction, "none")
})

Deno.test("unknown-address emergency offers confirm_location — not assign", () => {
  const items = rankDailyPriorityCandidates([
    candidate({
      dedupeKey: "flood",
      category: "emergency",
      entityId: "f1",
      title: "Flooding",
      addressKnown: false,
      canAssign: true,
      blocker: "Address unknown",
    }),
  ])
  assertEquals(items[0]?.offeredAction, "confirm_location")
  assertMatch(items[0]?.replyInstruction ?? "", /address still has to be confirmed before a vendor is booked/i)
  assertEquals(/to assign/i.test(items[0]?.replyInstruction ?? ""), false)
})
