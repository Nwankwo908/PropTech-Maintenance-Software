/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { assessFaithfulness } from "./faithfulnessCheck.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"

const officialCite: AskUloCitation = {
  tool: "legal_rag",
  title: "Oregon Residential Landlord and Tenant Act — security deposits",
  url: "https://oregonlegislature.gov/bills_laws/ors/ors090.html",
  sourceTier: "primary_official",
}

Deno.test("faithfulness: refuse/clarify scores null (known unknown)", () => {
  const r = assessFaithfulness({
    intent: "legal",
    answer: "I need to know which city this property is in.",
    citations: [],
    gateStatus: "clarify",
    knownUnknown: true,
  })
  assertEquals(r.score, null)
})

Deno.test("faithfulness: hard claims without sources score low", () => {
  const r = assessFaithfulness({
    intent: "legal",
    answer:
      "You must return the deposit within 31 days. It is illegal to keep it longer. Landlords shall pay interest.",
    citations: [],
    gateStatus: "ok",
  })
  assertEquals(r.detail.unsupportedHardClaims, true)
  assertEquals((r.score ?? 1) < 0.3, true)
})

Deno.test("faithfulness: grounded answer with matching source scores higher", () => {
  const r = assessFaithfulness({
    intent: "legal",
    answer:
      "Under Oregon Residential Landlord and Tenant Act — security deposits, landlords generally must account for deposits. Source: oregonlegislature.gov.",
    citations: [officialCite],
    gateStatus: "ok",
  })
  assertEquals((r.score ?? 0) >= 0.5, true)
  assertEquals(r.detail.retrievedSourceCount, 1)
})

Deno.test("faithfulness: non-legal without hard claims is high", () => {
  const r = assessFaithfulness({
    intent: "maintenance",
    answer: "You have two open tickets at Oakwood that need vendor follow-up.",
    citations: [],
    gateStatus: null,
  })
  assertEquals(r.score, 1)
})
