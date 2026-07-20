/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  DEEP_OPERATIONAL_INVESTIGATION_GUIDE,
  classifyDeepOperationalInvestigation,
  detectOpsCategories,
  expandCategoryTerms,
  evaluateDeepOperationalInvestigationQc,
  looksLikeInvalidOpsFallback,
  requiresDeepOperationalInvestigation,
  textMatchesOpsTerms,
} from "./deepOperationalInvestigation.ts"

Deno.test("deep ops guide covers search order + missing detail rule", () => {
  assertStringIncludes(DEEP_OPERATIONAL_INVESTIGATION_GUIDE, "Required search order")
  assertStringIncludes(DEEP_OPERATIONAL_INVESTIGATION_GUIDE, "Missing detail ≠ missing records")
  assertStringIncludes(DEEP_OPERATIONAL_INVESTIGATION_GUIDE, "Invalid fallbacks")
})

Deno.test("HVAC / plumbing synonym expansion", () => {
  const hvac = expandCategoryTerms("hvac")
  assertEquals(hvac.includes("thermostat"), true)
  assertEquals(hvac.includes("refrigerant"), true)
  const plumb = expandCategoryTerms("plumbing")
  assertEquals(plumb.includes("clogged"), true)
})

Deno.test("detect categories from natural language", () => {
  assertEquals(detectOpsCategories("Estimate the repair cost for the HVAC issues.").includes("hvac"), true)
  assertEquals(detectOpsCategories("Is the AC not cooling again?").includes("hvac"), true)
  assertEquals(detectOpsCategories("Toilet keeps clogging").includes("plumbing"), true)
})

Deno.test("repair cost questions require deep ops", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  assertEquals(requiresDeepOperationalInvestigation(q), true)
  const plan = classifyDeepOperationalInvestigation(q)
  assertEquals(plan.isRepairCostQuestion, true)
  assertEquals(plan.categories.includes("hvac"), true)
})

Deno.test("synonym match without exact HVAC word", () => {
  assertEquals(
    textMatchesOpsTerms("Unit AC blowing warm air, thermostat ok", expandCategoryTerms("hvac")),
    true,
  )
})

Deno.test("invalid fallback rejected when records exist", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  const bad =
    "I can only see high-level activity across your portfolio. I cannot fully answer yet."
  assertEquals(looksLikeInvalidOpsFallback(bad), true)
  const qc = evaluateDeepOperationalInvestigationQc({
    question: q,
    answer: bad,
    foundMatchingRecords: true,
  })
  assertEquals(qc.status, "fail")
})

Deno.test("finding-backed repair estimate passes", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  const good = `
The HVAC request at Unit 304 at Oakwood Apartments is the one I'd focus on first. Based on the reported cooling issue, the likely repair cost is between $250 and $900.

### What's going on
- **Unit:** 304
- **Issue:** AC not cooling
- **Existing estimate:** None

### Estimated cost
- Minor repair: **$150–$400**
- Moderate repair: **$400–$1,200**

### What I'd do next
Ask the assigned vendor for a diagnostic estimate.
`.trim()
  const qc = evaluateDeepOperationalInvestigationQc({
    question: q,
    answer: good,
    foundMatchingRecords: true,
  })
  assertEquals(qc.status, "pass", qc.summary)
})
