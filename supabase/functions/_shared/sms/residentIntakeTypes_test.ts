/// <reference lib="deno.ns" />

import {
  extractRoomFromText,
  inferIssueTypeFromText,
  intakeQuestionForStep,
  isAffirmativeReply,
  normalizeRoomOrArea,
  parseUrgency,
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
