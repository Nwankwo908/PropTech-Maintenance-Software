/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  levenshtein,
  matchShortReplyToken,
  maxEditDistanceForToken,
} from "./shortReplyTokens.ts"

Deno.test("levenshtein covers APPROVE transposition typos within ≤2", () => {
  // Aprrove → APPROVE: one substitution (R→P)
  assertEquals(levenshtein("APRROVE", "APPROVE"), 1)
  // Apporve → APPROVE: O/R transposition = 2 substitutions
  assertEquals(levenshtein("APPORVE", "APPROVE"), 2)
  assertEquals(levenshtein("DECLIEN", "DECLINE"), 2)
})

Deno.test("matchShortReplyToken accepts APPROVE typos within edit distance 2", () => {
  assertEquals(matchShortReplyToken("Aprrove", ["APPROVE", "APPROVED"]), "APPROVE")
  assertEquals(matchShortReplyToken("Apporve", ["APPROVE", "APPROVED"]), "APPROVE")
  assertEquals(matchShortReplyToken("APPROVE", ["APPROVE"]), "APPROVE")
  assertEquals(matchShortReplyToken("Declien", ["DECLINE", "DECLINED"]), "DECLINE")
})

Deno.test("matchShortReplyToken rejects unrelated phrases", () => {
  assertEquals(matchShortReplyToken("blue elephant", ["APPROVE", "DECLINE"]), null)
  assertEquals(
    matchShortReplyToken("please look at this estimate soon", ["APPROVE"]),
    null,
  )
})

Deno.test("short tokens use tighter max distance than APPROVE", () => {
  assertEquals(maxEditDistanceForToken("YES"), 1)
  assertEquals(maxEditDistanceForToken("APPROVE"), 2)
})
