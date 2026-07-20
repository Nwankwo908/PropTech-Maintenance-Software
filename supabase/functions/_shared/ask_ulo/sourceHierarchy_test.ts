import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  assessAnswerConfidence,
  buildSourcesUsed,
  classifyCitationHierarchy,
  hierarchyPrioritiesForIntent,
  legalPlaceRank,
  SOURCE_HIERARCHY,
} from "./sourceHierarchy.ts"

Deno.test("SOURCE_HIERARCHY covers priorities 1–9", () => {
  assertEquals(SOURCE_HIERARCHY.length, 9)
  assertEquals(
    SOURCE_HIERARCHY.map((s) => s.priority),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
})

Deno.test("legal intent prefers law before FAQs", () => {
  const p = hierarchyPrioritiesForIntent("legal")
  assertEquals(p[0], 1)
  assertEquals(p.includes(9), true)
  assertEquals(p.includes(6), false)
})

Deno.test("legalPlaceRank prefers city over state over federal", () => {
  assertEquals(
    legalPlaceRank({ jurisdictionLevel: "city", citySlug: "portland" }) <
      legalPlaceRank({ jurisdictionLevel: "state", stateCode: "OR" }),
    true,
  )
  assertEquals(
    legalPlaceRank({ jurisdictionLevel: "state", stateCode: "OR" }) <
      legalPlaceRank({ jurisdictionLevel: "federal" }),
    true,
  )
})

Deno.test("classifyCitationHierarchy maps statutes vs HUD guidance", () => {
  const statute = classifyCitationHierarchy({
    title: "Oregon Residential Landlord and Tenant Act",
    citation: "ORS 90.300",
    url: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
  })
  assertEquals(statute.priority, 1)
  assertEquals(statute.kind, "requirement")

  const hud = classifyCitationHierarchy({
    title: "HUD Housing Choice Voucher Handbook",
    url: "https://www.hud.gov/program_offices/public_indian_housing/programs/hcv",
    domain: "housing",
  })
  assertEquals(hud.priority, 4)
  assertEquals(hud.kind, "guidance")
})

Deno.test("assessAnswerConfidence escalates on requireCounsel", () => {
  assertEquals(
    assessAnswerConfidence({
      intent: "legal",
      requireCounsel: true,
      primaryOfficialCount: 3,
      agencyGuidanceCount: 0,
    }),
    "escalate",
  )
  assertEquals(
    assessAnswerConfidence({
      intent: "legal",
      requireCounsel: false,
      primaryOfficialCount: 2,
      agencyGuidanceCount: 0,
    }),
    "high",
  )
  assertEquals(
    assessAnswerConfidence({
      intent: "legal",
      requireCounsel: false,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 1,
    }),
    "medium",
  )
  assertEquals(
    assessAnswerConfidence({
      intent: "legal",
      gateStatus: "clarify",
      requireCounsel: false,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
    }),
    "low",
  )
})

Deno.test("buildSourcesUsed lists external law before portfolio", () => {
  const items = buildSourcesUsed({
    citations: [
      {
        tool: "legal_rag",
        title: "ORS Chapter 90",
        citation: "ORS 90.427",
        url: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
      },
      {
        tool: "ops_graph",
        title: "Open maintenance",
      },
    ],
    propertyBuildingName: "Maple Heights",
    hasOpsContext: true,
    housingProgram: "section_8_hcv",
    jurisdictionLabel: "Hillsboro, Washington County, OR",
  })
  assertEquals(items[0].label.includes("ORS"), true)
  assertEquals(items.some((i) => i.label.includes("Maple Heights")), true)
  assertEquals(items.some((i) => i.family === "housing_authority"), true)
  const lawIdx = items.findIndex((i) => i.priority === 1)
  const portfolioIdx = items.findIndex((i) => i.kind === "portfolio")
  assertEquals(lawIdx >= 0 && portfolioIdx > lawIdx, true)
})
