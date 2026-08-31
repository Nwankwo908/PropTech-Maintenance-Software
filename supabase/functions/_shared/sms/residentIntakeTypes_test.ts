/// <reference lib="deno.ns" />

import {
  extractFirstNoticedFromText,
  extractRoomFromText,
  inferIssueTypeFromText,
  intakeQuestionForStep,
  isAffirmativeReply,
  isNegativeReply,
  isTimeOrDurationPhrase,
  MAX_INTAKE_CLARIFY_REPEATS,
  nextCollectingStep,
  normalizeRoomOrArea,
  parseUrgency,
  recordIntakePromptRepeat,
  resolveRoomLabel,
  resolveUrgencyReply,
  sanitizeIntakeState,
  urgencyQuestion,
} from "./residentIntakeTypes.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test("extracts basement from flooded message", () => {
  assertEqual(extractRoomFromText("My basement is flooded"), "basement", "room")
})

Deno.test("does not store full issue sentence as room", () => {
  assertEqual(
    normalizeRoomOrArea("My basement is flooded", "My basement is flooded"),
    "basement",
    "normalize",
  )
})

Deno.test("infers leak from flooded message", () => {
  assertEqual(inferIssueTypeFromText("My basement is flooded"), "leak", "issue type")
})

Deno.test("infers HVAC from heater / AC wording", () => {
  assertEqual(inferIssueTypeFromText("The heater stopped working."), "HVAC", "heater")
  assertEqual(inferIssueTypeFromText("Also, my AC isn't working."), "HVAC", "ac")
})

Deno.test("infers electrical from electrician / outlet wording", () => {
  assertEqual(inferIssueTypeFromText("When is my electrician coming?"), "electrical", "electrician")
  assertEqual(inferIssueTypeFromText("outlet sparking"), "electrical", "outlet")
})

Deno.test("infers lock from door damage / won't close", () => {
  assertEqual(inferIssueTypeFromText("My door is damaged"), "lock", "door damaged")
  assertEqual(inferIssueTypeFromText("The door won't close"), "lock", "door won't close")
})

Deno.test("first_noticed prompt uses clean room and flooding wording", () => {
  const state = sanitizeIntakeState({
    step: "first_noticed",
    issue_type: "leak",
    initial_message: "My basement is flooded",
    description: "My basement is flooded",
    room_or_area: "My basement is flooded",
  })

  assertEqual(resolveRoomLabel(state), "basement", "resolved room")
  assertEqual(
    intakeQuestionForStep(state, "first_noticed"),
    "When did you first notice the flooding in the basement?",
    "prompt",
  )
})

Deno.test("asks for room when location unknown", () => {
  const state = sanitizeIntakeState({
    step: "room_or_area",
    issue_type: "leak",
    initial_message: "There is a leak",
    description: "There is a leak",
  })

  assertEqual(
    intakeQuestionForStep(state, "room_or_area"),
    "Sorry you're dealing with that. Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?",
    "room prompt",
  )
})

Deno.test("urgency parse accepts natural phrases", () => {
  assertEqual(parseUrgency("It's an emergency"), "emergency", "phrase emergency")
  assertEqual(parseUrgency("call it urgent please"), "urgent", "phrase urgent")
  assertEqual(parseUrgency("emergency"), "emergency", "bare")
  assertEqual(
    resolveUrgencyReply("That sounds right", "emergency"),
    "emergency",
    "affirm recommended",
  )
  assertEqual(isAffirmativeReply("That sounds right"), true, "affirm")
  assertEqual(isAffirmativeReply("Yes that's right"), true, "yes thats right")
  assertEqual(isAffirmativeReply("Yes, that's correct"), true, "yes comma thats correct")
  assertEqual(
    resolveUrgencyReply("Yes that's right", "emergency"),
    "emergency",
    "yes thats right accepts recommended urgency",
  )
  assertEqual(isNegativeReply("No"), true, "bare no")
  assertEqual(isNegativeReply("The leak is getting worse"), false, "description is not no")
  assertEqual(resolveUrgencyReply("maybe later", "emergency"), null, "non-match")
})

Deno.test("urgency question uses Because not Since of", () => {
  const state = sanitizeIntakeState({
    step: "urgency",
    issue_type: "electrical",
    recommended_urgency: "emergency",
    safety_concerns: "sparks near wires",
    initial_message: "sparks",
  })
  const q = urgencyQuestion(state)
  assertEqual(q.startsWith("Because "), true, "because prefix")
  assertEqual(q.includes("Since of"), false, "no since of")
})

Deno.test("intake prompt repeat hands off after two asks without a valid answer", () => {
  let state = { step: "urgency" as const }
  const first = recordIntakePromptRepeat(state, "urgency")
  assertEqual(first.shouldHandoff, false, "first urgency ask")
  assertEqual(first.state.prompt_repeat_count, 1, "count 1")

  const second = recordIntakePromptRepeat(first.state, "urgency")
  assertEqual(second.shouldHandoff, false, "second urgency ask")
  assertEqual(second.state.prompt_repeat_count, 2, "count 2")

  const third = recordIntakePromptRepeat(second.state, "urgency")
  assertEqual(third.shouldHandoff, true, "third urgency ask hands off")
  assertEqual(third.state.prompt_repeat_count, MAX_INTAKE_CLARIFY_REPEATS + 1, "count 3")
})

Deno.test("intake prompt repeat resets when the step changes", () => {
  const afterSafety = recordIntakePromptRepeat({ step: "safety_concerns" }, "safety_concerns")
  const firstUrgency = recordIntakePromptRepeat(afterSafety.state, "urgency")
  assertEqual(firstUrgency.shouldHandoff, false, "new step is not a repeat")
  assertEqual(firstUrgency.state.prompt_repeat_count, 1, "reset count")
  assertEqual(firstUrgency.state.prompt_repeat_step, "urgency", "step")
})

Deno.test("time phrases are never stored as the room", () => {
  assertEqual(extractRoomFromText("today"), null, "today")
  assertEqual(extractRoomFromText("this morning"), null, "this morning")
  assertEqual(extractRoomFromText("yesterday"), null, "yesterday")
  assertEqual(extractRoomFromText("start"), null, "start")
  assertEqual(normalizeRoomOrArea("today"), null, "normalize today")
  assertEqual(isTimeOrDurationPhrase("today"), true, "is time")
  assertEqual(extractFirstNoticedFromText("today"), "today", "noticed today")
  assertEqual(extractRoomFromText("kitchen"), "kitchen", "kitchen still a room")
  assertEqual(
    extractRoomFromText("Water is coming through my ceiling today"),
    "ceiling",
    "strips trailing today",
  )
})

Deno.test("first_noticed prompt does not say in the today", () => {
  const state = sanitizeIntakeState({
    step: "first_noticed",
    issue_type: "leak",
    initial_message: "Water is coming through my ceiling",
    description: "Water is coming through my ceiling",
    room_or_area: "today",
  })
  assertEqual(state.room_or_area, "ceiling", "recovered ceiling")
  assertEqual(
    intakeQuestionForStep(state, "first_noticed"),
    "When did you first notice the leak in the ceiling?",
    "prompt",
  )
})

Deno.test("bogus time room with no recoverable location asks which room", () => {
  const state = sanitizeIntakeState({
    step: "first_noticed",
    issue_type: "leak",
    initial_message: "There is a leak",
    description: "There is a leak",
    room_or_area: "today",
  })
  assertEqual(state.room_or_area, undefined, "cleared")
  assertEqual(state.step, "room_or_area", "ask room")
  assertEqual(nextCollectingStep("first_noticed", { first_noticed: "today" }), "room_or_area", "need room")
})

Deno.test("photo step is skipped for HVAC and dripping faucets", () => {
  assertEqual(
    nextCollectingStep("preferred_contact_method", {
      description: "No heat",
      vendor_trade: "hvac",
      primary_category: "hvac",
    }),
    "awaiting_confirm",
    "hvac skip",
  )
  assertEqual(
    nextCollectingStep("preferred_contact_method", {
      description: "Leaky faucet",
      vendor_trade: "plumbing",
    }),
    "awaiting_confirm",
    "faucet skip",
  )
  assertEqual(
    nextCollectingStep("preferred_contact_method", {
      description: "I saw a mouse",
      vendor_trade: "pest_control",
      primary_category: "pest",
    }),
    "photo",
    "pest asks",
  )
})
