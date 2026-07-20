/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import {
  buildFallbackAskUloAnswer,
  type AskUloToolPackets,
} from "./synthesize.ts"
import {
  ENTITY_INVESTIGATION_GUIDE,
  classifyEntityInvestigation,
  evaluateEntityInvestigationQc,
  extractEntitiesFromQuestion,
  isEntityInvestigationQuestion,
  looksLikePortfolioSubstitute,
} from "./entityInvestigation.ts"

Deno.test("entity investigation guide matches contract", () => {
  assertStringIncludes(ENTITY_INVESTIGATION_GUIDE, "Resolve the entity")
  assertStringIncludes(ENTITY_INVESTIGATION_GUIDE, "Root cause")
  assertStringIncludes(ENTITY_INVESTIGATION_GUIDE, "Never answer entity questions with portfolio data")
  assertStringIncludes(ENTITY_INVESTIGATION_GUIDE, "what stalled on their specific issue")
})

Deno.test("extract Unit 304 + plumbing entities", () => {
  const entities = extractEntitiesFromQuestion(
    "Why hasn't Unit 304's plumbing issue been resolved?",
  )
  assertEquals(entities.some((e) => e.kind === "unit" && e.raw === "304"), true)
  const plan = classifyEntityInvestigation(
    "Why hasn't Unit 304's plumbing issue been resolved?",
  )
  assertEquals(plan.isEntityInvestigation, true)
  assertEquals(plan.categoryHint, "plumbing")
  assertEquals(plan.rejectsPortfolioData, true)
  assertEquals(plan.investigationChecklist.length > 5, true)
})

Deno.test("extract WO / resident / vendor / lease / inspection", () => {
  assertEquals(
    extractEntitiesFromQuestion("What's the status of WO-1234?").some(
      (e) => e.kind === "work_order",
    ),
    true,
  )
  assertEquals(
    extractEntitiesFromQuestion("Why is resident Jane Smith past due?").some(
      (e) => e.kind === "resident" && /Jane/i.test(e.raw),
    ),
    true,
  )
  assertEquals(
    extractEntitiesFromQuestion("Has vendor ABC Plumbing accepted the job?").some(
      (e) => e.kind === "vendor",
    ),
    true,
  )
  assertEquals(
    extractEntitiesFromQuestion("Look into lease L-204").some((e) => e.kind === "lease"),
    true,
  )
  assertEquals(
    extractEntitiesFromQuestion("Status of inspection INS-45").some(
      (e) => e.kind === "inspection",
    ),
    true,
  )
})

Deno.test("unit question → entity_investigation intent (not portfolio priority)", () => {
  const r = classifyAskUloIntent("Why hasn't Unit 304's plumbing issue been resolved?")
  assertEquals(r.intent, "entity_investigation")
  assertEquals(isEntityInvestigationQuestion("Why hasn't Unit 304's plumbing issue been resolved?"), true)
})

Deno.test("ranking questions are NOT entity investigations", () => {
  assertEquals(
    isEntityInvestigationQuestion("Which units have the most maintenance requests?"),
    false,
  )
  assertEquals(
    isEntityInvestigationQuestion("Which work order has been waiting the longest?"),
    false,
  )
  assertEquals(
    classifyAskUloIntent("How many open work orders do I have?").intent !==
      "entity_investigation",
    true,
  )
})

Deno.test("portfolio substitute detection", () => {
  assertEquals(
    looksLikePortfolioSubstitute("You currently have 25 open work orders across the portfolio."),
    true,
  )
  assertEquals(
    looksLikePortfolioSubstitute(
      "It looks like the repair stalled after it was assigned to Metro Plumbing. The vendor hasn't accepted the job yet.",
    ),
    false,
  )
})

Deno.test("entity QC fails portfolio KPI draft", () => {
  const qc = evaluateEntityInvestigationQc({
    question: "Why hasn't Unit 304's plumbing issue been resolved?",
    answer: "## Quick Answer\nYou currently have 14 open work orders.",
  })
  assertEquals(qc.status, "fail")
})

Deno.test("entity QC passes root-cause answer naming the unit", () => {
  const qc = evaluateEntityInvestigationQc({
    question: "Why hasn't Unit 304's plumbing issue been resolved?",
    answer:
      "It looks like the plumbing issue in Unit 304 stalled after it was assigned to Metro Plumbing. The vendor hasn't accepted the job yet, so no work has been scheduled.",
  })
  assertEquals(qc.status, "pass")
})

Deno.test("fallback uses entity packet — never open-ticket totals", () => {
  const packets: AskUloToolPackets = {
    question: "Why hasn't Unit 304's plumbing issue been resolved?",
    intent: "entity_investigation",
    intentLabel: "Entity Investigation",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    entityInvestigation: {
      available: true,
      found: true,
      missingData: [],
      bullets: ["Investigating Unit 304 (plumbing)."],
      citations: [],
      markdown: [
        "It looks like the plumbing issue in **Unit 304** at **Maple Heights** stalled after it was assigned to **Metro Plumbing**.",
        "",
        "The vendor hasn't accepted the job yet, so no work has been scheduled. It's been open **12 days**.",
        "",
        "## Why it matters",
        "Since this is a plumbing issue, delaying repairs increases the risk of water damage and resident dissatisfaction.",
        "",
        "## Details",
        "- **Property:** Maple Heights",
        "- **Unit:** Unit 304",
        "- **Vendor:** Metro Plumbing",
        "",
        "## What I'd do",
        "I'd follow up with Metro Plumbing today. If they can't commit, I'd reassign so the repair doesn't keep aging.",
      ].join("\n"),
      primary: {
        displayId: "WO-ABCD",
        building: "Maple Heights",
        unit: "304",
        issueCategory: "plumbing",
        description: "Kitchen sink leak",
        status: "pending_accept",
        daysOpen: 12,
        vendorName: "Metro Plumbing",
        rootCause: "Metro Plumbing hasn't accepted the job yet, so nothing has been scheduled",
        recommendedAction:
          "I'd follow up with Metro Plumbing today. If they can't commit, I'd reassign so the repair doesn't keep aging.",
      },
    },
    ops: {
      bullets: ["Open maintenance tickets: 25."],
      citations: [],
    },
    toolsUsed: ["entity_investigation"],
  }
  const md = buildFallbackAskUloAnswer(packets)
  assertStringIncludes(md, "Unit 304")
  assertStringIncludes(md, "Metro Plumbing")
  assertEquals(/25 open|Open maintenance tickets: 25/i.test(md), false)
})
