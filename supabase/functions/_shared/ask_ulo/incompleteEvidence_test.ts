/**
 * Structured incomplete evidence — code owns gap messages.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildPropertyRankingIncompleteSignal,
  buildUnitRankingIncompleteSignal,
  rankingStatusFromFlags,
  resolveIncompleteRankingSignal,
} from "./incompleteEvidence.ts"

Deno.test("rankingStatusFromFlags: canRank maps to complete/incomplete", () => {
  assertEquals(rankingStatusFromFlags({ available: true, canRank: true }), "complete")
  assertEquals(rankingStatusFromFlags({ available: true, canRank: false }), "incomplete")
  assertEquals(rankingStatusFromFlags({ available: false, canRank: false }), "unavailable")
})

Deno.test("buildPropertyRankingIncompleteSignal: structured missing + no invented winner", () => {
  const signal = buildPropertyRankingIncompleteSignal({
    available: true,
    canRank: false,
    missingData: ["property assignments on open work orders"],
    portfolioOpenWorkOrders: 25,
    reasoningMode: "comparison_ranking",
  })
  assertEquals(signal?.status, "incomplete")
  assertEquals(signal?.kind, "property_ranking")
  assertEquals(signal?.known.openWorkOrders, 25)
  assertEquals(signal?.missing.some((m) => m.includes("properties")), true)
  assertEquals(Boolean(signal?.markdown.includes("What I know")), true)
  assertEquals(Boolean(signal?.markdown.includes("**25**")), true)
  // Must not invent a building winner
  assertEquals(/\bOakwood\b|\bMaple\b|Top priority:\s*\*\*/i.test(signal?.markdown ?? ""), false)
  assertEquals(/Do not invent/i.test(signal?.markdown ?? ""), false)
})

Deno.test("buildUnitRankingIncompleteSignal: uses request counts", () => {
  const signal = buildUnitRankingIncompleteSignal({
    available: true,
    canRank: false,
    missingData: ["unit assignments on maintenance requests"],
    requestCount: 12,
    unlinkedRequestCount: 12,
    timeframeLabel: "last 60 days",
    scopeLabel: "your portfolio",
  })
  assertEquals(signal?.status, "incomplete")
  assertEquals(signal?.known.requestCount, 12)
  assertEquals(Boolean(signal?.markdown.includes("**12**")), true)
})

Deno.test("resolveIncompleteRankingSignal: complete ranking → null", () => {
  assertEquals(
    resolveIncompleteRankingSignal({
      propertyRanking: {
        available: true,
        canRank: true,
        missingData: [],
        portfolioOpenWorkOrders: 3,
      },
    }),
    null,
  )
})

Deno.test("resolveIncompleteRankingSignal: prefer unit when requested", () => {
  const signal = resolveIncompleteRankingSignal({
    preferUnit: true,
    propertyRanking: {
      available: true,
      canRank: false,
      missingData: ["property assignments on open work orders"],
      portfolioOpenWorkOrders: 10,
    },
    unitMaintenanceRanking: {
      available: true,
      canRank: false,
      missingData: ["unit assignments on maintenance requests"],
      requestCount: 5,
      unlinkedRequestCount: 5,
    },
  })
  assertEquals(signal?.kind, "unit_maintenance_ranking")
})
