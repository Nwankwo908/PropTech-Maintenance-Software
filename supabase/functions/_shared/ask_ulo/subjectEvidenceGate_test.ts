/**
 * Tests for hard subject evidence gating + expanded subject detection.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  detectQuestionSubject,
  evaluateSubjectMatchQc,
  hasSubjectMismatch,
} from "./questionSubjectMatch.ts"
import {
  isCrossSubjectPropertyPacket,
  planEvidenceForQuestion,
  subjectBlocksPropertyDashboardFallback,
} from "./subjectEvidenceGate.ts"
import { DOMAIN_TOOL_REGISTRY, getDomainTool } from "./domainTools/registry.ts"

Deno.test("subject: late-paying residents → resident (not property)", () => {
  assertEquals(
    detectQuestionSubject("Which residents are consistently late paying rent?"),
    "resident",
  )
})

Deno.test("subject: repairs to approve → work_order (not fair-housing/legal)", () => {
  assertEquals(
    detectQuestionSubject("Which repairs should I approve immediately?"),
    "work_order",
  )
})

Deno.test("subject: vendor response times stays vendor", () => {
  assertEquals(
    detectQuestionSubject("Which vendors have poor response times?"),
    "vendor",
  )
})

Deno.test("subject gate blocks property dashboard for resident/vendor/work_order", () => {
  assertEquals(subjectBlocksPropertyDashboardFallback("resident"), true)
  assertEquals(subjectBlocksPropertyDashboardFallback("vendor"), true)
  assertEquals(subjectBlocksPropertyDashboardFallback("work_order"), true)
  assertEquals(subjectBlocksPropertyDashboardFallback("property"), false)
  assertEquals(subjectBlocksPropertyDashboardFallback("portfolio"), false)
})

Deno.test("evidence plan: resident question forbids property ranking fetch", () => {
  const plan = planEvidenceForQuestion(
    "Which residents are consistently late paying rent?",
  )
  assertEquals(plan.subject, "resident")
  assertEquals(plan.blockPropertyDashboard, true)
  assertEquals(plan.allowPropertyRanking, false)
  assertEquals(plan.allowPortfolioBriefing, false)
})

Deno.test("evidence plan: property priority still allows ranking", () => {
  const plan = planEvidenceForQuestion("Which property needs attention first?")
  assertEquals(plan.subject, "property")
  assertEquals(plan.allowPropertyRanking, true)
})

Deno.test("cross-subject property packet detection", () => {
  assertEquals(
    isCrossSubjectPropertyPacket({
      question: "Which residents are late on rent?",
      packet: "property_ranking",
    }),
    true,
  )
  assertEquals(
    isCrossSubjectPropertyPacket({
      question: "Which property needs attention first?",
      packet: "property_ranking",
    }),
    false,
  )
})

Deno.test("subject mismatch: resident answered as property priority fails QC", () => {
  const q = "Which residents are consistently late paying rent?"
  const bad =
    "**Oakwood Apartments** is the top priority — it ranks first on critical work orders and overdue SLAs."
  assertEquals(hasSubjectMismatch(q, bad), true)
  assertEquals(evaluateSubjectMatchQc({ question: q, answer: bad }).status, "fail")
})

Deno.test("domain tool registry includes search_work_orders as live", () => {
  const tool = getDomainTool("search_work_orders")
  assertEquals(tool?.status, "live")
  assertEquals(DOMAIN_TOOL_REGISTRY.some((t) => t.id === "search_work_orders"), true)
})
