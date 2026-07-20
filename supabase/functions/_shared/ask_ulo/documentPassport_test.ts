import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inferDocumentType,
  passesDocumentTypeFilter,
  passesHousingProgramFilter,
  passportFromChunkRow,
  isAnswerableAuthorityTier,
} from "./documentPassport.ts"

Deno.test("passesHousingProgramFilter excludes program-only when no filter", () => {
  assertEquals(passesHousingProgramFilter(null, null), true)
  assertEquals(passesHousingProgramFilter("section_8_hcv", null), false)
})

Deno.test("passesHousingProgramFilter includes general + matching program", () => {
  assertEquals(passesHousingProgramFilter(null, "section_8_hcv"), true)
  assertEquals(passesHousingProgramFilter("section_8_hcv", "section_8_hcv"), true)
  assertEquals(passesHousingProgramFilter("lihtc", "section_8_hcv"), false)
})

Deno.test("passesDocumentTypeFilter allow-list", () => {
  assertEquals(passesDocumentTypeFilter("statute", null), true)
  assertEquals(passesDocumentTypeFilter("statute", ["statute", "municipal_code"]), true)
  assertEquals(passesDocumentTypeFilter("court_opinion", ["statute"]), false)
  assertEquals(passesDocumentTypeFilter(null, ["statute"]), false)
})

Deno.test("inferDocumentType from legacy family/domain", () => {
  assertEquals(
    inferDocumentType({ sourceFamily: "court_decisions" }),
    "court_opinion",
  )
  assertEquals(
    inferDocumentType({ sourceFamily: "state_statute", domain: "landlord_tenant" }),
    "statute",
  )
  assertEquals(
    inferDocumentType({ housingProgram: "section_8_hcv" }),
    "housing_program_rule",
  )
  assertEquals(
    inferDocumentType({ domain: "building_code" }),
    "building_code",
  )
})

Deno.test("passportFromChunkRow builds ID card", () => {
  const p = passportFromChunkRow({
    document_type: "statute",
    publisher_name: "Oregon Legislative Assembly",
    publisher_kind: "legislature",
    authority_tier: "primary_official",
    normative_type: "requirement",
    country_code: "us",
    state_code: "OR",
    city_slug: null,
    county_slug: "multnomah",
    housing_program: null,
    source_citation: "ORS 90.300",
    source_url: "https://www.oregonlegislature.gov/",
    effective_on: "2024-01-01",
    last_updated_on: "2025-06-01",
    domain: "landlord_tenant",
    metadata: { source_family: "state_statute" },
  })
  assertEquals(p.documentType, "statute")
  assertEquals(p.publisherName, "Oregon Legislative Assembly")
  assertEquals(p.authorityTier, "primary_official")
  assertEquals(p.countryCode, "US")
  assertEquals(p.citation, "ORS 90.300")
  assertEquals(p.lastUpdatedOn, "2025-06-01")
  assertEquals(p.refreshCadence, "daily")
  assertEquals(isAnswerableAuthorityTier(p.authorityTier), true)
})
