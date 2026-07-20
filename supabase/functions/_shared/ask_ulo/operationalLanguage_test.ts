/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatLastAssigned,
  formatRelativeDaysAgo,
  humanizeOperationalProse,
  looksLikeOperationalJargon,
} from "./operationalLanguage.ts"
import { polishAskUloProse } from "./responsePolish.ts"

Deno.test("formatRelativeDaysAgo uses natural phrasing", () => {
  assertEquals(formatRelativeDaysAgo(0), "today")
  assertEquals(formatRelativeDaysAgo(1), "yesterday")
  assertEquals(formatRelativeDaysAgo(3), "about 3 days ago")
  assertEquals(formatLastAssigned(0), "assigned today")
  assertEquals(formatLastAssigned(1), "assigned yesterday")
  assertEquals(formatLastAssigned(3), "last assigned about 3 days ago")
})

Deno.test("humanizeOperationalProse rewrites status and time jargon", () => {
  const bad =
    "2 jobs waiting on accept · last assigned ~0d ago. pending accept. vendor_assigned. in_progress. review_required. expected response time expired."
  assertEquals(looksLikeOperationalJargon(bad), true)
  const good = humanizeOperationalProse(bad)
  assertEquals(looksLikeOperationalJargon(good), false)
  assertStringIncludes(good, "waiting for the vendor to accept")
  assertStringIncludes(good.toLowerCase(), "assigned today")
  assertStringIncludes(good.toLowerCase(), "hasn't responded yet")
  assertStringIncludes(good.toLowerCase(), "work is currently underway")
  assertStringIncludes(good.toLowerCase(), "waiting for your approval")
  assertStringIncludes(good.toLowerCase(), "vendor response deadline has passed")
})

Deno.test("humanizeOperationalProse strips retrieval voice", () => {
  const bad =
    "I'm listing vendors with open pending accept jobs — not a portfolio health briefing.\n\nBased on the records, Acme is slow."
  const good = humanizeOperationalProse(bad)
  assertEquals(/\bI'?m\s+listing\b/i.test(good), false)
  assertEquals(/\bpending accept\b/i.test(good), false)
  assertStringIncludes(good, "Acme")
})

Deno.test("polishAskUloProse includes operational language pass", () => {
  const s = polishAskUloProse("Vendor still waiting on accept · ~1d ago")
  assertEquals(/\bwaiting on accept\b/i.test(s), false)
  assertStringIncludes(s.toLowerCase(), "yesterday")
})
