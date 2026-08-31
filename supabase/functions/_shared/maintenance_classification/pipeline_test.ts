/// <reference lib="deno.ns" />

import { classifyMaintenanceRequest } from "./pipeline.ts"
import { sanitizeDescriptionDeterministic } from "./sanitizer.ts"
import { inferTradeFromText } from "./deterministicRules.ts"
import { buildClarificationPrompt } from "./clarification.ts"
import { extractEntities } from "./entities.ts"
import { matchDeterministicRules } from "./deterministicRules.ts"
import { matchingTradeForVendorSearch } from "../../../../shared/maintenance/vendorTrades.ts"

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
  assertEqual(r.confidenceBand, "high", "clear trade + urgency")
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
  assertEqual(r.confidenceBand, "low", "band")
  assertTrue(Boolean(r.clarification?.question), "has question")
  assertTrue(!/weird problem/i.test(r.clarification?.question ?? ""), "no mirroring")
})

Deno.test("something is broken → low confidence, no guessed trade", async () => {
  const r = await classify("Something is broken")
  assertTrue(r.clarificationRequired, "needs clarification")
  assertEqual(r.confidenceBand, "low", "band")
  assertEqual(r.vendorTrade, "other", "do not guess")
  assertTrue(r.classificationConfidence < 0.65, "low confidence")
})

Deno.test("please help / send someone → low confidence", async () => {
  for (const text of ["Please help", "Can you send someone", "The apartment has a problem"]) {
    const r = await classify(text)
    assertEqual(r.confidenceBand, "low", text)
    assertEqual(r.clarificationRequired, true, `${text} clarify`)
    assertEqual(r.vendorTrade, "other", `${text} no trade`)
  }
})

Deno.test("water pouring through ceiling → flood emergency, best-judgment plumbing", async () => {
  const r = await classify("Water is pouring through the ceiling")
  assertEqual(r.clarificationRequired, false, "medium — classify")
  assertTrue(r.emergencyType === "flood" || r.severity === "urgent" || r.severity === "critical", "urgent flood")
  assertTrue(r.vendorTrade === "plumbing" || r.vendorTrade === "roofing", `trade ${r.vendorTrade}`)
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

Deno.test("ceiling leak without rain or fixture → best-judgment plumbing, no clarification", async () => {
  const r = await classify("Water is leaking from my ceiling.")
  assertEqual(r.clarificationRequired, false, "medium — no clarify")
  assertEqual(r.vendorTrade, "plumbing", "best judgment")
  assertEqual(r.primaryCategory, "plumbing", "water family")
  assertEqual(r.confidenceBand, "medium", "band")
})

Deno.test("ceiling leak in rain → roofing", async () => {
  const r = await classify("There's water coming through the ceiling whenever it rains.")
  assertEqual(r.vendorTrade, "roofing", "trade")
  assertEqual(r.primaryCategory, "structural", "category")
  assertEqual(r.clarificationRequired, false, "confident")
})

Deno.test("named roof leak → roofing", async () => {
  const r = await classify("My roof is leaking.")
  assertEqual(r.vendorTrade, "roofing", "trade")
  assertEqual(r.clarificationRequired, false, "confident")
})

Deno.test("water by the furnace → best-judgment plumbing", async () => {
  const r = await classify("There's water by the furnace.")
  assertEqual(r.clarificationRequired, false, "medium")
  assertEqual(r.vendorTrade, "plumbing", "best judgment")
})

Deno.test("heat isn't working → best-judgment HVAC", async () => {
  const r = await classify("My heat isn't working.")
  assertEqual(r.clarificationRequired, false, "medium")
  assertEqual(r.primaryCategory, "hvac", "heat category")
  assertEqual(r.vendorTrade, "hvac", "best judgment")
})

Deno.test("cold radiator → plumbing trade, HVAC category", async () => {
  const r = await classify("The radiator is cold.")
  assertEqual(r.vendorTrade, "plumbing", "hydronic trade")
  assertEqual(r.primaryCategory, "hvac", "heat category")
  assertEqual(r.clarificationRequired, false, "confident")
})

Deno.test("crack up the wall → masonry", async () => {
  const r = await classify("There's a crack going up my wall.")
  assertEqual(r.vendorTrade, "masonry", "trade")
  assertEqual(r.primaryCategory, "structural", "category")
})

Deno.test("sagging ceiling → carpentry, not plumbing", async () => {
  const r = await classify("My ceiling is sagging.")
  assertEqual(r.vendorTrade, "carpentry", "trade")
  assertEqual(r.primaryCategory, "structural", "category")
})

Deno.test("mice in the wall → pest plus carpentry follow-up", async () => {
  const r = await classify("I hear mice inside the wall.")
  assertEqual(r.vendorTrade, "pest_control", "primary")
  assertEqual(r.secondaryTrade, "carpentry", "secondary")
})

Deno.test("bugs under dishwasher → pest plus plumbing follow-up", async () => {
  const r = await classify("There are bugs underneath my dishwasher.")
  assertEqual(r.vendorTrade, "pest_control", "primary")
  assertEqual(r.secondaryTrade, "plumbing", "secondary")
})

Deno.test("rain clarification answer resolves ceiling leak to roofing", async () => {
  const r = await classifyMaintenanceRequest({
    rawDescription: "Water is leaking from my ceiling.",
    clarificationAnswers: ["It happens whenever it rains"],
    skipLlm: true,
    skipEmbeddings: true,
  })
  assertEqual(r.vendorTrade, "roofing", "trade after rain answer")
  assertEqual(r.clarificationRequired, false, "resolved")
})

Deno.test("urgency policy bands on the classification pipeline", async () => {
  const faucet = await classify("Leaky faucet")
  assertEqual(faucet.urgencyBand, "medium", "faucet band")
  assertEqual(faucet.slaMinutes, 2880, "faucet 48h")

  const sparks = await classify("Outlet sparks")
  assertEqual(sparks.urgencyBand, "emergency", "sparks band")

  const heatUnknown = await classify("No heat in the apartment")
  assertEqual(heatUnknown.urgencyBand, "emergency", "no heat unknown temp")

  const heatWarm = await classifyMaintenanceRequest({
    rawDescription: "No heat in the apartment",
    outdoorTempF: 68,
    skipLlm: true,
    skipEmbeddings: true,
  })
  assertEqual(heatWarm.urgencyBand, "medium", "no heat above 55")

  const coolingHot = await classifyMaintenanceRequest({
    rawDescription: "AC not working",
    outdoorTempF: 92,
    skipLlm: true,
    skipEmbeddings: true,
  })
  assertEqual(coolingHot.urgencyBand, "emergency", "no cooling at 85+")

  const pest = await classify("I saw a mouse in the kitchen")
  assertEqual(pest.urgencyBand, "low", "single pest")
})

Deno.test("photo request policy on the classification pipeline", async () => {
  const faucet = await classify("Leaky faucet")
  assertEqual(faucet.photoRequested, false, "faucet skip photo")

  const sparks = await classify("Outlet sparks")
  assertEqual(sparks.photoRequested, false, "electrical skip photo")

  const heat = await classify("No heat in the apartment")
  assertEqual(heat.photoRequested, false, "hvac skip photo")

  const pest = await classify("I saw a mouse in the kitchen")
  assertEqual(pest.photoRequested, true, "pest asks photo")

  const fridge = await classify("Fridge not cold")
  assertEqual(fridge.photoRequested, true, "appliance asks photo")

  const sag = await classify("My ceiling is sagging.")
  assertEqual(sag.photoRequested, true, "structural asks photo")

  const flood = await classify("Water pouring through the ceiling")
  assertEqual(flood.photoRequested, true, "active water asks photo")
})

Deno.test("taxonomy phrases map to the expected trade without using Structural as a search term", async () => {
  const pressure = await classify("The water pressure is low in the kitchen")
  assertEqual(pressure.vendorTrade, "plumbing", "low pressure")
  assertEqual(pressure.primaryCategory, "plumbing", "pressure category")
  assertEqual(pressure.clarificationRequired, false, "pressure classified")

  const toilet = await classify("The toilet keeps running")
  assertEqual(toilet.vendorTrade, "plumbing", "running toilet")

  const airflow = await classify("There is no airflow from the vents")
  assertEqual(airflow.vendorTrade, "hvac", "no airflow")
  assertEqual(airflow.primaryCategory, "hvac", "airflow category")

  const temp = await classify("The temperature won't change")
  assertEqual(temp.vendorTrade, "hvac", "thermostat/temp")

  const wire = await classify("There is an exposed wire by the outlet")
  assertEqual(wire.vendorTrade, "electrical", "exposed wire")

  const smell = await classify("There is an electrical smell in the hallway")
  assertEqual(smell.vendorTrade, "electrical", "electrical smell")

  const washer = await classify("The washing machine will not start")
  assertEqual(washer.vendorTrade, "appliance_repair", "washing machine")
  assertEqual(washer.primaryCategory, "appliance", "appliance category")

  const hole = await classify("There is a hole in the wall")
  assertEqual(hole.vendorTrade, "carpentry", "hole in wall trade")
  assertEqual(hole.primaryCategory, "structural", "hole in wall category")

  const roach = await classify("I saw a cockroach in the kitchen")
  assertEqual(roach.vendorTrade, "pest_control", "cockroach")
  assertEqual(roach.primaryCategory, "pest", "pest category")

  const bites = await classify("There are bug bites on my arm")
  assertEqual(bites.vendorTrade, "pest_control", "bug bites")

  const ceiling = await classify("Water is leaking from my ceiling.")
  assertEqual(ceiling.vendorTrade, "plumbing", "ceiling water stays plumbing")
  assertEqual(ceiling.primaryCategory, "plumbing", "not structural category")
})

Deno.test("landlord envelope does not become matching or safety source of truth", async () => {
  const hole = await classify("There is a hole in my bedroom wall")
  assertEqual(hole.vendorTrade, "carpentry", "ops trade")
  assertEqual(hole.primaryCategory, "structural", "ops category")
  assertEqual(hole.landlordTriage.trade, "STRUCTURAL", "landlord category")
  assertEqual(matchingTradeForVendorSearch(hole.landlordTriage.trade), "general", "never search Structural")
  assertEqual(matchingTradeForVendorSearch(hole.vendorTrade), "carpentry", "search carpenter")
  assertTrue(hole.landlordTriage.summary.length <= 100, "summary cap")
  assertTrue(!/likely|keyword|classif/i.test(hole.landlordTriage.summary), "no jargon")

  const rain = await classify("There's water coming through the ceiling whenever it rains.")
  assertEqual(rain.vendorTrade, "roofing", "ops roofing")
  assertEqual(rain.landlordTriage.trade, "STRUCTURAL", "rain ceiling landlord bucket")
  assertEqual(matchingTradeForVendorSearch(rain.vendorTrade), "roofing", "search roofer")

  const stove = await classify("My gas stove won't ignite")
  assertEqual(stove.emergencyType, "none", "stove is not a gas leak")
  assertEqual(stove.landlordTriage.gas_suspected, false, "envelope follows emergencyType")

  const fridge = await classify("My refrigerator smells bad")
  assertEqual(fridge.landlordTriage.gas_suspected, false, "fridge smell")

  const gas = await classify("I smell gas")
  assertEqual(gas.emergencyType, "gas", "ops gas")
  assertEqual(gas.urgencyBand, "emergency", "ops urgency")
  assertEqual(gas.landlordTriage.gas_suspected, true, "envelope gas")
  assertEqual(gas.landlordTriage.urgency, "EMERGENCY", "envelope urgency")

  const eggs = await classify("It smells like rotten eggs")
  assertEqual(eggs.emergencyType, "gas", "rotten eggs uses existing gas policy")
  assertEqual(eggs.landlordTriage.gas_suspected, true, "envelope from emergencyType")

  const vague = await classify("Something is broken")
  assertEqual(vague.confidenceBand, "low", "ops low")
  assertEqual(vague.clarificationRequired, true, "ops clarify")
  assertEqual(vague.landlordTriage.confidence, "LOW", "envelope low")
  assertEqual(vague.landlordTriage.clarification_needed, true, "envelope clarify")
  assertTrue(Boolean(vague.landlordTriage.clarification_question?.includes("?")), "question")
  assertTrue(
    vague.landlordTriage.urgency === "MEDIUM" ||
      vague.landlordTriage.urgency === "LOW" ||
      vague.landlordTriage.urgency === "EMERGENCY",
    "urgency always present",
  )
  assertEqual(vague.vendorTrade, "other", "ops trade still other")
})
