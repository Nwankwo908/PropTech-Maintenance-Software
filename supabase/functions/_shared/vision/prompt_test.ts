/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { INSPECTION_DOCUMENT_SYSTEM_PROMPT } from "./prompt.ts"

Deno.test("document prompt commits to a best-effort age when form values conflict", () => {
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "do not\nreturn estimatedAge as null just because the values don't obviously agree",
  )
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "Prefer a directly stated age in years",
  )
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "do not\nlower overallConfidence just because age was ambiguous",
  )
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "Only return estimatedAge as null\nwhen the report gives no age-related information at all",
  )
})

Deno.test("document prompt requires later 4-point sections, not only electrical", () => {
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "Never return only the first section (electrical)",
  )
})

Deno.test("document prompt allows at most two roof coverings", () => {
  assertStringIncludes(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT,
    "at most two items: one predominant covering and one secondary covering",
  )
})

Deno.test("document prompt still zeros confidence only for blank/illegible sections", () => {
  assertEquals(
    INSPECTION_DOCUMENT_SYSTEM_PROMPT.includes(
      "return that item with overallConfidence 0 and rawConfidenceNotes stating what was missing",
    ),
    true,
  )
})
