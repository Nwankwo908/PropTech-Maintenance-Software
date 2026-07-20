/**
 * Capability detection + controlled route table tests.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloCapability } from "../capability.ts"
import { resolveCapabilityRoute } from "../capabilityRoute.ts"
import { detectQuestionSubject } from "../questionSubjectMatch.ts"
import { planEvidenceForQuestion } from "../subjectEvidenceGate.ts"
import {
  emptyEvidenceBundle,
  finalizeEvidenceBundle,
  recordToolExecution,
  summarizeEvidenceBundle,
} from "./evidenceBundle.ts"
import { getDomainTool } from "./registry.ts"

Deno.test("capability: approve repairs → identify_pending_decision", () => {
  const q = "Which repairs should I approve immediately?"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "identify_pending_decision")
  assertEquals(cap.hints.approvalRequired, true)
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("get_awaiting_decisions"), true)
  assertEquals(route.requiredTools.includes("search_work_orders"), true)
})

Deno.test("capability: recurring repairs → identify_recurring_pattern", () => {
  const q = "What repairs keep happening over and over?"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "identify_recurring_pattern")
  assertEquals(cap.hints.includeCompleted, true)
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("get_property_insights"), true)
})

Deno.test("capability: oldest waiting → rank wait_age", () => {
  const q = "Which work order has been waiting the longest?"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "rank")
  assertEquals(cap.hints.metric, "wait_age")
})

Deno.test("capability: late rent residents → search_residents", () => {
  const q = "Which residents are late on rent?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject === "resident" || subject === "finance", true)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "search")
  assertEquals(cap.hints.residentFilter, "late_rent")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("search_residents"), true)
})

Deno.test("capability: tenants haven't responded to messages → message_nonresponse", () => {
  const q = "Which tenants haven't responded to messages?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "resident")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.hints.residentFilter, "message_nonresponse")
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.blockPropertyDashboard, true)
  assertEquals(plan.allowPortfolioBriefing, false)
})

Deno.test("capability: who moved in this month → move_in (not briefing)", () => {
  const q = "Who moved in this month?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "resident")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.hints.residentFilter, "move_in")
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.blockPropertyDashboard, true)
  assertEquals(plan.allowPortfolioBriefing, false)
})

Deno.test("capability: average rent nearby → market_intelligence (not briefing)", () => {
  const q = "What's the average rent for a two-bedroom nearby?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "market_intelligence")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "search")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("get_market_intelligence"), true)
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.blockPropertyDashboard, true)
  assertEquals(plan.allowPortfolioBriefing, false)
})

Deno.test("capability: if you owned portfolio do first → recommend + rank_properties", () => {
  const q = "If you owned my portfolio, what would you do first?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "portfolio")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "recommend")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("rank_properties"), true)
})

Deno.test("capability: smartest decision today → recommend + rank_properties", () => {
  const q = "What's the smartest decision I can make today to improve my portfolio?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "portfolio")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "recommend")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("rank_properties"), true)
  assertEquals(route.requiredTools.includes("get_awaiting_decisions"), true)
})

Deno.test("capability: vendors not accepted → rank inactive", () => {
  const q = "Which vendors have not accepted jobs?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "vendor")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "rank")
  assertEquals(cap.hints.vendorMetric, "inactive")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("rank_vendors"), true)
})

Deno.test("capability: HVAC estimate → estimate_cost", () => {
  const q = "Estimate the repair cost for the HVAC issues."
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "estimate_cost")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("search_work_orders"), true)
})

Deno.test("capability: becoming emergencies → identify_risk", () => {
  const q = "Which repairs are becoming emergencies?"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "identify_risk")
})

Deno.test("capability: units most maintenance → rank by unit", () => {
  const q = "Which units generate the most maintenance requests?"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "rank")
  assertEquals(cap.hints.groupBy?.includes("unit"), true)
})

Deno.test("capability: Ulo active tasks → explain_status + list_active_workflows", () => {
  const q = "What tasks is Ulo handling right now?"
  const subject = detectQuestionSubject(q)
  assertEquals(subject, "workflow")
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "explain_status")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("list_active_workflows"), true)
  const plan = planEvidenceForQuestion(q)
  assertEquals(plan.allowPortfolioBriefing, false)
})

Deno.test("domain tools marked live for new wrappers", () => {
  assertEquals(getDomainTool("search_work_orders")?.status, "live")
  assertEquals(getDomainTool("get_property_insights")?.status, "live")
  assertEquals(getDomainTool("get_awaiting_decisions")?.status, "live")
  assertEquals(getDomainTool("list_active_workflows")?.status, "live")
  assertEquals(getDomainTool("rank_vendors")?.status, "live")
  assertEquals(getDomainTool("search_residents")?.status, "live")
})

Deno.test("evidence bundle records findings without flattening", () => {
  const bundle = emptyEvidenceBundle({
    subject: "resident",
    capability: "search",
    organizationId: "org-1",
  })
  recordToolExecution(bundle, {
    tool: "search_residents",
    arguments: { filter: "late_rent" },
    resultCount: 2,
    success: true,
  })
  bundle.findings.residents = [
    {
      residentId: "r1",
      name: "Alex",
      balanceDue: 1200,
      unitLabel: "2A",
      propertyName: "Oakwood",
    },
    {
      residentId: "r2",
      name: "Blake",
      balanceDue: 800,
      unitLabel: "1B",
      propertyName: "Oakwood",
    },
  ]
  const final = finalizeEvidenceBundle(bundle)
  assertEquals(final.hasEvidence, true)
  assertEquals(final.findings.residents?.length, 2)
  const summary = summarizeEvidenceBundle(final)
  assertEquals((summary.findingCounts as Record<string, number>).residents, 2)
})
