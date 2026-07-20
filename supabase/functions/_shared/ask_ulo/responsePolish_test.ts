/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  looksLikeClippedOpsText,
  looksLikeRetrievalMechanicsLeak,
  polishAskUloProse,
  RESPONSE_POLISH_GUIDE,
} from "./responsePolish.ts"
import { humanizeOpsLanguage } from "./reasoningTransparency.ts"

Deno.test("response polish guide requires insights-only + clip rewrite", () => {
  assertStringIncludes(RESPONSE_POLISH_GUIDE, "Never expose truncated")
  assertStringIncludes(RESPONSE_POLISH_GUIDE, "Insights only")
  assertStringIncludes(RESPONSE_POLISH_GUIDE, "What matters most")
})

Deno.test("polishAskUloProse rewrites UI-clipped fragments", () => {
  const bad =
    "No plumbing vendor available on roste. Assigned electrician declined — no other ele. HVAC ven missing. exp resp expired."
  assertEquals(looksLikeClippedOpsText(bad), true)
  const good = polishAskUloProse(bad)
  assertEquals(looksLikeClippedOpsText(good), false)
  assertStringIncludes(good.toLowerCase(), "roster")
  assertStringIncludes(good.toLowerCase(), "electrician")
  assertStringIncludes(good.toLowerCase(), "vendor")
  assertEquals(/\broste\b/i.test(good), false)
  assertEquals(/\bno other ele\b/i.test(good), false)
})

Deno.test("polishAskUloProse rewrites deadline jargon", () => {
  const s = polishAskUloProse(
    humanizeOpsLanguage("Kitchen clog: urgent priority — expected response time / due time already passed"),
  )
  assertStringIncludes(s.toLowerCase(), "vendor response deadline")
  assertEquals(/expected response time\s*\//i.test(s), false)
})

Deno.test("polishAskUloProse removes retrieval-mechanics phrasing", () => {
  const bad =
    "I found 19 matching records in scope. Operational evidence shows plumbing."
  assertEquals(looksLikeRetrievalMechanicsLeak(bad), true)
  const good = polishAskUloProse(bad)
  assertEquals(/\bI found 19 matching\b/i.test(good), false)
  assertEquals(/\bin scope\b/i.test(good), false)
  assertEquals(/\boperational evidence\b/i.test(good), false)
  assertEquals(looksLikeRetrievalMechanicsLeak(good), false)
})

Deno.test("polishAskUloProse renames What I found heading", () => {
  const s = polishAskUloProse("### What I found\n- Unit 304")
  assertStringIncludes(s, "### What's going on")
})
