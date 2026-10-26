import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import { selfFixApprovalLine } from "../../../../shared/maintenance/selfFixTips.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertIncludes(actual: string, needle: string, label: string) {
  if (!actual.includes(needle)) {
    throw new Error(`${label}: ${JSON.stringify(actual)} did not include ${JSON.stringify(needle)}`)
  }
}

const gfci = {
  issue_type: "electrical",
  vendor_trade: "electrical",
  primary_category: "electrical",
  room_or_area: "Kitchen",
  initial_message: "The kitchen outlets are dead",
  description: "The kitchen outlets are dead",
  preferred_contact_method: "text",
}

Deno.test("GFCI intake asks the tip once, after the room is known", () => {
  const first = determineNextMaintenanceQuestion(gfci)
  if (!first.shouldAsk) throw new Error("expected a question")
  const scoped = first.questionType === "self_fix"
    ? gfci
    : applyDiagnosticAnswer(
      { ...gfci, diagnostic_question_type: first.questionType, diagnostic_question: first.question },
      "Only in the kitchen",
    )
  const planned = applyQuestionPlan(scoped)
  assertEqual(planned.diagnostic_question_type, "self_fix", "type")
  assertIncludes(planned.diagnostic_question ?? "", "Press RESET", "ask")
  assertEqual(planned.diagnostic_facts?.self_fix_tip, "gfci_reset", "tip id")

  const answered = applyDiagnosticAnswer(planned, "still out")
  assertEqual(answered.diagnostic_facts?.self_fix_result, "not_fixed", "result")
  assertEqual(answered.diagnostic_facts?.self_fix_tried, "gfci_reset", "tried")
  const again = determineNextMaintenanceQuestion(answered)
  if (again.shouldAsk) {
    assertEqual(again.questionType === "self_fix", false, "not asked twice")
  }
})

Deno.test("it works records a tenant self-fix and does not keep asking", () => {
  const planned = applyQuestionPlan({
    ...gfci,
    asked_question_types: ["electrical_scope"],
    diagnostic_facts: { electrical_scope: "only the kitchen" },
  })
  assertEqual(planned.diagnostic_question_type, "self_fix", "asked")
  const answered = applyDiagnosticAnswer(planned, "it works")
  assertEqual(answered.diagnostic_facts?.self_fix_result, "fixed", "fixed")
  const line = selfFixApprovalLine({
    text: gfci.description,
    hasTenant: true,
    diagnosticFacts: answered.diagnostic_facts,
  })
  assertEqual(line, null, "no landlord approval text")
})

Deno.test("still out is the landlord tried line", () => {
  const line = selfFixApprovalLine({
    text: "The kitchen outlets are dead",
    hasTenant: true,
    diagnosticFacts: { self_fix_tip: "gfci_reset", self_fix_result: "not_fixed" },
  })
  assertEqual(line, "Tenant already tried the GFCI reset — still out.", "tried line")
})

Deno.test("an emergency does not ask the tip question", () => {
  let state: Record<string, unknown> = {
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    room_or_area: "Kitchen",
    initial_message: "I smell gas in the kitchen",
    description: "I smell gas in the kitchen",
  }
  for (let i = 0; i < 8; i++) {
    const next = determineNextMaintenanceQuestion(state)
    if (!next.shouldAsk) break
    if (next.questionType === "self_fix") {
      throw new Error("asked a self-fix tip during an emergency")
    }
    state = applyDiagnosticAnswer(
      { ...state, diagnostic_question_type: next.questionType, diagnostic_question: next.question },
      "no",
    )
  }
})

Deno.test("no heat at 20F does not ask a thermostat tip", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    initial_message: "No heat in the apartment",
    description: "No heat in the apartment",
    outdoor_temp_f: 20,
  })
  if (next.shouldAsk) {
    assertEqual(next.questionType === "self_fix", false, "no tip")
  }
})
