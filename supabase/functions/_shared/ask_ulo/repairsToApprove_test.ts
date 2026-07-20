/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { isRepairsToApproveQuestion } from "./repairsToApproveLookup.ts"
import { detectFairHousingSafety } from "./fairHousingSafety.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("approve-repairs question phrases classify as approve_repairs", () => {
  for (const q of [
    "Which repairs should I approve immediately?",
    "What repairs should I approve first?",
    "Which repairs to approve immediately?",
    "What maintenance needs my attention now?",
  ]) {
    assertEquals(isRepairsToApproveQuestion(q), true, q)
    assertEquals(classifyInvestigationPlaybook(q).id, "approve_repairs", q)
  }
  const playbook = classifyInvestigationPlaybook(
    "Which repairs should I approve immediately?",
  )
  assertEquals(playbook.preferTier1Answer, false)
  assertEquals(playbook.consultTier1First, false)
})

Deno.test("approve repairs is not fair-housing screening refuse", () => {
  const s = detectFairHousingSafety("Which repairs should I approve immediately?")
  assertEquals(s.refuseDecision, false)
  assertEquals(
    s.flags.some((f) => f.id === "approve_deny_decision_request"),
    false,
  )
})

Deno.test("synthesize prefers repairsToApprove markdown when available", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const md =
      "I'd approve these first — **2** items need your attention right now.\n\n### Approve or act now\n- **Burst pipe** — Oakwood · Unit 12: urgent priority open repair"
    const result = await synthesizeAskUloAnswer({
      question: "Which repairs should I approve immediately?",
      history: [],
      intent: "ops",
      intentLabel: "Operations",
      jurisdiction: {
        countryCode: "US",
        stateCode: "GA",
        countySlug: null,
        countyLabel: null,
        cityLabel: null,
        citySlug: null,
        courtSystem: null,
        housingProgram: null,
        codeSet: null,
      },
      legalGate: null,
      fairHousing: null,
      humanDecision: null,
      screeningIsolation: false,
      ops: null,
      legal: null,
      structured: null,
      property: null,
      market: null,
      priceHistory: null,
      rentHistory: null,
      portfolioBriefing: null,
      propertyInsights: null,
      periodSummary: null,
      oldestWaitingWorkOrder: null,
      entityInvestigation: null,
      deepOpsInvestigation: {
        available: true,
        found: false,
        markdown: "I can't fully answer from the available information.",
        bullets: [],
        citations: [],
        categories: [],
        ticketCount: 0,
        missingFields: [],
        isRepairCostQuestion: false,
        workOrders: [],
        operationalEvidenceJson: "",
      },
      recurringRepairs: null,
      repairsToApprove: {
        available: true,
        found: true,
        bullets: ["Burst pipe: urgent"],
        citations: [],
        markdown: md,
        openUrgentCount: 1,
        awaitingCount: 1,
        items: [
          {
            kind: "urgent_work_order",
            label: "Burst pipe",
            building: "Oakwood",
            unitLabel: "12",
            reason: "urgent priority open repair",
            priority: "urgent",
          },
        ],
      },
      missingUpdates: null,
      investigationPlaybook: {
        id: "approve_repairs",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["repairs_to_approve"],
    })
    assertStringIncludes(result.answer, "Approve or act now")
    assertStringIncludes(result.answer, "Burst pipe")
    assertEquals(result.answer.includes("can't fully answer"), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
