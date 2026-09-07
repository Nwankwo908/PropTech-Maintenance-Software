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

Deno.test("clogged sink with no overflow then asks for a drain photo", () => {
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
  assertEqual(planned.step, "photo", "photo next")
  assertMatch(planned.diagnostic_question ?? "", /photo of the sink/i, "contextual photo")
  assertEqual(planned.urgency === "emergency", false, "ulo sets urgency")
  assertEqual(planned.preferred_contact_method, "text", "sms default")
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
    planned.step === "diagnostic" || planned.step === "photo" || planned.step === "awaiting_confirm",
    true,
    "continues",
  )
})

Deno.test("confirmation is tenant-facing and omits priority chips", () => {
  const sms = buildConfirmationSummary({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    safety_concerns: "No overflow or standing water",
    photo_urls: ["https://example.com/p.jpg"],
    urgency: "urgent",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /Just to confirm/i, "header")
  assertMatch(sms, /clogged/i, "headline")
  assertMatch(sms, /No overflow or standing water/i, "fact")
  assertMatch(sms, /Photo attached/i, "photo")
  assertEqual(/Priority:/i.test(sms), false, "no priority")
  assertEqual(/Updates via/i.test(sms), false, "no channel ask")
  assertMatch(sms, /Reply YES to submit/i, "cta")
})
