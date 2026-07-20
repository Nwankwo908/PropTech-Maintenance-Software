/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildTransparencyEvidence,
  formatReasoningTransparencyMarkdown,
  humanizeOpsLanguage,
  requiresReasoningTransparency,
} from "./reasoningTransparency.ts"
import {
  buildFallbackAskUloAnswer,
  ensureReasoningTransparency,
  type AskUloToolPackets,
} from "./synthesize.ts"

Deno.test("analytical intents require transparency; narrow factual does not", () => {
  assertEquals(
    requiresReasoningTransparency({
      intent: "property_priority",
      reasoningMode: "comparison_ranking",
    }),
    true,
  )
  assertEquals(
    requiresReasoningTransparency({
      intent: "maintenance",
      narrowFactual: true,
      reasoningMode: "factual",
    }),
    false,
  )
})

Deno.test("humanizeOpsLanguage strips implementation jargon", () => {
  assertEquals(
    /operations graph/i.test(humanizeOpsLanguage("from the Operations Graph")),
    false,
  )
  assertEquals(
    humanizeOpsLanguage("retrieved packets for analysis").includes("records"),
    true,
  )
})

Deno.test("humanizeOpsLanguage translates industry jargon to actions", () => {
  assertEquals(
    /SLA/i.test(humanizeOpsLanguage("Missed the vendor SLA")),
    false,
  )
  assertEquals(
    humanizeOpsLanguage("Missed the vendor SLA").toLowerCase().includes("deadline"),
    true,
  )
  assertEquals(
    /triage/i.test(humanizeOpsLanguage("Triage aging work orders first")),
    false,
  )
  assertEquals(
    /escalated workflow/i.test(
      humanizeOpsLanguage("Clear escalated workflows today"),
    ),
    false,
  )
  assertEquals(
    humanizeOpsLanguage("Clear escalated workflows today").includes(
      "require your attention",
    ),
    true,
  )
  assertEquals(
    /aging work order/i.test(
      humanizeOpsLanguage("Fix aging work orders this week"),
    ),
    false,
  )
  assertEquals(
    /reassign vendors/i.test(
      humanizeOpsLanguage("Please reassign vendors on overdue jobs"),
    ),
    false,
  )
})

Deno.test("transparency evidence uses landlord language", () => {
  const high = buildTransparencyEvidence({
    intent: "property_priority",
    reasoningMode: "comparison_ranking",
    propertyRanking: {
      available: true,
      canRank: true,
      missingData: [],
      portfolioOpenWorkOrders: 12,
      top: {
        building: "Oakwood Apartments",
        whyLines: ["3 critical/urgent work orders"],
      },
    },
  })
  assertEquals(high.confidence, "High")
  assertEquals(high.sectionTitle, "Why I reached this conclusion")
  assertEquals(high.evidenceLines.some((l) => /operations graph/i.test(l)), false)
  assertEquals(/packet/i.test(high.confidenceNote), false)

  const md = formatReasoningTransparencyMarkdown(high)
  assertEquals(md.includes("## Why I reached this conclusion"), true)
  assertEquals(md.includes("## How I analyzed this"), false)
  assertEquals(md.includes("## Confidence"), true)
  assertEquals(md.includes("**High**"), true)
})

Deno.test("fallback ranking answer includes Why I reached this conclusion", () => {
  const packets: AskUloToolPackets = {
    question: "Which property needs my attention first?",
    intent: "property_priority",
    intentLabel: "Property Priority",
    jurisdiction: { stateCode: "OR", cityLabel: "Portland", citySlug: "portland" },
    reasoningMode: "comparison_ranking",
    propertyRanking: {
      available: true,
      canRank: true,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: "",
      portfolioOpenWorkOrders: 25,
      top: {
        building: "Oakwood Apartments",
        whyLines: ["3 critical/urgent work orders"],
        recommendedActions: ["Review critical requests first."],
        openWorkOrders: 8,
        criticalWorkOrders: 3,
        agingWorkOrders: 2,
        escalatedWorkflows: 2,
        healthScore: 58,
        healthDelta4w: -8,
      },
      watch: [],
    },
    toolsUsed: ["property_ranking"],
  }
  const raw = buildFallbackAskUloAnswer(packets)
  const answer = ensureReasoningTransparency(raw, packets)
  assertEquals(answer.includes("Oakwood Apartments"), true)
  assertEquals(answer.includes("## Why I reached this conclusion"), true)
  assertEquals(answer.includes("## Confidence"), true)
  assertEquals(answer.includes("I looked at:"), true)
  assertEquals(/Operations Graph/i.test(answer), false)
})

Deno.test("ensureReasoningTransparency is idempotent for property ranking", () => {
  const packets: AskUloToolPackets = {
    question: "Which property needs my attention first?",
    intent: "property_priority",
    intentLabel: "Property Priority",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    reasoningMode: "comparison_ranking",
    propertyRanking: {
      available: true,
      canRank: true,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: "",
      portfolioOpenWorkOrders: 8,
      top: {
        building: "Oakwood",
        whyLines: ["2 critical requests"],
        recommendedActions: ["Review critical requests first."],
        openWorkOrders: 4,
        criticalWorkOrders: 2,
        agingWorkOrders: 1,
        escalatedWorkflows: 0,
        healthScore: 60,
        healthDelta4w: -4,
      },
      watch: [],
    },
    toolsUsed: ["property_ranking"],
  }
  const once = ensureReasoningTransparency("## Top Priority\n**Oakwood** needs attention.\n", packets)
  const twice = ensureReasoningTransparency(once, packets)
  assertEquals(once, twice)
  assertEquals((once.match(/## Why I reached this conclusion/g) ?? []).length, 1)
})

Deno.test("executive briefing does not force Why I reached / Confidence", () => {
  const packets: AskUloToolPackets = {
    question: "How healthy is my portfolio?",
    intent: "executive_briefing",
    intentLabel: "Executive Briefing",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    reasoningMode: "executive_briefing",
    portfolioBriefing: {
      available: true,
      assessment: "Stable",
      healthScore: 72,
      healthDelta4w: -2,
      bullets: ["Open work orders: 5"],
      citations: [],
      markdown: "brief",
      facts: { openWorkOrders: 0, criticalWorkOrders: 0 },
    },
    toolsUsed: ["portfolio_briefing"],
  }
  const answer = ensureReasoningTransparency("## Overall Assessment\nStable.\n", packets)
  assertEquals(answer.includes("## Why I reached this conclusion"), false)
  assertEquals(answer.includes("## Confidence"), false)
})

Deno.test("healthy portfolio fallback says no action needed", () => {
  const packets: AskUloToolPackets = {
    question: "How healthy is my portfolio?",
    intent: "executive_briefing",
    intentLabel: "Executive Briefing",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    reasoningMode: "executive_briefing",
    portfolioBriefing: {
      available: true,
      assessment: "Healthy",
      healthScore: 90,
      healthDelta4w: 2,
      bullets: [],
      citations: [],
      markdown: "",
      facts: {
        openWorkOrders: 0,
        criticalWorkOrders: 0,
        agingWorkOrders: 0,
        escalatedWorkflows: 0,
        awaitingDecision: 0,
        occupancyPct: 96,
        recurringHotspots: [],
      },
    },
    toolsUsed: ["portfolio_briefing"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(/No action is needed/i.test(answer), true)
  assertEquals(/Open the Operations board/i.test(answer), false)
})
