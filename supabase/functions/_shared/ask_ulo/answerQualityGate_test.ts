/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  evaluateAnswerSafetyQc,
  plannedToolNames,
  runAnswerQualityGate,
} from "./answerQualityGate.ts"
import type { LegalJurisdictionResolution } from "./legalJurisdiction.ts"

function baseJurisdiction(
  overrides: Partial<LegalJurisdictionResolution> = {},
): LegalJurisdictionResolution {
  return {
    countryCode: "US",
    stateCode: "OR",
    countySlug: "multnomah",
    countyLabel: "Multnomah",
    citySlug: "portland",
    cityLabel: "Portland",
    buildingName: null,
    courtSystem: "oregon_courts",
    housingProgram: null,
    codeSet: null,
    confidence: "high",
    needsClarification: false,
    clarificationPrompt: null,
    source: "question_explicit",
    ...overrides,
  }
}

Deno.test("quality gate passes when location, sources, and grounding are solid", () => {
  const report = runAnswerQualityGate({
    intent: "legal",
    intentLabel: "Legal",
    toolsPlanned: ["legal_rag", "structured"],
    jurisdiction: baseJurisdiction(),
    needsPropertyScope: false,
    stateCode: "OR",
    citySlug: "portland",
    housingProgram: null,
    ranLegalSearch: true,
    ranTopicTools: true,
    primaryOfficial: 2,
    agencyGuidance: 0,
    discoveryMirror: 0,
    untrusted: 0,
    citationCount: 2,
    pendingOrdinanceCount: 0,
    gateStatus: "ok",
    grounded: true,
    groundingReason: null,
    officialSourceCount: 2,
    draftAnswer: "Under ORS 90.300, landlords generally must return deposits within 31 days.",
  })
  assertEquals(report.mayAnswer, true)
  assertEquals(report.block, null)
  assertEquals(report.checks.find((c) => c.id === "location")?.status, "pass")
  assertEquals(report.checks.find((c) => c.id === "topic")?.status, "pass")
  assertEquals(report.checks.find((c) => c.id === "scope")?.status, "pass")
  assertEquals(report.checks.find((c) => c.id === "sources")?.status, "pass")
  assertEquals(report.checks.find((c) => c.id === "grounding")?.status, "pass")
  assertEquals(report.checks.find((c) => c.id === "safety_qc")?.status, "pass")
})

Deno.test("quality gate fails location when clarification needed", () => {
  const report = runAnswerQualityGate({
    intent: "legal",
    intentLabel: "Legal",
    toolsPlanned: ["legal_rag"],
    jurisdiction: baseJurisdiction({
      stateCode: null,
      needsClarification: true,
      confidence: "none",
      source: "unknown",
    }),
    needsPropertyScope: false,
    stateCode: null,
    citySlug: null,
    housingProgram: null,
    ranLegalSearch: false,
    ranTopicTools: false,
    primaryOfficial: 0,
    agencyGuidance: 0,
    discoveryMirror: 0,
    untrusted: 0,
    citationCount: 0,
    pendingOrdinanceCount: 0,
    gateStatus: "clarify",
    grounded: false,
    groundingReason: "missing_jurisdiction",
    officialSourceCount: 0,
  })
  assertEquals(report.mayAnswer, false)
  assertEquals(report.block, "clarify")
  assertEquals(report.checks.find((c) => c.id === "location")?.status, "fail")
})

Deno.test("quality gate refuses mirror-only sources", () => {
  const report = runAnswerQualityGate({
    intent: "legal",
    intentLabel: "Legal",
    toolsPlanned: ["legal_rag"],
    jurisdiction: baseJurisdiction(),
    needsPropertyScope: false,
    stateCode: "OR",
    citySlug: "portland",
    housingProgram: null,
    ranLegalSearch: true,
    ranTopicTools: true,
    primaryOfficial: 0,
    agencyGuidance: 0,
    discoveryMirror: 3,
    untrusted: 0,
    citationCount: 3,
    pendingOrdinanceCount: 0,
    gateStatus: "refuse",
    grounded: false,
    groundingReason: "mirror_only",
    officialSourceCount: 0,
  })
  assertEquals(report.mayAnswer, false)
  assertEquals(report.block, "refuse")
  assertEquals(report.checks.find((c) => c.id === "sources")?.status, "fail")
  assertEquals(report.checks.find((c) => c.id === "grounding")?.status, "fail")
})

Deno.test("safety QC fails hard legal claims without citations", () => {
  const qc = evaluateAnswerSafetyQc({
    intent: "legal",
    answer: "You must always do this; it is illegal otherwise.",
    citationCount: 0,
    gateStatus: "ok",
  })
  assertEquals(qc.status, "fail")
})

Deno.test("plannedToolNames lists topic tools", () => {
  const names = plannedToolNames({
    runLegalRag: true,
    runStructured: true,
    runOpsGraph: false,
    runPropertySnapshot: true,
    runMarketData: false,
    runPriceHistory: false,
    runRentHistory: false,
  })
  assertEquals(names.includes("legal_rag"), true)
  assertEquals(names.includes("property_snapshot"), true)
  assertEquals(names.includes("market_data"), false)
})
