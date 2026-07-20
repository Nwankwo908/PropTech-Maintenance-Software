import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatFact,
  formatStructuredBullets,
  matchedStructuredFactKeys,
  shouldRunStructuredLookup,
  type StructuredFactHit,
} from "./structuredLookup.ts"

Deno.test("structured: Section 8 payment standards hit FMR keys", () => {
  const q = "What are the payment standards for Section 8?"
  assertEquals(shouldRunStructuredLookup(q), true)
  const keys = matchedStructuredFactKeys(q)
  assertEquals(keys.includes("section_8_payment_standard_note"), true)
  assertEquals(keys.includes("hud_fmr_2br"), true)
})

Deno.test("structured: habitability / required repairs", () => {
  const q = "What repairs am I legally required to make for habitability?"
  assertEquals(shouldRunStructuredLookup(q), true)
  assertEquals(matchedStructuredFactKeys(q).includes("habitability_required"), true)
})

Deno.test("structured: lead paint disclosure", () => {
  const q = "Do I need a lead paint disclosure for a pre-1978 unit?"
  assertEquals(shouldRunStructuredLookup(q), true)
  assertEquals(
    matchedStructuredFactKeys(q).includes("lead_paint_pre1978_disclosure"),
    true,
  )
})

Deno.test("structured: notice period still works", () => {
  const keys = matchedStructuredFactKeys(
    "How many days notice for month-to-month termination?",
  )
  assertEquals(keys.includes("notice_period_days_month_to_month"), true)
})

Deno.test("formatFact uses plain English, not raw keys", () => {
  const line = formatFact({
    factKey: "hud_fmr_2br",
    valueNumeric: 1850,
    valueText: null,
    unit: "usd_per_month",
    sourceCitation: "HUD FMR",
    sourceUrl: null,
    stateCode: "OR",
    citySlug: "portland",
    countySlug: null,
    jurisdictionLevel: "city",
    effectiveOn: "2024-10-01",
    publicationStatus: "published_code",
    normativeType: "guidance",
  })
  assertEquals(line.includes("hud_fmr"), false)
  assertEquals(line.includes("usd_per_month"), false)
  assertEquals(line.includes("effective 2024"), false)
  assertEquals(line.includes("$1,850"), true)
  assertEquals(line.includes("two-bedroom"), true)
})

Deno.test("formatStructuredBullets summarizes FMR range", () => {
  const base: Omit<StructuredFactHit, "factKey" | "valueNumeric"> = {
    valueText: null,
    unit: "usd_per_month",
    sourceCitation: "HUD FMR",
    sourceUrl: null,
    stateCode: "OR",
    citySlug: "portland",
    countySlug: null,
    jurisdictionLevel: "city",
    effectiveOn: null,
    publicationStatus: null,
    normativeType: "guidance",
  }
  const bullets = formatStructuredBullets([
    { ...base, factKey: "hud_fmr_0br", valueNumeric: 1400 },
    { ...base, factKey: "hud_fmr_2br", valueNumeric: 1850 },
    { ...base, factKey: "hud_fmr_3br", valueNumeric: 2600 },
  ])
  assertEquals(bullets.length, 1)
  assertEquals(bullets[0]!.includes("$1,400"), true)
  assertEquals(bullets[0]!.includes("$2,600"), true)
  assertEquals(bullets[0]!.includes("hud_fmr"), false)
})
