import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import { buildConfirmationSummary } from "./residentIntakeTypes.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertMatch(actual: string, re: RegExp, label: string) {
  if (!re.test(actual)) {
    throw new Error(`${label}: ${JSON.stringify(actual)} did not match ${re}`)
  }
}

Deno.test("clogged sink asks overflow, not urgency or when-noticed", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    preferred_contact_method: "text",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "plumbing_overflow", "type")
  assertMatch(next.question, /overflowing or leaking/i, "overflow copy")
  assertEqual(/emergency|priority|first notice/i.test(next.question), false, "no questionnaire")
})

Deno.test("clogged sink with no overflow then asks which room before photo", () => {
  const afterNo = applyDiagnosticAnswer({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    diagnostic_question_type: "plumbing_overflow",
    preferred_contact_method: "text",
  }, "No")
  const planned = applyQuestionPlan(afterNo)
  // Naming "sink" is not a location — ask room before photo.
  assertEqual(planned.diagnostic_question_type, "room_or_area", "room next")
  assertMatch(planned.diagnostic_question ?? "", /which room/i, "asks room")
  assertEqual(planned.step === "photo", false, "not photo yet")
})

Deno.test("clogged sink with room known then asks for a drain photo", () => {
  const afterNo = applyDiagnosticAnswer({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    room_or_area: "kitchen",
    diagnostic_question_type: "plumbing_overflow",
    preferred_contact_method: "text",
    asked_question_types: ["plumbing_overflow", "room_or_area"],
  }, "No")
  const planned = applyQuestionPlan(afterNo)
  assertEqual(planned.step, "photo", "photo next")
  assertMatch(planned.diagnostic_question ?? "", /photo of the sink/i, "contextual photo")
  assertEqual(planned.urgency === "emergency", false, "ulo sets urgency")
  assertEqual(planned.preferred_contact_method, "text", "sms default")
})

Deno.test("faucet drip without a room asks which room, not photo first", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My faucet is dripping",
    description: "My faucet is dripping",
    preferred_contact_method: "text",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "room_or_area", "type")
  assertMatch(next.question, /which room/i, "room copy")
  assertEqual(/photo/i.test(next.question), false, "not photo")
})

Deno.test("kitchen faucet already has a room so skips the room ask", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "Kitchen faucet is dripping",
    description: "Kitchen faucet is dripping",
    preferred_contact_method: "text",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType === "room_or_area", false, "room already known")
})

Deno.test("active leak asks if water is still flowing", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "leak",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "Water is pouring from under my sink.",
    description: "Water is pouring from under my sink.",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "plumbing_active_flow", "type")
  assertMatch(next.question, /still actively flowing/i, "flow")
  assertMatch(next.question, /shutoff/i, "shutoff")
})

Deno.test("vague sink flooded asks flow/shutoff before photo or emergency", () => {
  const planned = applyQuestionPlan({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My sink is flooded",
    description: "My sink is flooded",
    classification_confidence: 0.9,
    confidence_band: "high",
  })
  assertEqual(planned.diagnostic_question_type, "plumbing_active_flow", "triage first")
  assertMatch(planned.diagnostic_question ?? "", /still actively flowing/i, "flow")
  assertMatch(planned.diagnostic_question ?? "", /shutoff/i, "shutoff")
  assertEqual(planned.step === "photo", false, "not photo yet")
})

Deno.test("no hot water asks whole-home vs one fixture", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "I have no hot water.",
    description: "I have no hot water.",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "plumbing_hot_water_scope", "type")
})

Deno.test("HVAC asks diagnostic behavior and not for a photo first", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "My AC isn't working.",
    description: "My AC isn't working.",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "hvac_behavior", "type")
  assertEqual(next.step === "photo", false, "not photo")
})

Deno.test("bathroom sink leak asks for a photo after follow-ups", () => {
  const planned = applyQuestionPlan({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    room_or_area: "bathroom",
    preferred_contact_method: "text",
    initial_message:
      "Hello. My bathroom sink is leaking bad. The wood of the bottom drawer of the vanity has soaked and broke. I have turned off the valves.",
    description:
      "Hello. My bathroom sink is leaking bad. The wood of the bottom drawer of the vanity has soaked and broke. I have turned off the valves.",
    asked_question_types: ["plumbing_active_flow"],
    diagnostic_facts: { plumbing_active_flow: "No, I turned off the valves" },
  })
  assertEqual(planned.step, "photo", "photo next")
  assertMatch(planned.diagnostic_question ?? "", /photo/i, "asks for a photo")
})

Deno.test("bedroom outlets ask whether power is out elsewhere", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "The outlets in my bedroom stopped working.",
    description: "The outlets in my bedroom stopped working.",
    room_or_area: "bedroom",
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "electrical_scope", "type")
})

Deno.test("structural crack/sag asks risk; ceiling pests and fans do not", () => {
  const crack = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "There's a crack in my bedroom wall.",
    description: "There's a crack in my bedroom wall.",
    room_or_area: "bedroom",
  })
  assertEqual(crack.shouldAsk, true, "crack asks")
  if (crack.shouldAsk) assertEqual(crack.questionType, "structural_risk", "crack type")

  const sag = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My living room ceiling is sagging.",
    description: "My living room ceiling is sagging.",
    room_or_area: "living room",
  })
  assertEqual(sag.shouldAsk, true, "sag asks")
  if (sag.shouldAsk) assertEqual(sag.questionType, "structural_risk", "sag type")

  const pestsOnCeiling = determineNextMaintenanceQuestion({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "There are roaches on the ceiling.",
    description: "There are roaches on the ceiling.",
    asked_question_types: ["pest_frequency", "pest_location"],
    room_or_area: "bedroom",
  })
  assertEqual(
    pestsOnCeiling.shouldAsk && pestsOnCeiling.questionType === "structural_risk",
    false,
    "no crack question for ceiling pests",
  )

  const ceilingFan = determineNextMaintenanceQuestion({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "My ceiling fan stopped working.",
    description: "My ceiling fan stopped working.",
    room_or_area: "bedroom",
  })
  assertEqual(
    ceilingFan.shouldAsk && ceilingFan.questionType === "structural_risk",
    false,
    "no crack question for ceiling fan",
  )

  const carpentryNoDamage = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "The cabinet door in the kitchen won't close.",
    description: "The cabinet door in the kitchen won't close.",
    room_or_area: "kitchen",
  })
  assertEqual(
    carpentryNoDamage.shouldAsk && carpentryNoDamage.questionType === "structural_risk",
    false,
    "carpentry without a crack does not ask structural risk",
  )
})

Deno.test("pest asks frequency, lock asks if the home is secure", () => {
  const pest = determineNextMaintenanceQuestion({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "I saw roaches.",
    description: "I saw roaches.",
  })
  assertEqual(pest.shouldAsk, true, "pest asks")
  if (pest.shouldAsk) assertEqual(pest.questionType, "pest_frequency", "frequency")

  const lock = determineNextMaintenanceQuestion({
    issue_type: "lock",
    vendor_trade: "locksmith",
    primary_category: "general",
    initial_message: "My front door won't lock.",
    description: "My front door won't lock.",
  })
  assertEqual(lock.shouldAsk, true, "lock asks")
  if (lock.shouldAsk) assertEqual(lock.questionType, "lock_secure", "secure")
})

Deno.test("vague door complaint asks what broke before room", () => {
  const first = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My door broke.",
    description: "My door broke.",
  })
  assertEqual(first.shouldAsk, true, "asks")
  if (!first.shouldAsk) return
  assertEqual(first.questionType, "door_part", "part first")
  assertMatch(
    first.question,
    /door itself, the frame, hinges, handle, or lock/i,
    "part copy",
  )

  const afterLock = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My door broke.",
    description: "My door broke.",
    diagnostic_question_type: "door_part",
  }, "The lock"))
  assertEqual(afterLock.diagnostic_question_type, "lock_secure", "lock then security")
  assertMatch(afterLock.diagnostic_question ?? "", /secure the home/i, "security copy")
  assertEqual(afterLock.issue_type, "lock", "routes lock")

  const afterHinge = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My door broke.",
    description: "My door broke.",
    diagnostic_question_type: "door_part",
  }, "The hinges"))
  assertEqual(afterHinge.diagnostic_question_type, "door_safety", "hinge then safety")
  assertMatch(afterHinge.diagnostic_question ?? "", /stuck, hanging loose, or could it fall/i, "safety copy")

  const afterSafety = applyQuestionPlan(applyDiagnosticAnswer({
    ...afterHinge,
    diagnostic_question_type: "door_safety",
  }, "It's hanging loose"))
  assertEqual(afterSafety.diagnostic_question_type, "room_or_area", "then room")

  const namedLock = determineNextMaintenanceQuestion({
    issue_type: "lock",
    vendor_trade: "locksmith",
    primary_category: "general",
    initial_message: "The lock on my door is broken.",
    description: "The lock on my door is broken.",
  })
  assertEqual(namedLock.shouldAsk, true, "named lock asks")
  if (namedLock.shouldAsk) assertEqual(namedLock.questionType, "lock_secure", "skip part")
})

Deno.test("two issues in one SMS still ask door part, not only a shared room", () => {
  const pending = [
    {
      summary: "My door broke",
      description: "My door broke.",
      vendor_trade: "carpentry",
      issue_type: "general",
    },
    {
      summary: "I saw roaches",
      description: "I saw roaches.",
      vendor_trade: "pest_control",
      issue_type: "pest",
    },
  ]
  const first = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My door broke. Also I saw roaches.",
    description: "My door broke. Also I saw roaches.",
    pending_issues: pending,
  })
  assertEqual(first.shouldAsk, true, "asks")
  if (!first.shouldAsk) return
  assertEqual(
    first.questionType === "pest_frequency" || first.questionType === "door_part",
    true,
    "pest or door first",
  )

  const afterPest = determineNextMaintenanceQuestion({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "My door broke. Also I saw roaches.",
    description: "My door broke. Also I saw roaches.",
    pending_issues: pending,
    asked_question_types: ["pest_frequency", "pest_location"],
    diagnostic_facts: { pest_frequency: "repeatedly", pest_location: "kitchen" },
    room_or_area: "kitchen",
  })
  assertEqual(afterPest.shouldAsk, true, "continues")
  if (!afterPest.shouldAsk) return
  assertEqual(afterPest.questionType, "door_part", "door part after pest")
  assertMatch(afterPest.question, /door itself, the frame, hinges, handle, or lock/i, "door copy")

  const afterPart = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "general",
    vendor_trade: "carpentry",
    primary_category: "carpentry",
    initial_message: "My door broke. Also I saw roaches.",
    description: "My door broke. Also I saw roaches.",
    pending_issues: pending,
    asked_question_types: ["pest_frequency", "pest_location"],
    diagnostic_facts: { pest_frequency: "repeatedly", pest_location: "kitchen" },
    room_or_area: "kitchen",
    diagnostic_question_type: "door_part",
  }, "The lock"))
  assertEqual(afterPart.diagnostic_question_type, "lock_secure", "then security")
})

Deno.test("appliance leak follow-up switches into water-damage safety copy", () => {
  const after = applyDiagnosticAnswer({
    issue_type: "appliance",
    vendor_trade: "appliance_repair",
    primary_category: "appliance",
    initial_message: "My dishwasher stopped working.",
    description: "My dishwasher stopped working.",
    diagnostic_question_type: "appliance_symptom",
  }, "Water pours onto the floor.")
  assertMatch(after.safety_concerns ?? "", /leak/i, "leak fact")
  const planned = applyQuestionPlan(after)
  assertEqual(
    planned.step === "diagnostic" ||
      planned.step === "room_or_area" ||
      planned.step === "photo" ||
      planned.step === "awaiting_confirm",
    true,
    "continues",
  )
})

Deno.test("confirmation is tenant-facing and omits priority chips", () => {
  const sms = buildConfirmationSummary({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    safety_concerns: "Water is not actively overflowing",
    photo_urls: ["https://example.com/p.jpg"],
    urgency: "urgent",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /Got it\. Here's the request:/i, "header")
  assertMatch(sms, /clogged/i, "headline")
  assertMatch(sms, /[“"].+[”"]/u, "quoted headline")
  assertMatch(sms, /Water is not actively overflowing/i, "fact")
  assertMatch(sms, /Photo attached/i, "photo")
  assertMatch(sms, /Until help arrives/i, "handling tip")
  assertMatch(sms, /flushing|drain cleaner|fixture/i, "plumbing tip")
  assertEqual(/Priority:/i.test(sms), false, "no priority")
  assertEqual(/Updates via/i.test(sms), false, "no channel ask")
  assertMatch(sms, /Reply YES to submit, or reply with any changes/i, "cta")
  assertEqual(/\bJust to confirm\b/i.test(sms), false, "no old header")
  assertEqual(/tell me what needs to be changed/i.test(sms), false, "no first-person cta")
})

Deno.test("door confirmation quotes the request instead of speaking in first person", () => {
  const sms = buildConfirmationSummary({
    issue_type: "general",
    vendor_trade: "carpentry",
    initial_message: "My door broke",
    description: "My door broke",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /Got it\. Here's the request:/i, "header")
  assertMatch(sms, /[“"]My door broke\.[”"]/u, "quoted")
  assertEqual(/^My door broke$/m.test(sms), false, "not bare first person")
  assertMatch(sms, /Until help arrives/i, "handling tip")
  assertMatch(sms, /Reply YES to submit, or reply with any changes/i, "cta")
})
