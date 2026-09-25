import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { normalizeUnitLabelForMatch } from "./resolveUnitId.ts"

Deno.test("normalizeUnitLabelForMatch strips unit prefixes", () => {
  assertEquals(normalizeUnitLabelForMatch("Unit #1A"), "1a")
  assertEquals(normalizeUnitLabelForMatch("Apt 2"), "2")
  assertEquals(normalizeUnitLabelForMatch("  3  "), "3")
})
