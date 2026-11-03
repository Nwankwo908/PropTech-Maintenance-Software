/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { InboundInterpretation } from "../sms/inboundInterpretation.ts"
import {
  activeNonMaintenanceRunShouldYield,
  hasClearUnrelatedMaintenanceIntent,
  isPlausibleRentCollectionReply,
  rentCollectionShouldStayPinned,
  shouldSendRentInvalidReplyFallback,
} from "./activeRunYield.ts"

function repairInterpretation(
  bodySummary = "oven not working",
  confidence = 0.89,
): InboundInterpretation {
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
      issueSummary: bodySummary,
      showMenu: false,
      confirmation: null,
      emergencyType: null,
    },
  }
}

Deno.test("PAID / PARTIAL / QUESTIONS stay on rent_collection", () => {
  for (const body of ["PAID", "Partial", "QUESTIONS", "partial, I paid 700"]) {
    assertEquals(isPlausibleRentCollectionReply(body), true, body)
    assertEquals(
      activeNonMaintenanceRunShouldYield({
        activeTemplateId: "rent_collection",
        body,
        interpretation: repairInterpretation(),
      }),
      false,
      body,
    )
  }
})

Deno.test("clear repair while rent run is open yields to maintenance", () => {
  const interpretation = repairInterpretation()
  assertEquals(hasClearUnrelatedMaintenanceIntent(interpretation), true)
  assertEquals(
    activeNonMaintenanceRunShouldYield({
      activeTemplateId: "rent_collection",
      body: "Stove and Oven",
      interpretation,
    }),
    true,
  )
  assertEquals(
    activeNonMaintenanceRunShouldYield({
      activeTemplateId: "rent_collection",
      body:
        "The it failed the inspection. The oven does not work at all (at any temperature)",
      interpretation: repairInterpretation("pest issue", 0.89),
    }),
    true,
  )
})

Deno.test("ambiguous short reply without repair intent stays on rent", () => {
  assertEquals(
    activeNonMaintenanceRunShouldYield({
      activeTemplateId: "rent_collection",
      body: "ok",
      interpretation: {
        addressesPending: false,
        intent: "other",
        extractedSlots: {},
        needsClarification: true,
        source: "heuristic",
        recognition: {
          intent: "unclear",
          confidence: 0.3,
          layer: "menu",
          issueSummary: null,
          showMenu: true,
          confirmation: null,
          emergencyType: null,
        },
      },
    }),
    false,
  )
})

const LEAK =
  "The leak is in the baseboard heater for the first floor. In the basement"

Deno.test("paused rent does not keep a leak, and does not send the PAID fallback", () => {
  assertEquals(rentCollectionShouldStayPinned({
    body: LEAK,
    interpretation: null,
    rentPaused: true,
  }), false)
  assertEquals(shouldSendRentInvalidReplyFallback({
    body: LEAK,
    rentPaused: true,
  }), false)
  assertEquals(shouldSendRentInvalidReplyFallback({
    body: "ok",
    rentPaused: true,
  }), false)
})

Deno.test("an old rent run does not claim a repair or a photo when rent is enabled", () => {
  assertEquals(rentCollectionShouldStayPinned({
    body: LEAK,
    interpretation: null,
    rentPaused: false,
  }), false)
  assertEquals(shouldSendRentInvalidReplyFallback({
    body: LEAK,
    rentPaused: false,
  }), false)
  assertEquals(rentCollectionShouldStayPinned({
    body: "",
    interpretation: null,
    mediaCount: 1,
    rentPaused: false,
  }), false)
  assertEquals(rentCollectionShouldStayPinned({
    body: "ok",
    interpretation: null,
    rentPaused: false,
  }), true)
  assertEquals(shouldSendRentInvalidReplyFallback({
    body: "ok",
    rentPaused: false,
  }), true)
  assertEquals(rentCollectionShouldStayPinned({
    body: "PAID",
    interpretation: null,
    rentPaused: true,
  }), true)
  assertEquals(shouldSendRentInvalidReplyFallback({
    body: "PAID",
    rentPaused: true,
  }), false)
})

Deno.test("maintenance_intake pin is not yielded by this helper", () => {
  assertEquals(
    activeNonMaintenanceRunShouldYield({
      activeTemplateId: "maintenance_intake",
      body: "oven broken",
      interpretation: repairInterpretation(),
    }),
    false,
  )
})
