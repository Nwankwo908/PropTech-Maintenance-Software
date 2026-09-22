/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  INTAKE_SYSTEM_TEXT,
  stripSystemIntakeText,
  SYSTEM_SAFETY_NOTES,
  TENANT_UPDATE_PREFIX,
  tenantAuthoredText,
} from "./intakeSystemText.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import { applyQuestionPlan } from "./determineNextMaintenanceQuestion.ts"
import { issueSummaryBullet } from "./residentIntakeTypes.ts"

/**
 * The guard for the sink-overflow artifact: none of Ulo's own wording may come
 * back through the recognizer as a resident reporting something new. Several
 * of these notes describe hazards in plain repair language on purpose, which
 * is exactly why they have to be filtered before recognition rather than
 * judged by it.
 */
Deno.test("no system-written intake string can seed a new issue", () => {
  for (const template of INTAKE_SYSTEM_TEXT) {
    assertEquals(
      stripSystemIntakeText(template),
      "",
      `template still readable as tenant text: ${template}`,
    )
    const recognized = recognizeInboundIntentSync(stripSystemIntakeText(template))
    assertEquals(
      recognized.intent === "repair" || recognized.intent === "emergency",
      false,
      `template read as a new issue: ${template}`,
    )
  }
})

Deno.test("a safety note never changes what intake asks next", () => {
  const base = {
    initial_message: "My sink is clogged.",
    description: "My sink is clogged.",
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    preferred_contact_method: "text",
    diagnostic_facts: { plumbing_overflow: "No" },
    asked_question_types: ["plumbing_overflow"],
  }
  // Adriana's sink: "not actively overflowing" is our sentence, not hers.
  const withNote = applyQuestionPlan({
    ...base,
    description: `My sink is clogged.\n${TENANT_UPDATE_PREFIX} No`,
    safety_concerns: SYSTEM_SAFETY_NOTES.overflowNo,
  })
  const withoutNote = applyQuestionPlan(base)
  assertEquals(withNote.diagnostic_question_type, withoutNote.diagnostic_question_type)
  assertEquals(
    withNote.diagnostic_question_type === "plumbing_water_outage_scope",
    false,
  )
})

Deno.test("a safety note never becomes the headline", () => {
  const headline = issueSummaryBullet({
    initial_message: "My sink is clogged.",
    description: `My sink is clogged.\n${TENANT_UPDATE_PREFIX} No`,
    safety_concerns: SYSTEM_SAFETY_NOTES.overflowNo,
    issue_type: "plumbing",
    preferred_contact_method: "text",
  })
  assertMatch(headline, /sink is clogged/i)
  assertEquals(/no water/i.test(headline), false)
})

Deno.test("tenant text keeps the resident's words and drops ours", () => {
  const text = tenantAuthoredText({
    initial_message: "I have no water",
    description: `I have no water\n${TENANT_UPDATE_PREFIX} Everywhere in the home`,
    diagnostic_facts: { plumbing_water_outage_scope: "Everywhere in the home" },
  })
  assertMatch(text, /i have no water/i)
  assertMatch(text, /everywhere in the home/i)
  assertEquals(text.toLowerCase().includes("tenant update"), false)
})
