import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  deriveAskUloRefusalReason,
  deriveAskUloResponseStatus,
} from "../../audit/writeAskUloAuditRecord.ts"

Deno.test("deriveAskUloResponseStatus maps refuse / clarify / block", () => {
  assertEquals(deriveAskUloResponseStatus({}), "answered")
  assertEquals(deriveAskUloResponseStatus({ refused: true }), "refused")
  assertEquals(deriveAskUloResponseStatus({ clarified: true }), "clarified")
  assertEquals(deriveAskUloResponseStatus({ blocked: true }), "blocked")
  assertEquals(
    deriveAskUloResponseStatus({ blocked: true, refused: true }),
    "blocked",
  )
})

Deno.test("deriveAskUloRefusalReason prefers safety kind then quality summary", () => {
  assertEquals(
    deriveAskUloRefusalReason({ responseStatus: "answered" }),
    null,
  )
  assertEquals(
    deriveAskUloRefusalReason({
      responseStatus: "blocked",
      safetyKind: "fair_housing",
      qualitySummary: "ignored",
    }),
    "fair_housing",
  )
  assertEquals(
    deriveAskUloRefusalReason({
      responseStatus: "refused",
      qualitySummary: "grounding:fail",
      gateStatus: "refuse",
    }),
    "grounding:fail",
  )
  assertEquals(
    deriveAskUloRefusalReason({
      responseStatus: "clarified",
      gateStatus: "clarify",
    }),
    "clarify",
  )
})
