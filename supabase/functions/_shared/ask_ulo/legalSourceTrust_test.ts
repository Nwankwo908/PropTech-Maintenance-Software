/**
 * Legal source trust tier tests.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  assessLegalGrounding,
  isOfficialLegalSourceUrl,
} from "./legalJurisdiction.ts"
import {
  classifyLegalSourceTrust,
  sortByLegalSourceTrust,
} from "./legalSourceTrust.ts"

Deno.test("tier: legislature statute URL is primary_official", () => {
  const t = classifyLegalSourceTrust({
    url: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
    title: "Oregon Residential Landlord and Tenant Act — security deposits",
    citation: "ORS 90.300",
  })
  assertEquals(t.tier, "primary_official")
})

Deno.test("tier: HUD guidance page is agency_guidance", () => {
  const t = classifyLegalSourceTrust({
    url: "https://www.hud.gov/program_offices/fair_housing_equal_opp/reasonable_accommodations_and_modifications",
    title: "HUD — reasonable accommodations guidance (excerpt)",
    citation: "HUD FHEO guidance",
  })
  assertEquals(t.tier, "agency_guidance")
})

Deno.test("tier: CourtListener is discovery_mirror", () => {
  const t = classifyLegalSourceTrust({
    url: "https://www.courtlistener.com/opinion/123/ors-deposit/",
    title: "Some opinion mirror",
    citation: "ORS 90.300",
  })
  assertEquals(t.tier, "discovery_mirror")
})

Deno.test("tier: blog is untrusted", () => {
  const t = classifyLegalSourceTrust({
    url: "https://medium.com/@someone/landlord-tips",
    title: "Landlord tips",
  })
  assertEquals(t.tier, "untrusted")
  assertEquals(isOfficialLegalSourceUrl("https://medium.com/@someone/landlord-tips"), false)
})

Deno.test("sort prefers primary over mirror", () => {
  const ranked = sortByLegalSourceTrust([
    {
      sourceUrl: "https://www.courtlistener.com/x",
      sourceTitle: "Mirror",
      sourceCitation: "ORS 90.300",
      similarity: 0.99,
    },
    {
      sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
      sourceTitle: "ORS",
      sourceCitation: "ORS 90.300",
      similarity: 0.5,
    },
  ])
  assertEquals(ranked[0].sourceTitle, "ORS")
})

Deno.test("grounding refuses mirror-only citations", () => {
  const g = assessLegalGrounding({
    stateCode: "OR",
    cityLabel: "Portland",
    legalCitations: [
      {
        title: "Mirror",
        citation: "ORS 90.300",
        url: "https://www.courtlistener.com/opinion/1/",
      },
    ],
    structuredCitations: [],
    legalHitCount: 1,
    structuredRelevant: false,
  })
  assertEquals(g.grounded, false)
  assertEquals(g.reason, "mirror_only")
  assertEquals(g.verifyTargets.length >= 1, true)
  assertEquals(g.refusePrompt?.includes("oregonlegislature.gov") ?? false, true)
  assertEquals(g.refusePrompt?.includes("CourtListener") ?? false, true)
})

Deno.test("grounding accepts agency guidance without primary", () => {
  const g = assessLegalGrounding({
    stateCode: "OR",
    cityLabel: "Portland",
    legalCitations: [
      {
        title: "HUD FAQ handbook",
        citation: "HUD handbook",
        url: "https://www.hud.gov/topics/rental_assistance/faq",
      },
    ],
    structuredCitations: [],
    legalHitCount: 1,
    structuredRelevant: false,
  })
  assertEquals(g.grounded, true)
  assertEquals(g.reason, "agency_guidance_only")
  assertEquals(g.agencyGuidanceCount, 1)
})

Deno.test("grounding still accepts primary official", () => {
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
  assertEquals(g.primaryOfficialCount, 1)
})
