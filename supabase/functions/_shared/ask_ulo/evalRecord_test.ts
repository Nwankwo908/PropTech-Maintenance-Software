/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  estimateAskUloCostUsd,
  estimateTokensFromText,
  extractAskUloFailureTags,
  parseHumanOverrideReason,
} from "./evalRecord.ts"

Deno.test("estimateTokensFromText scales with length", () => {
  assertEquals(estimateTokensFromText(""), 0)
  assertEquals(estimateTokensFromText("abcd"), 1)
  assertEquals(estimateTokensFromText("a".repeat(40)), 10)
})

Deno.test("estimateAskUloCostUsd uses model pricing", () => {
  const cost = estimateAskUloCostUsd({
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    embedTokens: 1_000_000,
  })
  // 2.5 + 10 + 0.02
  assertEquals(cost, 12.52)
})

Deno.test("parseHumanOverrideReason accepts known reasons", () => {
  assertEquals(parseHumanOverrideReason("wrong_location"), "wrong_location")
  assertEquals(parseHumanOverrideReason("nope"), null)
})

Deno.test("extractAskUloFailureTags re-exported", () => {
  assertEquals(
    extractAskUloFailureTags(["no_tool_matched"]).includes("no_tool_matched"),
    true,
  )
})
