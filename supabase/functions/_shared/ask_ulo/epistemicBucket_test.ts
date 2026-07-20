/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyEpistemicAsk,
  resolveEpistemicOutcome,
} from "./epistemicBucket.ts"

Deno.test("epistemic: external vendor discovery classifies bucket 1", () => {
  const c = classifyEpistemicAsk({
    question: "Find a local plumber outside my network near Oakwood",
    subject: "vendor",
    capability: "recommend",
  })
  assertEquals(c.classified_bucket, "external_vendor")
  assertEquals(c.matched_rule, "vendor_external_discovery")
  assertEquals(c.confidence, "high")
})

Deno.test("epistemic: market rent classifies allowlisted_facts", () => {
  const c = classifyEpistemicAsk({
    question: "What could I charge for rent near my properties?",
    subject: "market_intelligence",
    capability: "search",
  })
  assertEquals(c.classified_bucket, "allowlisted_facts")
  assertEquals(c.matched_rule, "market_intelligence")
})

Deno.test("epistemic: compound vendor+market keeps secondary market signal", () => {
  const c = classifyEpistemicAsk({
    question:
      "Find a plumber outside my roster and tell me if their quote is a fair rate",
    subject: "vendor",
    capability: "recommend",
  })
  assertEquals(c.classified_bucket, "external_vendor")
  assertEquals(c.secondary_signals.includes("market_intelligence"), true)
})

Deno.test("epistemic: outcome marks internal_unmatched on no_tool_matched", () => {
  const ask = classifyEpistemicAsk({
    question: "How are things going?",
    subject: "other",
    capability: "search",
  })
  const out = resolveEpistemicOutcome({
    ask,
    specialtyPacket: false,
    noToolMatched: true,
    catchallAttempted: true,
    catchallFound: false,
  })
  assertEquals(out.classified_bucket, "internal_unmatched")
  assertEquals(out.fallback_reason, "no_tool_matched")
})

Deno.test("epistemic: policy boundary", () => {
  const c = classifyEpistemicAsk({
    question: "File the eviction for me now",
    subject: "legal",
    capability: "legal_lookup",
    policyBlocked: true,
  })
  assertEquals(c.classified_bucket, "policy_boundary")
})
