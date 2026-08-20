/// <reference lib="deno.ns" />

import { classifyMaintenanceRequest } from "./pipeline.ts"
import { sanitizeDescriptionDeterministic } from "./sanitizer.ts"
import { inferTradeFromText } from "./deterministicRules.ts"
import { buildClarificationPrompt } from "./clarification.ts"
import { extractEntities } from "./entities.ts"
import { matchDeterministicRules } from "./deterministicRules.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(label)
}

async function classify(text: string) {
  return classifyMaintenanceRequest({
    rawDescription: text,
    skipLlm: true,
    skipEmbeddings: true,
  })
}

Deno.test("sanitizer expands slang without inventing facts", () => {
  const out = sanitizeDescriptionDeterministic("sink been drippin bad since lst nite")
  assertTrue(/drip/i.test(out), "expands drippin")
  assertTrue(/last/i.test(out), "expands lst")
  assertTrue(/night/i.test(out), "expands nite")
  assertTrue(!/kitchen/i.test(out), "does not invent kitchen")
})

Deno.test("leaky faucet → plumbing", async () => {
  const r = await classify("Leaky faucet")
  assertEqual(r.vendorTrade, "plumbing", "trade")
  assertTrue(r.classificationConfidence >= 0.65, "confidence")
  assertEqual(r.clarificationRequired, false, "no clarification")
})

Deno.test("tap keeps dripping → plumbing", async () => {
  const r = await classify("Tap keeps dripping")
  assertEqual(r.vendorTrade, "plumbing", "trade")
})

Deno.test("water under kitchen sink → plumbing", async () => {
  const r = await classify("Water under kitchen sink")
  assertEqual(r.vendorTrade, "plumbing", "trade")
  assertEqual(r.entities.location, "kitchen", "location")
})

Deno.test("toilet overflowing → plumbing urgent", async () => {
  const r = await classify("Toilet overflowing")
  assertEqual(r.vendorTrade, "plumbing", "trade")
  assertTrue(
    r.severity === "urgent" || r.severity === "critical" || r.issueType === "leak",
    "elevated severity or leak type",
  )
})

Deno.test("outlet sparks → electrical urgent/critical", async () => {
  const r = await classify("Outlet sparks")
  assertEqual(r.vendorTrade, "electrical", "trade")
  assertTrue(
    r.severity === "urgent" || r.severity === "critical",
    "urgent or critical",
  )
})

Deno.test("fridge not cold → appliance repair", async () => {
  const r = await classify("Fridge not cold")
  assertEqual(r.vendorTrade, "appliance_repair", "trade")
})

Deno.test("mouse behind stove → pest_control not appliance", async () => {
  const r = await classify(
    "Today I saw a mouse come out from behind the stove and run across my kitchen counter.",
  )
  assertEqual(r.vendorTrade, "pest_control", "trade")
})

Deno.test("front steps metal piece + injury → carpentry urgent", async () => {
  const r = await classify(
    "Wanted to bring to your attention the steps leading to the front entrance. The metal piece is broken and almost hurt my daughter while she was climbing the stairs. It moves and the edge caught onto her sandal.",
  )
  assertEqual(r.vendorTrade, "carpentry", "trade")
  assertTrue(
    r.severity === "urgent" || r.severity === "critical",
    "injury elevates severity",
  )
  assertTrue(
    r.entities.safetyRisks.some((s) => /injury/i.test(s)),
    "injury risk entity",
  )
})

Deno.test("cracked concrete steps → concrete", async () => {
  const r = await classify("The concrete front steps are cracked and crumbling.")
  assertEqual(r.vendorTrade, "concrete", "trade")
})

Deno.test("loose deck board → deck_builder", async () => {
  const r = await classify("A deck board is loose and unsafe near the railing.")
  assertEqual(r.vendorTrade, "deck_builder", "trade")
})

Deno.test("brick step mortar → masonry", async () => {
  const r = await classify("The brick step mortar is crumbling at the entrance.")
  assertEqual(r.vendorTrade, "masonry", "trade")
})

Deno.test("handyman request → general", async () => {
  const r = await classify("Need a handyman for general maintenance around the unit.")
  assertEqual(r.vendorTrade, "general", "trade")
})

Deno.test("AC blowing warm air → HVAC", async () => {
  const r = await classify("AC blowing warm air")
  assertEqual(r.vendorTrade, "hvac", "trade")
})

Deno.test("locked out → locksmith", async () => {
  const r = await classify("Locked out")
  assertEqual(r.vendorTrade, "locksmith", "trade")
})

Deno.test("vague weird problem → clarification", async () => {
  const r = await classify("There is a weird problem in my room")
  assertTrue(r.clarificationRequired, "needs clarification")
  assertTrue(Boolean(r.clarification?.question), "has question")
  assertTrue(!/weird problem/i.test(r.clarification?.question ?? ""), "no mirroring")
})

Deno.test("something is broken → clarification", async () => {
  const r = await classify("Something is broken")
  assertTrue(r.clarificationRequired, "needs clarification")
  assertTrue(r.classificationConfidence < 0.65, "low confidence")
})

Deno.test("water pouring through ceiling → plumbing or roofing with high signal", async () => {
  const r = await classify("Water is pouring through the ceiling")
  assertTrue(
    r.vendorTrade === "plumbing" || r.vendorTrade === "roofing",
    `trade was ${r.vendorTrade}`,
  )
  assertTrue(
    r.severity === "urgent" || r.severity === "critical" || r.entities.activeDamage,
    "elevated urgency or damage",
  )
})

Deno.test("gas smell → emergency safety override", async () => {
  const r = await classify("I smell gas")
  assertEqual(r.emergencyType, "gas", "emergency")
  assertTrue(r.severity === "critical" || r.severity === "urgent", "critical/urgent")
})

Deno.test("Other postcheck rescues leaky faucet phrasing", async () => {
  const r = await classify("my leaky faucet will not stop")
  assertEqual(r.vendorTrade, "plumbing", "not other")
  assertTrue(!r.otherPostcheckPassed || r.vendorTrade !== "other", "other not accepted")
})

Deno.test("SMS/web parity: identical text → identical trade", async () => {
  const a = await classify("leaky faucet in the kitchen")
  const b = await classify("leaky faucet in the kitchen")
  assertEqual(a.vendorTrade, b.vendorTrade, "trade parity")
  assertEqual(a.issueType, b.issueType, "issue parity")
  assertEqual(a.severity, b.severity, "severity parity")
})

Deno.test("inferTradeFromText covers faucet/leak synonyms", () => {
  assertEqual(inferTradeFromText("leaky faucet"), "plumbing", "leaky faucet")
  assertEqual(inferTradeFromText("tap dripping"), "plumbing", "tap")
  assertEqual(inferTradeFromText("outlet sparking"), "electrical", "spark")
})

Deno.test("clarification for vague text does not assume water", () => {
  const entities = extractEntities("Something is broken")
  const prompt = buildClarificationPrompt({
    entities,
    ruleHits: matchDeterministicRules("Something is broken"),
    semanticMatches: [],
    confidence: 0.3,
    textHint: "Something is broken",
  })
  assertTrue(Boolean(prompt), "prompt exists")
  assertTrue(
    !/water coming from a sink/i.test(prompt?.question ?? ""),
    "does not ask water source for non-water vagueness",
  )
})

Deno.test("typo slang path still classifies plumbing", async () => {
  const r = await classify("sink been drippin bad since lst nite")
  assertEqual(r.vendorTrade, "plumbing", "trade after sanitize")
})

Deno.test("smsContext does not change fuse-confidence trade for a leaky faucet", async () => {
  const r = await classifyMaintenanceRequest({
    rawDescription: "Leaky faucet",
    skipLlm: true,
    skipEmbeddings: true,
    smsContext: {
      pendingStep: "urgency",
      pendingQuestion: "Is this an emergency?",
    },
  })
  assertEqual(r.vendorTrade, "plumbing", "trade")
})
