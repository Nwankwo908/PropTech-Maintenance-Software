import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import {
  buildConfirmationSummary,
  canReuseUnassignedTicketForIntake,
  alertTicketIdForIntake,
  intakeMayAttachToOpenTicket,
} from "./residentIntakeTypes.ts"

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

Deno.test("vague something is broken asks what is happening before a category", () => {
  const planned = applyQuestionPlan({
    initial_message: "Something is broken.",
    description: "Something is broken.",
    preferred_contact_method: "text",
  })
  assertEqual(planned.diagnostic_question_type, "symptom_clarify", "clarify first")
  assertEqual(planned.vendor_trade ?? null, null, "no vendor yet")
  assertMatch(
    planned.diagnostic_question ?? "",
    /what's broken and what's happening/i,
    "asks what is happening",
  )
  assertMatch(planned.diagnostic_question ?? "", /a photo can help too/i, "invites a photo")
  assertEqual(/required|must send|reply skip/i.test(planned.diagnostic_question ?? ""), false, "photo optional")
})

Deno.test("AC failure at 95F asks about indoor heat before troubleshooting", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "The AC isn't working.",
    description: "The AC isn't working.",
    outdoor_temp_f: 95,
  })
  assertEqual(next.shouldAsk, true, "asks")
  if (!next.shouldAsk) return
  assertEqual(next.questionType, "hvac_heat_check", "heat context first")
  assertEqual(
    next.question,
    "How hot is it inside, and is anyone feeling unwell? Is the AC blowing warm air or not turning on at all?",
    "copy",
  )
})

Deno.test("AC heat reply that someone is unwell skips more troubleshooting", () => {
  const after = applyDiagnosticAnswer({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "The AC isn't working.",
    description: "The AC isn't working.",
    outdoor_temp_f: 95,
    diagnostic_question_type: "hvac_heat_check",
    preferred_contact_method: "text",
  }, "It's 100 inside and my son feels dizzy. The AC won't turn on.")
  assertEqual(after.diagnostic_facts?.hvac_immediate_danger, "yes", "danger")
  assertEqual(after.issue_type, "HVAC", "same issue")
  assertEqual(after.vendor_trade, "hvac", "same trade")
  assertMatch(after.description ?? "", /son feels dizzy/i, "answer saved")
  const planned = applyQuestionPlan(after)
  assertEqual(planned.diagnostic_question_type, undefined, "no more questions")
  assertEqual(planned.step, "awaiting_confirm", "confirm without troubleshooting")
})

Deno.test("AC heat reply that everyone is fine does not ask those questions again", () => {
  const after = applyDiagnosticAnswer({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "The AC isn't working.",
    description: "The AC isn't working.",
    outdoor_temp_f: 95,
    diagnostic_question_type: "hvac_heat_check",
    asked_question_types: ["hvac_heat_check"],
    preferred_contact_method: "text",
  }, "About 78 inside, everyone is fine, and it is blowing warm air.")
  assertEqual(after.diagnostic_facts?.hvac_immediate_danger, undefined, "not danger")
  const planned = applyQuestionPlan(after)
  assertEqual(planned.diagnostic_question_type === "hvac_heat_check", false, "not repeated")
  assertEqual(planned.diagnostic_question_type === "hvac_behavior", false, "behavior already answered")
  assertEqual(planned.diagnostic_question_type === "self_fix", false, "no troubleshooting")
})

Deno.test("mild AC still asks how the system is behaving", () => {
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

Deno.test("heat confirmation states complete resident details", () => {
  const sms = buildConfirmationSummary({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "The AC isn't working.",
    description:
      "The AC isn't working\nTenant update: It's 100 inside and my son feels dizzy. The AC won't turn on.",
    outdoor_temp_f: 95,
    safety_concerns: "Someone in the home may be unwell from the heat",
    diagnostic_facts: {
      hvac_behavior: "not turning on",
      hvac_immediate_danger: "yes",
    },
    preferred_contact_method: "text",
  })
  assertMatch(sms, /Request details:/, "details header")
  assertMatch(sms, /• The AC is not turning on\./, "behavior")
  assertMatch(sms, /• The indoor temperature is 100°F\./, "indoor temp")
  assertMatch(sms, /• Someone in the home feels dizzy\./, "wellness")
  assertEqual(/not turning on$/m.test(sms), false, "no fragment")
  assertEqual(/may be unwell from the heat/i.test(sms), false, "no generic heat note")
  assertEqual(/Until help arrives/i.test(sms), false, "no troubleshooting tip")
  assertEqual(/\b95\b/.test(sms), false, "outdoor temp is not a resident detail")
})

Deno.test("a different trade does not reuse an unassigned work order", () => {
  assertEqual(canReuseUnassignedTicketForIntake({
    ticketIssueCategory: "plumbing",
    intakeIssueCategory: "hvac",
    vendorWorkStatus: "unassigned",
  }), false, "hvac does not overwrite plumbing")
  assertEqual(canReuseUnassignedTicketForIntake({
    ticketIssueCategory: "plumbing",
    intakeIssueCategory: "plumbing",
    vendorWorkStatus: "unassigned",
  }), true, "same trade draft can update")
  assertEqual(canReuseUnassignedTicketForIntake({
    ticketIssueCategory: "hvac",
    intakeIssueCategory: "hvac",
    vendorWorkStatus: "accepted",
  }), false, "accepted work is not a draft")
})

const GAS_INTAKE = {
  vendor_trade: "other" as const,
  primary_category: "general" as const,
  initial_message: "I smell gas in the kitchen",
  description: "I smell gas in the kitchen",
  urgency: "emergency" as const,
  preferred_contact_method: "text" as const,
}
const AC_TICKET = "30a0b8cc-4284-42a7-8139-b59e219219f0"

Deno.test("gas confirmation does not offer a quick fix", () => {
  const sms = buildConfirmationSummary(GAS_INTAKE)
  assertMatch(sms, /Gas smell/, "gas headline")
  assertMatch(sms, /Reply YES to submit/, "submit still waits")
  assertEqual(/Until help arrives/i.test(sms), false, "no troubleshooting tip")
  assertEqual(/thermostat|shutoff|GFCI|reset/i.test(sms), false, "no quick fix")
})

Deno.test("a gas emergency does not alert or submit against an open AC request", () => {
  assertEqual(intakeMayAttachToOpenTicket({
    ticketIssueCategory: "hvac",
    vendorWorkStatus: "unassigned",
    intake: GAS_INTAKE,
  }), false, "submission does not update the AC request")
  assertEqual(alertTicketIdForIntake({
    linkedTicketId: AC_TICKET,
    linkedTicketCategory: "hvac",
    linkedTicketStatus: "unassigned",
    intake: GAS_INTAKE,
  }), null, "alert omits the AC ref")
  assertEqual(alertTicketIdForIntake({
    draftTicketId: "gas-ticket",
    linkedTicketId: AC_TICKET,
    linkedTicketCategory: "hvac",
    linkedTicketStatus: "unassigned",
    intake: GAS_INTAKE,
  }), "gas-ticket", "gas draft is the alert ref")
  assertEqual(alertTicketIdForIntake({
    linkedTicketId: AC_TICKET,
    linkedTicketCategory: "hvac",
    linkedTicketStatus: "unassigned",
    intake: {
      vendor_trade: "hvac",
      issue_type: "HVAC",
    },
  }), AC_TICKET, "same AC issue can stay on the AC request")
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
  assertEqual(/[“"].*[”"]/u.test(sms), false, "no quote marks")
  assertMatch(sms, /Water is not actively overflowing/i, "fact")
  assertMatch(sms, /Photo attached/i, "photo")
  assertMatch(sms, /Until help arrives/i, "handling tip")
  assertMatch(sms, /flushing|drain cleaner|fixture/i, "plumbing tip")
  // Tip sits above structured bullets (photo / safety note).
  const tipIdx = sms.search(/Until help arrives/i)
  const photoIdx = sms.search(/Photo attached/i)
  assertEqual(tipIdx > 0 && tipIdx < photoIdx, true, "tip before photo bullet")
  assertEqual(/Priority:/i.test(sms), false, "no priority")
  assertEqual(/Updates via/i.test(sms), false, "no channel ask")
  assertMatch(sms, /Reply YES to submit, or reply with any changes/i, "cta")
  assertEqual(/\bJust to confirm\b/i.test(sms), false, "no old header")
  assertEqual(/tell me what needs to be changed/i.test(sms), false, "no first-person cta")
})

Deno.test("door confirmation states a clean issue phrase without quotation marks", () => {
  const sms = buildConfirmationSummary({
    issue_type: "general",
    vendor_trade: "carpentry",
    initial_message: "My door broke",
    description: "My door broke",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /Got it\. Here's the request:/i, "header")
  assertMatch(sms, /^Carpentry issue$/m, "issue line")
  assertEqual(/[“"].*[”"]/u.test(sms), false, "no quote marks")
  assertEqual(/^My door broke$/m.test(sms), false, "not bare first person")
  // Safety tip comes right after the issue line.
  const tipIdx = sms.search(/Until help arrives/i)
  const issueIdx = sms.search(/^Carpentry issue$/m)
  assertEqual(tipIdx > issueIdx, true, "tip after issue")
  assertMatch(sms, /Reply YES to submit, or reply with any changes/i, "cta")
})
