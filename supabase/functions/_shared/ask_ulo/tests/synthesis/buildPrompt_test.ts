/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildAskUloPrompt, intentSectionGuide } from "../../synthesis/buildPrompt.ts"
import {
  ANSWER_STYLE_GUIDE,
  formatAskUloAnswer,
} from "../../synthesis/formatAnswer.ts"
import type { AskUloToolPackets } from "../../synthesis/toolPackets.ts"

function basePackets(over: Partial<AskUloToolPackets> = {}): AskUloToolPackets {
  return {
    question: "Which tenants are late on rent?",
    intent: "ops",
    intentLabel: "Ops",
    jurisdiction: {
      stateCode: "NJ",
      cityLabel: "Newark",
      citySlug: "newark",
    },
    toolsUsed: ["search_residents"],
    evidencePacket: {
      internal: [
        {
          id: "r1",
          channel: "internal",
          source: "users.balance_due",
          label: "Jordan Lee",
          excerpt: "$1,250 due",
          stale: false,
          strength: 80,
        },
      ],
      legal: [],
      market: [],
      missing: [],
      meta: {
        asOf: "2026-07-19",
        jurisdiction: { stateCode: "NJ", cityLabel: "Newark" },
        subject: "resident",
        capability: "search",
        hasEvidence: true,
        staleCount: 0,
        toolExecutions: [],
      },
    },
    ...over,
  }
}

Deno.test("ANSWER_STYLE_GUIDE covers Quick Answer / next steps / disclaimer rules", () => {
  assertStringIncludes(ANSWER_STYLE_GUIDE, "Quick Answer")
  assertStringIncludes(ANSWER_STYLE_GUIDE, "Short paragraphs")
  assertStringIncludes(ANSWER_STYLE_GUIDE, "Next steps")
  assertStringIncludes(ANSWER_STYLE_GUIDE, "second opinion")
})

Deno.test("intentSectionGuide narrow factual asks for Quick Answer", () => {
  const g = intentSectionGuide("ops", { narrowFactual: true })
  assertStringIncludes(g, "Quick Answer")
})

Deno.test("buildAskUloPrompt includes organized evidence and style constraints", () => {
  const prompt = buildAskUloPrompt(basePackets())
  assertEquals(prompt.messages[0]?.role, "system")
  assertStringIncludes(prompt.messages[0]?.content ?? "", "Ulo")
  const user = [...prompt.messages].reverse().find((m) => m.role === "user")
  assertStringIncludes(user?.content ?? "", "ORGANIZED EVIDENCE")
  assertStringIncludes(user?.content ?? "", "Jordan Lee")
  assertStringIncludes(user?.content ?? "", "FINAL STYLE CONSTRAINTS")
  assertStringIncludes(user?.content ?? "", "Prefer ORGANIZED EVIDENCE")
  // Empty specialty dumps must not pollute the prompt
  assertEquals(user?.content?.includes("VENDOR BEST"), false)
  assertEquals(user?.content?.includes("(skipped)"), false)
})

Deno.test("buildAskUloPrompt includes supporting detail only for active specialty packets", () => {
  const prompt = buildAskUloPrompt(
    basePackets({
      propertyRanking: {
        available: true,
        canRank: true,
        missingData: [],
        portfolioOpenWorkOrders: 3,
        bullets: ["Oakwood ranks first"],
        citations: [],
        markdown: "## Top: Oakwood",
        top: {
          building: "Oakwood",
          whyLines: ["Most aging work orders"],
          recommendedActions: ["Review SLA"],
          openWorkOrders: 5,
          criticalWorkOrders: 1,
          agingWorkOrders: 3,
          escalatedWorkflows: 0,
          healthScore: 62,
          healthDelta4w: -4,
        },
        watch: [],
      },
    }),
  )
  const user = [...prompt.messages].reverse().find((m) => m.role === "user")
  assertStringIncludes(user?.content ?? "", "ORGANIZED EVIDENCE")
  assertStringIncludes(user?.content ?? "", "SUPPORTING DETAIL")
  assertStringIncludes(user?.content ?? "", "PROPERTY RANKING")
  assertStringIncludes(user?.content ?? "", "Oakwood")
  assertEquals(user?.content?.includes("LIVE MARKET DATA"), false)
})

Deno.test("formatAskUloAnswer adds legal disclaimer when required", () => {
  const out = formatAskUloAnswer("You generally need proper notice before filing.", {
    requireLegalDisclaimer: true,
    polish: false,
  })
  assertStringIncludes(out, "second opinion")
  assertStringIncludes(out, "not legal advice")
})
