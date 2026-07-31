/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { checkAnswerFaithfulness } from "../../quality/checkFaithfulness.ts"
import { checkAnswerCompleteness } from "../../quality/checkCompleteness.ts"
import { checkAnswerJurisdiction } from "../../quality/checkJurisdiction.ts"
import { checkAnswerPrivacy } from "../../quality/checkPrivacy.ts"
import { checkAnswerConfidence } from "../../quality/checkConfidence.ts"
import {
  formatPostAnswerFailClosedMarkdown,
  runPostAnswerQualityChecks,
} from "../../quality/runPostAnswerChecks.ts"
import type { AskUloEvidencePacket } from "../../retrieval/buildEvidencePacket.ts"

const packetWithRent: AskUloEvidencePacket = {
  internal: [
    {
      id: "r1",
      channel: "internal",
      source: "users.balance_due",
      label: "Jordan Lee",
      excerpt: "$1,250 due · 14d overdue",
      asOf: "2026-07-19",
      stale: false,
      strength: 80,
    },
  ],
  legal: [],
  market: [],
  missing: [],
  meta: {
    asOf: "2026-07-19",
    jurisdiction: { stateCode: "OR", cityLabel: "Portland" },
    subject: "resident",
    capability: "search",
    hasEvidence: true,
    staleCount: 0,
    toolExecutions: [],
  },
}

Deno.test("faithfulness fail-closed on legal hard claims without sources", () => {
  const r = checkAnswerFaithfulness({
    intent: "legal",
    answer: "You must return the deposit within 31 days. It is illegal to keep it longer.",
    citations: [],
    hasEvidence: false,
    gateStatus: "ok",
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.block, "refuse")
})

Deno.test("completeness fail-closed when overstating uncertainty with evidence", () => {
  const r = checkAnswerCompleteness({
    question: "Which tenants are late on rent?",
    answer: "I don't have enough information in the system to answer that.",
    hasEvidence: true,
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.reasons.includes("overstated_uncertainty_with_evidence"), true)
})

Deno.test("jurisdiction fail-closed on wrong property when scoped", () => {
  const r = checkAnswerJurisdiction({
    intent: "ops",
    answer: "At Oakwood Apartments, three units need attention first.",
    stateCode: "OR",
    buildingFilter: "Maple Heights",
    portfolioBuildings: ["Maple Heights", "Oakwood Apartments"],
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.reasons.some((x) => x.startsWith("wrong_property:")), true)
})

Deno.test("jurisdiction fail-closed on foreign landlord uuid", () => {
  const r = checkAnswerJurisdiction({
    intent: "ops",
    answer: "Resident 11111111-1111-4111-8111-111111111111 is late.",
    landlordId: "22222222-2222-4222-8222-222222222222",
    portfolioBuildings: ["Maple Heights"],
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.reasons.includes("foreign_uuid_in_answer"), true)
})

Deno.test("runPostAnswerQualityChecks pass for grounded ops answer", () => {
  const r = runPostAnswerQualityChecks({
    question: "Which tenants are late on rent at Maple Heights?",
    answer:
      "Jordan Lee at Maple Heights is late — about $1,250 due and 14 days overdue. I'd start with a payment check-in.",
    intent: "ops",
    citations: [],
    evidencePacket: packetWithRent,
    buildingFilter: "Maple Heights",
    portfolioBuildings: ["Maple Heights", "Oakwood Apartments"],
    stateCode: "OR",
    cityLabel: "Portland",
  })
  assertEquals(r.failClosed, false)
  assertEquals(r.pass, true)
})

Deno.test("privacy fail-closed on SSN in answer", () => {
  const r = checkAnswerPrivacy({
    answer: "Resident SSN is 123-45-6789 — do not share this.",
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.reasons.some((x) => x.startsWith("pii_leak:")), true)
})

Deno.test("confidence fail-closed on absolute legal claim without citation", () => {
  const r = checkAnswerConfidence({
    intent: "legal",
    answer: "It is illegal to keep the deposit. You are required by law to return it tomorrow.",
    hasEvidence: false,
    citationCount: 0,
  })
  assertEquals(r.failClosed, true)
  assertEquals(r.reasons.includes("absolute_legal_claim_without_citation"), true)
})

Deno.test("runPostAnswerQualityChecks includes privacy and confidence in summary", () => {
  const r = runPostAnswerQualityChecks({
    question: "Which tenants are late on rent at Maple Heights?",
    answer:
      "Jordan Lee at Maple Heights is late — about $1,250 due and 14 days overdue. I'd start with a payment check-in.",
    intent: "ops",
    citations: [],
    evidencePacket: packetWithRent,
    buildingFilter: "Maple Heights",
    portfolioBuildings: ["Maple Heights", "Oakwood Apartments"],
    stateCode: "OR",
    cityLabel: "Portland",
  })
  assertEquals(r.failClosed, false)
  assertStringIncludes(r.summaryLine, "privacy:")
  assertStringIncludes(r.summaryLine, "confidence:")
})
