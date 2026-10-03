import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"

Deno.test("Takeira HABC reschedule → inspection_notice (not maintenance_new)", () => {
  const interp = heuristicInterpretInbound(
    "My annual inspection being switched to 10/08/2026 — HABC emailed me the notice",
    { activeIntake: false },
  )
  assertEquals(interp.intent, "inspection_notice")
  assertEquals(interp.extractedSlots.inspection_date, "2026-10-08")
})

Deno.test("paint before inspection alone is not inspection_notice", () => {
  const interp = heuristicInterpretInbound(
    "These need to be done before the inspection. The wall and the ceiling needs to be painted. The door isn't on properly.",
    { activeIntake: false },
  )
  // Must not swallow the repair as an inspection_notice; linking to an open
  // tenant_notice report happens at ticket mint when deadline language is present.
  assertEquals(interp.intent === "inspection_notice", false)
})

Deno.test("HABC notice + paint compound → inspection_notice with also_repair", () => {
  const interp = heuristicInterpretInbound(
    "HABC inspection scheduled for 10/08/2026. The wall needs to be painted and the door is not on properly.",
    { activeIntake: false },
  )
  assertEquals(interp.intent, "inspection_notice")
  assertEquals(interp.extractedSlots.also_repair, "1")
  assertEquals(interp.extractedSlots.inspection_date, "2026-10-08")
})
