/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { formatLegalAttributionMarkdown } from "./legalAnswerAttribution.ts"

Deno.test("formatLegalAttributionMarkdown includes place and authority", () => {
  const md = formatLegalAttributionMarkdown({
    jurisdiction: {
      countryCode: "US",
      stateCode: "OR",
      countyLabel: "Multnomah",
      cityLabel: "Portland",
    },
    citations: [
      {
        tool: "legal_rag",
        title: "ORS 90.322",
        sourceTier: "primary_official",
        effectiveOn: "2024-01-01",
        lastUpdatedOn: "2025-06-01",
      },
    ],
    primaryOfficialCount: 1,
  })
  assertStringIncludes(md, "Portland")
  assertStringIncludes(md, "Multnomah")
  assertStringIncludes(md, "OR")
  assertStringIncludes(md, "law / official")
  assertStringIncludes(md, "2025-06-01")
  assertEquals(md.includes("Where this applies"), true)
})
