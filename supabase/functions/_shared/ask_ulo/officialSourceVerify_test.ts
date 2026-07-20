/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  collectOfficialVerifyTargets,
  formatOfficialVerifyHint,
  isDiscoveryOnlySource,
  oregonOrsChapterUrl,
  partitionLegalCitations,
  resolveOfficialVerifyTarget,
} from "./officialSourceVerify.ts"

Deno.test("oregonOrsChapterUrl pads chapter", () => {
  assertEquals(
    oregonOrsChapterUrl(90),
    "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
  )
})

Deno.test("resolveOfficialVerifyTarget maps ORS section from CourtListener-style cite", () => {
  const t = resolveOfficialVerifyTarget({
    url: "https://www.courtlistener.com/opinion/123/",
    title: "Landlord entry",
    citation: "ORS 90.322",
  })
  assertEquals(t?.reason, "ors_statute")
  assertEquals(t?.url.includes("oregonlegislature.gov"), true)
  assertEquals(t?.citation, "ORS 90.322")
})

Deno.test("resolveOfficialVerifyTarget maps Portland Title", () => {
  const t = resolveOfficialVerifyTarget({
    url: "https://library.municode.com/or/portland/codes/code_of_ordinances",
    title: "Portland Title 29 Property Maintenance",
    citation: "Title 29",
  })
  assertEquals(t?.reason, "portland_city_code")
  assertEquals(t?.url.includes("portland.gov"), true)
})

Deno.test("CourtListener host is discovery-only", () => {
  assertEquals(
    isDiscoveryOnlySource({
      url: "https://www.courtlistener.com/opinion/1/",
      citation: "ORS 90.300",
    }),
    true,
  )
})

Deno.test("partition keeps legislature as authority and Municode as discovery", () => {
  const { authorities, discoveryOnly, verifyTargets } = partitionLegalCitations([
    {
      url: "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html",
      title: "ORS 90",
      citation: "ORS 90.300",
    },
    {
      url: "https://library.municode.com/or/portland/codes/code_of_ordinances",
      title: "Municode Portland",
      citation: "Title 29",
    },
  ])
  assertEquals(authorities.length, 1)
  assertEquals(discoveryOnly.length, 1)
  assertEquals(verifyTargets.length >= 1, true)
})

Deno.test("collectOfficialVerifyTargets dedupes by URL", () => {
  const targets = collectOfficialVerifyTargets([
    { citation: "ORS 90.300", url: "https://www.courtlistener.com/a" },
    { citation: "ORS 90.322", url: "https://www.courtlistener.com/b" },
  ])
  // Same chapter page
  assertEquals(targets.length, 1)
})

Deno.test("formatOfficialVerifyHint lists official URLs", () => {
  const hint = formatOfficialVerifyHint([
    {
      label: "Oregon Legislature — ORS 90.322",
      url: oregonOrsChapterUrl(90),
      citation: "ORS 90.322",
      reason: "ors_statute",
    },
  ])
  assertEquals(hint.includes("CourtListener"), true)
  assertEquals(hint.includes("oregonlegislature.gov"), true)
})
