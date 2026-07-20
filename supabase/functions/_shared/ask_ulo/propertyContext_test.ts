/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  DEMO_PROPERTY_PROFILES,
  formatPropertyScopeClarifyMarkdown,
  legalOpsContextFromOpsBullets,
  needsPortfolioPropertyScope,
} from "./propertyContext.ts"

Deno.test("needsPortfolioPropertyScope: rent increase", () => {
  assertEquals(needsPortfolioPropertyScope("Can I raise the rent?"), true)
  assertEquals(
    needsPortfolioPropertyScope("What notice do I need for a rent increase?"),
    true,
  )
})

Deno.test("needsPortfolioPropertyScope: generic statute question is false", () => {
  assertEquals(
    needsPortfolioPropertyScope("What is the maximum late fee under ORS for Oregon landlords?"),
    false,
  )
  assertEquals(
    needsPortfolioPropertyScope("Summarize federal Fair Housing Act protected classes"),
    false,
  )
})

Deno.test("needsPortfolioPropertyScope: section 8 / lease term", () => {
  assertEquals(needsPortfolioPropertyScope("Section 8 inspection tomorrow"), true)
  assertEquals(
    needsPortfolioPropertyScope("Is this unit month-to-month or fixed-term?"),
    true,
  )
})

Deno.test("formatPropertyScopeClarifyMarkdown lists buildings", () => {
  const md = formatPropertyScopeClarifyMarkdown(
    ["Maple Heights", "Oakwood Apartments"],
    "Can I raise the rent?",
  )
  assertStringIncludes(md, "Which property?")
  assertStringIncludes(md, "Maple Heights")
  assertStringIncludes(md, "Oakwood Apartments")
})

Deno.test("legalOpsContextFromOpsBullets strips ticket dumps", () => {
  const out = legalOpsContextFromOpsBullets([
    "Open maintenance tickets: 3 (filter: Maple Heights).",
    "Ticket abc12345: plumbing (high) — in_progress @ Maple Heights · 207.",
    "Open workflows: 2.",
  ])
  assertEquals(out.length >= 1, true)
  assertEquals(out.some((b) => /abc12345/.test(b)), false)
  assertEquals(out.some((b) => /3 open maintenance/i.test(b)), true)
})

Deno.test("Maple Heights demo profile flags Section 8", () => {
  const maple = DEMO_PROPERTY_PROFILES["Maple Heights"]
  assertEquals(maple.housingPrograms.includes("section_8_hcv"), true)
  assertEquals(
    maple.companyPolicies.some((p) => /PHA|HCV|Section 8/i.test(p)),
    true,
  )
})

Deno.test("Oakwood demo profile has no HCV but has rent-increase policy", () => {
  const oak = DEMO_PROPERTY_PROFILES["Oakwood Apartments"]
  assertEquals(oak.housingPrograms.length, 0)
  assertEquals(
    oak.companyPolicies.some((p) => /60-day|rent increase/i.test(p)),
    true,
  )
})

Deno.test("formatPropertyScopeClarifyMarkdown encourages portfolio-specific answer", () => {
  const md = formatPropertyScopeClarifyMarkdown(["Cedar Court"], "Can I raise the rent?")
  assertStringIncludes(md, "local law")
  assertStringIncludes(md, "leases")
})
