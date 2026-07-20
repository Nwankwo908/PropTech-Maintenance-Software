import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  assessLegalGrounding,
  codeSetForQuestion,
  courtSystemFor,
  formatJurisdictionPlaceLabel,
  housingProgramFromQuestion,
  isOfficialLegalSourceUrl,
  resolveLegalJurisdiction,
} from "./legalJurisdiction.ts"
import type { PortfolioJurisdiction } from "./portfolioContext.ts"

const emptyPortfolio = (): PortfolioJurisdiction => ({
  stateCode: null,
  citySlug: null,
  cityLabel: null,
  buildingCount: 0,
  sampleBuildings: [],
  locationSource: "none",
})

Deno.test("legal: named property resolves Hillsboro OR with Washington County", () => {
  const r = resolveLegalJurisdiction({
    question: "What is the security deposit limit for Maple Heights?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.needsClarification, false)
  assertEquals(r.stateCode, "OR")
  assertEquals(r.cityLabel, "Hillsboro")
  assertEquals(r.countyLabel, "Washington")
  assertEquals(r.countySlug, "washington")
  assertEquals(r.countryCode, "US")
  assertStringIncludes(r.courtSystem ?? "", "Washington County")
  assertEquals(r.source, "named_property")
  assertEquals(r.confidence, "high")
})

Deno.test("legal: explicit Oregon in question resolves without property", () => {
  const r = resolveLegalJurisdiction({
    question: "What is the security deposit limit in Oregon?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.needsClarification, false)
  assertEquals(r.stateCode, "OR")
  assertEquals(r.countryCode, "US")
  assertEquals(r.source, "question_explicit")
})

Deno.test("legal: Washington County resolves to Oregon not WA state", () => {
  const r = resolveLegalJurisdiction({
    question: "What is the late fee rule in Washington County?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.needsClarification, false)
  assertEquals(r.stateCode, "OR")
  assertEquals(r.countyLabel, "Washington")
})

Deno.test("legal: Multnomah County + habitability sets court and code set", () => {
  const r = resolveLegalJurisdiction({
    question: "What housing code applies for habitability in Multnomah County Portland?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.needsClarification, false)
  assertEquals(r.stateCode, "OR")
  assertEquals(r.countyLabel, "Multnomah")
  assertEquals(r.cityLabel, "Portland")
  assertStringIncludes(r.courtSystem ?? "", "Multnomah")
  assertStringIncludes(r.codeSet ?? "", "IPMC")
})

Deno.test("legal: Section 8 question tags housing program", () => {
  const r = resolveLegalJurisdiction({
    question: "What are my Section 8 HCV obligations in Portland Oregon?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.housingProgram, "section_8_hcv")
  assertEquals(r.cityLabel, "Portland")
  assertEquals(r.countyLabel, "Multnomah")
})

Deno.test("legal: unknown location asks for clarification", () => {
  const r = resolveLegalJurisdiction({
    question: "What notice do I need to give for eviction?",
    portfolio: emptyPortfolio(),
  })
  assertEquals(r.needsClarification, true)
  assertEquals(r.stateCode, null)
  assertStringIncludes(r.clarificationPrompt ?? "", "located")
})

Deno.test("legal: multi-state portfolio asks which property", () => {
  const r = resolveLegalJurisdiction({
    question: "What is the late fee cap?",
    portfolio: {
      stateCode: "OR",
      citySlug: "portland",
      cityLabel: "Portland",
      buildingCount: 2,
      sampleBuildings: ["Maple Heights", "Seattle Tower"],
      locationSource: "onboarding_properties",
    },
  })
  assertEquals(r.needsClarification, true)
  assertEquals(r.stateCode, null)
  assertStringIncludes(r.clarificationPrompt ?? "", "more than one state")
})

Deno.test("legal: unambiguous single-state portfolio is allowed", () => {
  const r = resolveLegalJurisdiction({
    question: "What is the security deposit limit?",
    portfolio: {
      stateCode: "OR",
      citySlug: "portland",
      cityLabel: "Portland",
      buildingCount: 3,
      sampleBuildings: ["Maple Heights", "Oakwood Apartments"],
      locationSource: "onboarding_properties",
    },
  })
  assertEquals(r.needsClarification, false)
  assertEquals(r.stateCode, "OR")
  assertEquals(r.countyLabel, "Multnomah")
  assertEquals(r.source, "portfolio_unambiguous")
})

Deno.test("official .gov urls are recognized", () => {
  assertEquals(isOfficialLegalSourceUrl("https://www.oregonlegislature.gov/bills_laws/ors/ors090.html"), true)
  assertEquals(isOfficialLegalSourceUrl("https://www.hud.gov/fairhousing"), true)
  assertEquals(isOfficialLegalSourceUrl("https://example.com/blog"), false)
  assertEquals(isOfficialLegalSourceUrl(null), false)
})

Deno.test("legal grounding refuses with no hits", () => {
  const g = assessLegalGrounding({
    stateCode: "OR",
    cityLabel: "Portland",
    legalCitations: [],
    structuredCitations: [],
    legalHitCount: 0,
    structuredRelevant: false,
  })
  assertEquals(g.grounded, false)
  assertStringIncludes(g.refusePrompt ?? "", "human")
})

Deno.test("legal grounding accepts official citation", () => {
  const g = assessLegalGrounding({
    stateCode: "OR",
    cityLabel: "Portland",
    legalCitations: [
      {
        title: "ORS 90.300",
        citation: "ORS 90.300",
        url: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
      },
    ],
    structuredCitations: [],
    legalHitCount: 1,
    structuredRelevant: false,
  })
  assertEquals(g.grounded, true)
  assertEquals(g.officialSourceCount, 1)
  assertEquals(g.primaryOfficialCount, 1)
})

Deno.test("legal grounding refuses blog-only citations", () => {
  const g = assessLegalGrounding({
    stateCode: "OR",
    cityLabel: "Portland",
    legalCitations: [
      {
        title: "Blog summary",
        citation: "some blog",
        url: "https://example.com/blog/deposits",
      },
    ],
    structuredCitations: [],
    legalHitCount: 1,
    structuredRelevant: false,
  })
  assertEquals(g.grounded, false)
  assertEquals(g.reason, "no_official_sources")
})

Deno.test("formatJurisdictionPlaceLabel includes county", () => {
  assertEquals(
    formatJurisdictionPlaceLabel({
      cityLabel: "Portland",
      countyLabel: "Multnomah",
      stateCode: "OR",
      countryCode: "US",
    }),
    "Portland, Multnomah County, OR",
  )
})

Deno.test("codeSetForQuestion returns Portland housing code for habitability", () => {
  assertStringIncludes(
    codeSetForQuestion("Is the unit habitability code compliant?", "Portland") ?? "",
    "Title 29",
  )
  assertEquals(codeSetForQuestion("What is the deposit limit?", "Portland"), null)
})

Deno.test("housingProgramFromQuestion detects Section 8", () => {
  assertEquals(housingProgramFromQuestion("Section 8 inspection tomorrow"), "section_8_hcv")
  assertEquals(housingProgramFromQuestion("late fee cap"), null)
})

Deno.test("courtSystemFor builds Multnomah circuit label", () => {
  assertEquals(
    courtSystemFor("OR", "Multnomah"),
    "Oregon Circuit Court (Multnomah County)",
  )
})
