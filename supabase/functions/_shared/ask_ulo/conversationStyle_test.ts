/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  ANTI_SLOP_STYLE_GUIDE,
  CONVERSATION_STYLE_GUIDE,
  trailingStyleConstraints,
} from "./conversationStyle.ts"

Deno.test("conversation style guide bans report openings", () => {
  assertStringIncludes(CONVERSATION_STYLE_GUIDE, "Start naturally")
  assertStringIncludes(CONVERSATION_STYLE_GUIDE, "Visual hierarchy")
  assertStringIncludes(CONVERSATION_STYLE_GUIDE, "Tell the story first")
  assertEquals(/Quick Answer/.test(CONVERSATION_STYLE_GUIDE), true)
  assertEquals(/under 15 seconds/.test(CONVERSATION_STYLE_GUIDE), true)
})

Deno.test("anti-slop guide bans filler and corporate phrases", () => {
  assertStringIncludes(ANTI_SLOP_STYLE_GUIDE, "Certainly")
  assertStringIncludes(ANTI_SLOP_STYLE_GUIDE, "delve")
  assertStringIncludes(ANTI_SLOP_STYLE_GUIDE, "As an AI")
})

Deno.test("trailing style constraints put anti-slop before positive style", () => {
  const trailing = trailingStyleConstraints()
  const antiIdx = trailing.indexOf("Style & communication constraints")
  const styleIdx = trailing.indexOf("Communication style (critical)")
  assertEquals(antiIdx >= 0, true)
  assertEquals(styleIdx > antiIdx, true)
})
