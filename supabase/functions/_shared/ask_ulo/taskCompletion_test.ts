/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import {
  buildFallbackAskUloAnswer,
  type AskUloToolPackets,
} from "./synthesize.ts"
import {
  classifyTaskContract,
  evaluateTaskCompletionQc,
  isOldestWaitingWorkOrderQuestion,
  looksLikeGenericKpiFallback,
} from "./taskCompletion.ts"

Deno.test("oldest waiting work order question detection", () => {
  assertEquals(
    isOldestWaitingWorkOrderQuestion("Which work order has been waiting the longest?"),
    true,
  )
  assertEquals(
    isOldestWaitingWorkOrderQuestion("What ticket has been open the longest?"),
    true,
  )
  assertEquals(
    isOldestWaitingWorkOrderQuestion("How many open work orders do I have?"),
    false,
  )
})

Deno.test("oldest waiting → dedicated intent", () => {
  const r = classifyAskUloIntent("Which work order has been waiting the longest?")
  assertEquals(r.intent, "oldest_waiting_work_order")
})

Deno.test("task contract rejects generic KPIs for oldest WO", () => {
  const c = classifyTaskContract("Which work order has been waiting the longest?")
  assertEquals(c.isOldestWaitingWorkOrder, true)
  assertEquals(c.rejectsGenericKpis, true)
  assertEquals(c.action, "rank_oldest")
})

Deno.test("generic open-ticket lead is invalid fallback", () => {
  assertEquals(
    looksLikeGenericKpiFallback("## Quick Answer\nYou currently have 25 open work orders."),
    true,
  )
  assertEquals(
    looksLikeGenericKpiFallback(
      "Work Order WO-184 has been waiting the longest.\n\n**Waiting:** 31 days",
    ),
    false,
  )
})

Deno.test("task completion QC fails open-count substitute", () => {
  const qc = evaluateTaskCompletionQc({
    question: "Which work order has been waiting the longest?",
    answer: "Open maintenance tickets: 25",
  })
  assertEquals(qc.status, "fail")
})

Deno.test("task completion QC passes specific WO answer", () => {
  const qc = evaluateTaskCompletionQc({
    question: "Which work order has been waiting the longest?",
    answer:
      "Work Order WO-184 has been waiting the longest at Maple Heights unit 204 — kitchen plumbing, 31 days waiting.",
  })
  assertEquals(qc.status, "pass")
})

Deno.test("fallback oldest waiting uses packet markdown not open count", () => {
  const packets: AskUloToolPackets = {
    question: "Which work order has been waiting the longest?",
    intent: "oldest_waiting_work_order",
    intentLabel: "Oldest Waiting Work Order",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    oldestWaitingWorkOrder: {
      available: true,
      found: true,
      missingData: [],
      bullets: ["Oldest waiting: WO-ABCD — 31 days"],
      citations: [],
      markdown: [
        "The one that's been sitting the longest is a Kitchen leak in **Unit 204** at **Maple Heights**.",
        "",
        "This repair has been sitting for **31 days** because **ABC Plumbing** still hasn't accepted the assignment.",
        "",
        "## Why it matters",
        "At this age, residents notice.",
        "",
        "## Details",
        "- **Property:** Maple Heights",
        "- **Unit:** Unit 204",
        "- **Waiting:** 31 days",
        "",
        "## What I'd do",
        "I'd reach out to ABC Plumbing today. If they can't commit, I'd reassign the job so it doesn't keep aging.",
      ].join("\n"),
      openCount: 12,
      oldest: {
        displayId: "WO-ABCD",
        building: "Maple Heights",
        unit: "204",
        issueCategory: "plumbing",
        description: "Kitchen leak",
        status: "pending_accept",
        daysWaiting: 31,
        vendorName: "ABC Plumbing",
        reasonWaiting: "ABC Plumbing still hasn't accepted the assignment",
        recommendedAction:
          "I'd reach out to ABC Plumbing today. If they can't commit, I'd reassign the job so it doesn't keep aging.",
      },
    },
    ops: {
      bullets: ["Open maintenance tickets: 25."],
      citations: [],
    },
    toolsUsed: [],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertStringIncludes(answer, "Maple Heights")
  assertStringIncludes(answer, "31 days")
  assertStringIncludes(answer, "Why it matters")
  assertStringIncludes(answer, "What I'd do")
  assertEquals(/##\s*Longest/i.test(answer), false)
  assertEquals(/open maintenance tickets:\s*25/i.test(answer), false)
  assertEquals(/##\s*Recommended Action/i.test(answer), false)
})
