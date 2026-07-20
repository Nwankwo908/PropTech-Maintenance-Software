/**
 * Failure tag extraction for Ask Ulo feedback loops.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  extractAskUloFailureTags,
  formatFailureTagsSummary,
} from "./failureTags.ts"

Deno.test("extractAskUloFailureTags: routing + incomplete + gate", () => {
  const tags = extractAskUloFailureTags([
    "intent:ops",
    "no_tool_matched",
    "catchall_fallback:none",
    "prefer_packet:incomplete_property_ranking:incomplete",
    "quality_gate:subject_match_block",
  ])
  assertEquals(tags.includes("no_tool_matched"), true)
  assertEquals(tags.includes("catchall_none"), true)
  assertEquals(tags.includes("incomplete_ranking"), true)
  assertEquals(tags.includes("property_ranking_incomplete"), true)
  assertEquals(tags.includes("quality_gate_block"), true)
  assertEquals(tags.includes("subject_gate_block"), true)
})

Deno.test("formatFailureTagsSummary", () => {
  assertEquals(formatFailureTagsSummary([]), null)
  assertEquals(
    formatFailureTagsSummary(["no_tool_matched", "honest_gap"]),
    "failures:[no_tool_matched,honest_gap]",
  )
})
