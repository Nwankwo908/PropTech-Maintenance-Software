/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { passportFromChunkRow } from "./documentPassport.ts"
import {
  expandLegalQueryForKeyword,
  fuseLegalHitsRrf,
  type LegalRagHit,
} from "./legalRagSearch.ts"

function hit(id: string, title = id): LegalRagHit {
  return {
    id,
    sourceTitle: title,
    sourceCitation: null,
    sourceUrl: "https://oregonlegislature.gov/bills_laws/ors/ors090.html",
    chunkText: "sample",
    domain: "landlord_tenant",
    similarity: null,
    publicationStatus: "published_code",
    normativeType: "requirement",
    effectiveOn: null,
    jurisdictionLevel: "state",
    stateCode: "OR",
    citySlug: null,
    countySlug: null,
    passport: passportFromChunkRow({
      document_type: "statute",
      publisher_name: "Oregon Legislative Assembly",
      publisher_kind: "legislature",
      authority_tier: "primary_official",
      normative_type: "requirement",
      country_code: "US",
      state_code: "OR",
      domain: "landlord_tenant",
      source_url: "https://oregonlegislature.gov/bills_laws/ors/ors090.html",
    }),
  }
}

Deno.test("expandLegalQueryForKeyword bridges security deposit to disposition language", () => {
  const q = "How long do I have to return a security deposit?"
  const expanded = expandLegalQueryForKeyword(q)
  assertEquals(expanded.includes("deposit disposition"), true)
  assertEquals(expanded.includes("return of funds"), true)
  assertEquals(expanded.includes("ORS 90.300"), true)
})

Deno.test("expandLegalQueryForKeyword leaves unrelated questions alone", () => {
  const q = "What is the weather in Portland?"
  assertEquals(expandLegalQueryForKeyword(q), q)
})

Deno.test("fuseLegalHitsRrf prefers hits present in both channels", () => {
  const vector = [hit("a"), hit("b"), hit("c")]
  const keyword = [hit("c"), hit("d"), hit("a")]
  const fused = fuseLegalHitsRrf(vector, keyword, 4)
  const topTwo = fused.slice(0, 2).map((h) => h.id).sort()
  assertEquals(topTwo, ["a", "c"])
  for (const id of ["a", "c"]) {
    const row = fused.find((h) => h.id === id)
    assertEquals(row?.retrievalChannels?.includes("vector"), true)
    assertEquals(row?.retrievalChannels?.includes("keyword"), true)
  }
  assertEquals(fused.map((h) => h.id).includes("b"), true)
})

Deno.test("fuseLegalHitsRrf works with a single channel", () => {
  const fused = fuseLegalHitsRrf([hit("only")], [], 3)
  assertEquals(fused.length, 1)
  assertEquals(fused[0]?.id, "only")
  assertEquals(fused[0]?.retrievalChannels, ["vector"])
})
