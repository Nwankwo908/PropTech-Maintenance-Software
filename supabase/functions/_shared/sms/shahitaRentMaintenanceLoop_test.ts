/// <reference lib="deno.ns" />
/**
 * Regression for Shahita Sanders (Sep 29): repair texts while rent_collection
 * was active were absorbed, then the identical-reply circuit substituted a
 * distress handoff that looped on "thank you" / "okay".
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  activeNonMaintenanceRunShouldYield,
} from "../engine/activeRunYield.ts"
import type { InboundInterpretation } from "./inboundInterpretation.ts"
import {
  countIdenticalRecentOutbounds,
  normalizeOutboundForLoopCompare,
  recentOutboundIncludesHandoff,
  shouldSuppressIdenticalOutbound,
} from "./sms_inbound_guard.ts"
import {
  buildTenantDistressHandoffSms,
  canHandleTenantDistress,
  detectTenantDistressSignals,
  shouldClearOutboundLoopFlagOnInbound,
} from "./tenantDistress.ts"

const UNIT_PROMPT =
  "Hi — this is Ulo. Tell me what's going on with your unit (a photo or video helps too)."

function repairInterp(confidence = 0.89): InboundInterpretation {
  return {
    addressesPending: false,
    intent: "maintenance_new",
    extractedSlots: {},
    needsClarification: false,
    source: "heuristic",
    recognition: {
      intent: "repair",
      confidence,
      layer: "rules",
      issueSummary: "appliance issue",
      showMenu: false,
      confirmation: null,
      emergencyType: null,
    },
  }
}

Deno.test("greeting variants of the same handoff count as identical", () => {
  const a = buildTenantDistressHandoffSms(null)
  const b = buildTenantDistressHandoffSms("Shahita")
  assertEquals(
    normalizeOutboundForLoopCompare(a),
    normalizeOutboundForLoopCompare(b),
  )
  assertEquals(countIdenticalRecentOutbounds([a], b), 1)
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [a],
      candidateBody: b,
    }).trip,
    true,
  )
})

Deno.test("two different repair descriptions do not trip the loop breaker", () => {
  const first =
    "Got it — I logged a stove and oven issue. Anything else about what's going on?"
  const second =
    "Got it — oven does not heat at any temperature. We'll get this to your property team."
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [first],
      candidateBody: second,
    }).trip,
    false,
  )
})

Deno.test("identical resolution prompt trips — true suppress (no handoff substitute)", () => {
  const trip = shouldSuppressIdenticalOutbound({
    recentOutboundBodies: [UNIT_PROMPT],
    candidateBody: UNIT_PROMPT,
  })
  assertEquals(trip.trip, true)
  assertEquals(trip.hits, 1)
  // Call site contract: on trip, do not send candidate and do not send handoff
  // when a greeting-variant handoff already exists in the window.
  const handoff = buildTenantDistressHandoffSms(null)
  assertEquals(
    recentOutboundIncludesHandoff([UNIT_PROMPT, handoff], handoff),
    true,
  )
  assertEquals(
    recentOutboundIncludesHandoff([UNIT_PROMPT], handoff),
    false,
  )
})

Deno.test("Shahita sequence: rent yields → no distress on thanks/okay", () => {
  const steps: Array<{ body: string; interpretation: InboundInterpretation | null }> = [
    { body: "Stove and Oven", interpretation: repairInterp(0.92) },
    {
      body:
        "The it failed the inspection. The oven does not work at all (at any temperature)",
      interpretation: repairInterp(0.89),
    },
    { body: "Thank you very much", interpretation: null },
    { body: "Okay", interpretation: null },
  ]

  // 1–2: clear repair while rent open → yield (maintenance owns the thread)
  for (const step of steps.slice(0, 2)) {
    assertEquals(
      activeNonMaintenanceRunShouldYield({
        activeTemplateId: "rent_collection",
        body: step.body,
        interpretation: step.interpretation,
      }),
      true,
      step.body,
    )
  }

  // Simulate: first unit prompt sent; second identical would trip → suppress (no SMS).
  const afterFirstPrompt = [UNIT_PROMPT]
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: afterFirstPrompt,
      candidateBody: UNIT_PROMPT,
    }).trip,
    true,
  )

  // Sticky flag left after a trip must not claim ordinary follow-ups.
  const flagged = {
    outbound_identical_reply_loop_at: "2026-09-30T01:51:07.625Z",
  }
  for (const step of steps.slice(2)) {
    assertEquals(
      shouldClearOutboundLoopFlagOnInbound({
        body: step.body,
        intakeState: flagged,
      }),
      true,
      step.body,
    )
    assertEquals(
      detectTenantDistressSignals({ body: step.body, intakeState: flagged })
        .distress,
      false,
      step.body,
    )
    assertEquals(
      canHandleTenantDistress({
        identityType: "resident",
        body: step.body,
        intakeState: flagged,
      }),
      false,
      step.body,
    )
  }

  // If a handoff somehow went out once, greeting-variant must not go out again.
  const handoffThere = buildTenantDistressHandoffSms(null)
  const handoffShahita = buildTenantDistressHandoffSms("Shahita")
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [handoffThere],
      candidateBody: handoffShahita,
    }).trip,
    true,
  )
})
