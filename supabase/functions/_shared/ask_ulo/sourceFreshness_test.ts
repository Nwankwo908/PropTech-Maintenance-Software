/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  formatIncentivesFreshnessFooter,
  formatLegalFreshnessLines,
  isStale,
  LEGAL_STALENESS_DAYS,
} from "./sourceFreshness.ts"
import { buildToolMissIncompleteSignal } from "./incompleteEvidence.ts"

Deno.test("freshness: stale when older than threshold", () => {
  assertEquals(isStale("2020-01-01", 180, new Date("2026-07-18")), true)
  assertEquals(isStale("2026-07-01", 180, new Date("2026-07-18")), false)
})

Deno.test("freshness: legal lines include verify caveat when stale", () => {
  const lines = formatLegalFreshnessLines({
    currencyDate: "2020-06-01",
    now: new Date("2026-07-18"),
  })
  assertStringIncludes(lines.join("\n"), "Information current as of")
  assertStringIncludes(lines.join("\n"), String(LEGAL_STALENESS_DAYS))
  assertStringIncludes(lines.join("\n"), "verify")
})

Deno.test("freshness: incentives footer includes catalog as of", () => {
  const footer = formatIncentivesFreshnessFooter({ now: new Date("2026-07-18") })
  assertStringIncludes(footer, "Catalog as of")
  assertStringIncludes(footer, "Source currency")
})

Deno.test("tool miss incomplete is code-owned 3-part gap", () => {
  const signal = buildToolMissIncompleteSignal({
    noToolMatched: true,
    catchallNone: false,
    subject: "other",
    openWorkOrders: 12,
  })
  assertEquals(signal?.kind, "tool_miss")
  assertStringIncludes(signal?.markdown ?? "", "What I know")
  assertStringIncludes(signal?.markdown ?? "", "**12**")
  assertEquals(/do not invent/i.test(signal?.markdown ?? ""), false)
})
