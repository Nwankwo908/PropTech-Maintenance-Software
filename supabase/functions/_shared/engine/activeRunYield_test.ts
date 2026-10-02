/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { InboundInterpretation } from "../sms/inboundInterpretation.ts"
import {
  activeNonMaintenanceRunShouldYield,
  hasClearUnrelatedMaintenanceIntent,
  isPlausibleRentCollectionReply,
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
