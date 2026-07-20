/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import {
  looksLikeIgnoringTier1Intelligence,
} from "./knowledgeHierarchy.ts"

Deno.test("playbook: expensive if ignored → maintenance_risk (Tier 1 first)", () => {
  const p = classifyInvestigationPlaybook(
    "What maintenance issues could become expensive if ignored?",
  )
  assertEquals(p.id, "maintenance_risk")
  assertEquals(p.consultTier1First, true)
  assertEquals(p.preferTier1Answer, true)
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.searchOrder[0], "property_insights")
})

Deno.test("playbook: becoming emergencies → emergency_escalation", () => {
  const p = classifyInvestigationPlaybook(
    "Which maintenance requests are becoming emergencies?",
  )
  assertEquals(p.id, "emergency_escalation")
  assertEquals(p.consultTier1First, true)
  assertEquals(p.preferTier1Answer, true)
})

Deno.test("playbook: repair estimate keeps deep ops primary", () => {
  const p = classifyInvestigationPlaybook(
    "Estimate the repair cost for the HVAC issues.",
  )
  assertEquals(p.id, "repair_estimate")
  assertEquals(p.deepOpsPrimary, true)
  assertEquals(p.preferTier1Answer, false)
  assertEquals(p.searchOrder[0], "work_orders")
})

Deno.test("playbook: recurring issues phrase → recurring_repairs", () => {
  const p = classifyInvestigationPlaybook(
    "What are the recurring issues in my portfolio?",
  )
  assertEquals(p.id, "recurring_repairs")
  assertEquals(p.preferTier1Answer, false)
  assertEquals(p.consultTier1First, false)
  assertEquals(p.searchOrder[0], "work_orders")
})

Deno.test("playbook: which repairs should I approve → approve_repairs", () => {
  const p = classifyInvestigationPlaybook(
    "Which repairs should I approve immediately?",
  )
  assertEquals(p.id, "approve_repairs")
  assertEquals(p.preferTier1Answer, false)
  assertEquals(p.consultTier1First, false)
  assertEquals(p.searchOrder[0], "awaiting_decision")
})

Deno.test("playbook: which work orders missing updates → missing_updates", () => {
  const p = classifyInvestigationPlaybook(
    "Which work orders are missing updates?",
  )
  assertEquals(p.id, "missing_updates")
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.searchOrder[0], "work_orders")
})

Deno.test("playbook: which vendors respond fastest → vendor_speed", () => {
  const p = classifyInvestigationPlaybook("Which vendors respond the fastest?")
  assertEquals(p.id, "vendor_speed")
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.preferTier1Answer, false)
  assertEquals(p.searchOrder[0], "vendor_activity")
})

Deno.test("playbook: who is my best electrician → vendor_best", () => {
  const p = classifyInvestigationPlaybook("Who is my best electrician?")
  assertEquals(p.id, "vendor_best")
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.preferTier1Answer, false)
  assertEquals(p.searchOrder[0], "vendor_activity")
})

Deno.test("playbook: highest completion rate → vendor_completion", () => {
  const p = classifyInvestigationPlaybook("Which vendor has the highest completion rate?")
  assertEquals(p.id, "vendor_completion")
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.searchOrder[0], "vendor_activity")
})

Deno.test("playbook: haven't accepted recently → vendor_inactive", () => {
  const p = classifyInvestigationPlaybook(
    "Show vendors that haven't accepted jobs recently.",
  )
  assertEquals(p.id, "vendor_inactive")
  assertEquals(p.consultTier1First, false)
  assertEquals(p.searchOrder[0], "vendor_activity")
})

Deno.test("playbook: which vendors are overloaded → vendor_overload", () => {
  const p = classifyInvestigationPlaybook("Which vendors are overloaded?")
  assertEquals(p.id, "vendor_overload")
  assertEquals(p.consultTier1First, false)
  assertEquals(p.searchOrder[0], "vendor_activity")
})

Deno.test("playbook: unmatched ops → generic_ops fail-closed (no Tier-1 briefing)", () => {
  const p = classifyInvestigationPlaybook("Tell me something about operations.")
  assertEquals(p.id, "generic_ops")
  assertEquals(p.consultTier1First, false)
  assertEquals(p.preferTier1Answer, false)
})

Deno.test("tier1 QC: soft unavailable is invalid when Tier 1 exists", () => {
  assertEquals(
    looksLikeIgnoringTier1Intelligence(
      "I can't tell from the available information whether anything is expensive.",
    ),
    true,
  )
  assertEquals(
    looksLikeIgnoringTier1Intelligence(
      "The biggest concern is your recurring plumbing problems at Oakwood.",
    ),
    false,
  )
})
