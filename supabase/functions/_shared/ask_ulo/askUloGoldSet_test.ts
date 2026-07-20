/**
 * Gold-set routing lock for Ask Ulo demo / training questions.
 * Asserts subject + blocks portfolio briefing where it would be a wrong answer.
 * Honest-gap domains may still lack live data — they must not get health packets.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { detectAskUloCapability } from "./capability.ts"
import {
  detectQuestionSubject,
  type AskUloQuestionSubject,
} from "./questionSubjectMatch.ts"
import { planEvidenceForQuestion } from "./subjectEvidenceGate.ts"

type GoldCase = {
  q: string
  subject: AskUloQuestionSubject | AskUloQuestionSubject[]
  /** When true, portfolio_briefing must be forbidden. */
  forbidBriefing?: boolean
  /** Optional intent lock. */
  intent?: string | string[]
  /** Optional capability lock. */
  capability?: string | string[]
}

function assertSubject(q: string, expected: AskUloQuestionSubject | AskUloQuestionSubject[]) {
  const got = detectQuestionSubject(q)
  const ok = Array.isArray(expected) ? expected.includes(got) : got === expected
  assertEquals(ok, true, `${q}\n  subject got=${got} expected=${JSON.stringify(expected)}`)
}

function assertNoBriefing(q: string) {
  const plan = planEvidenceForQuestion(q)
  assertEquals(
    plan.allowPortfolioBriefing,
    false,
    `${q}\n  expected allowPortfolioBriefing=false (subject=${plan.subject})`,
  )
}

const GOLD: GoldCase[] = [
  // Portfolio health / briefing
  { q: "How healthy is my portfolio right now?", subject: "portfolio", intent: "executive_briefing" },
  { q: "Which property needs my attention first?", subject: ["property", "portfolio"], intent: "property_priority", forbidBriefing: false },
  { q: "Why did my Property Health score drop?", subject: ["property", "portfolio"], forbidBriefing: false },
  { q: "Show me the biggest maintenance trends this month.", subject: ["maintenance", "work_order", "period", "other"], forbidBriefing: true },
  { q: "Which building has the most recurring problems?", subject: ["property", "maintenance", "work_order"], forbidBriefing: false },
  { q: "Which units generate the most maintenance requests?", subject: "unit", intent: "unit_maintenance_ranking", forbidBriefing: true },
  { q: "What should I prioritize today?", subject: ["property", "portfolio", "other"], forbidBriefing: false },
  { q: "Give me a summary of everything that happened this week.", subject: ["period", "portfolio", "other"], intent: ["period_summary", "executive_briefing", "ops"] },
  { q: "What should I worry about over the next 30 days?", subject: ["portfolio", "other"], intent: "executive_briefing" },

  // Maintenance
  { q: "Which work order has been waiting the longest?", subject: "work_order", intent: "oldest_waiting_work_order", forbidBriefing: true },
  { q: "Why hasn't Unit 304's plumbing issue been resolved?", subject: ["unit", "work_order"], intent: "entity_investigation", forbidBriefing: true },
  { q: "Which maintenance requests are becoming emergencies?", subject: ["maintenance", "work_order"], forbidBriefing: true },
  { q: "Show me every roof-related repair.", subject: "work_order", forbidBriefing: true },
  { q: "What repairs keep happening over and over?", subject: "work_order", capability: "identify_recurring_pattern", forbidBriefing: true },
  { q: "What maintenance issues could become expensive if ignored?", subject: ["maintenance", "work_order"], capability: "identify_risk", forbidBriefing: true },
  { q: "Estimate the repair cost for this HVAC issue.", subject: "finance", capability: "estimate_cost", forbidBriefing: true },
  { q: "Which repairs should I approve immediately?", subject: "work_order", capability: "identify_pending_decision", forbidBriefing: true },
  { q: "Which work orders are stuck waiting for vendors?", subject: "work_order", forbidBriefing: true },
  { q: "Which work orders are missing updates?", subject: "work_order", forbidBriefing: true },

  // Vendor
  { q: "Which vendors respond the fastest?", subject: "vendor", forbidBriefing: true },
  { q: "Who is my best electrician?", subject: "vendor", forbidBriefing: true },
  { q: "Which vendor has the highest completion rate?", subject: "vendor", forbidBriefing: true },
  { q: "Show vendors that haven't accepted jobs recently.", subject: "vendor", forbidBriefing: true },
  { q: "Recommend another plumber.", subject: "vendor", forbidBriefing: true },
  { q: "Why was this vendor reassigned?", subject: "vendor", forbidBriefing: true },
  { q: "Which vendors are overloaded?", subject: "vendor", forbidBriefing: true },
  { q: "Find a roofing contractor near my property.", subject: "vendor", forbidBriefing: true },
  { q: "Compare my HVAC vendors.", subject: "vendor", forbidBriefing: true },
  { q: "Which vendors have poor response times?", subject: "vendor", forbidBriefing: true },

  // Resident
  { q: "Which residents are consistently late paying rent?", subject: "resident", forbidBriefing: true },
  { q: "Show all leases ending in the next 90 days.", subject: "lease", forbidBriefing: true },
  { q: "Which residents have submitted the most maintenance requests?", subject: "resident", forbidBriefing: true },
  { q: "Which tenants haven't responded to messages?", subject: "resident", forbidBriefing: true },
  { q: "Who moved in this month?", subject: "resident", forbidBriefing: true },
  { q: "Which units are vacant?", subject: "unit", forbidBriefing: true },
  { q: "Which leases need renewal soon?", subject: "lease", forbidBriefing: true },
  { q: "Summarize this resident's history.", subject: "resident", forbidBriefing: true },
  { q: "Show all unresolved issues for Apartment 202.", subject: ["unit", "work_order", "maintenance"], forbidBriefing: true },

  // Finance
  { q: "How much have I spent on maintenance this month?", subject: "finance", forbidBriefing: true },
  { q: "Which property costs the most to maintain?", subject: ["finance", "property"], forbidBriefing: true },
  { q: "What's my estimated NOI?", subject: "finance", forbidBriefing: true },
  { q: "Where am I losing money?", subject: ["finance", "property"], forbidBriefing: true },
  { q: "Show maintenance spending by category.", subject: "finance", forbidBriefing: true },
  { q: "How much have plumbing repairs cost this year?", subject: "finance", forbidBriefing: true },
  { q: "Which vendors cost the most?", subject: ["finance", "vendor"], forbidBriefing: true },
  { q: "Compare repair spending month over month.", subject: "finance", forbidBriefing: true },
  { q: "Forecast next month's maintenance expenses.", subject: ["finance", "other"], forbidBriefing: true },

  // Document
  { q: "Summarize this lease.", subject: ["document", "lease"], forbidBriefing: true },
  { q: "What are the pet rules in this lease?", subject: ["document", "lease", "legal"], forbidBriefing: true },
  { q: "When does this insurance policy expire?", subject: ["document", "other"], forbidBriefing: true },
  { q: "Does this vendor have a valid COI?", subject: ["document", "vendor"], forbidBriefing: true },
  { q: "Summarize this inspection report.", subject: "document", forbidBriefing: true },
  { q: "Find every lease with a $250 late fee.", subject: ["document", "lease"], forbidBriefing: true },
  { q: "Which documents are missing?", subject: "document", forbidBriefing: true },
  { q: "Explain this invoice.", subject: ["document", "finance"], forbidBriefing: true },
  { q: "What does this contract say about termination?", subject: ["document", "legal"], forbidBriefing: true },

  // Legal
  { q: "Can I enter this rental unit without notice?", subject: "legal", intent: "legal", forbidBriefing: true },
  { q: "What's the eviction process in Georgia?", subject: "legal", intent: "legal", forbidBriefing: true },
  { q: "Do I need to return a security deposit within 30 days?", subject: "legal", forbidBriefing: true },
  { q: "What are my responsibilities for mold?", subject: "legal", forbidBriefing: true },
  { q: "Are smoke detectors required in this property?", subject: ["legal", "local_regulation"], forbidBriefing: true },
  { q: "Does this lease comply with Georgia law?", subject: ["legal", "lease"], forbidBriefing: true },
  { q: "What fair housing rules apply here?", subject: "legal", forbidBriefing: true },
  { q: "What should I document before filing an eviction?", subject: "legal", forbidBriefing: true },

  // Decision / wow
  { q: "What would you do if this were your property?", subject: ["portfolio", "property", "other"], forbidBriefing: false },
  { q: "Rank today's priorities.", subject: ["portfolio", "property", "other"], forbidBriefing: false },
  { q: "Should I repair or replace this water heater?", subject: ["maintenance", "finance", "work_order", "other"], forbidBriefing: true },
  { q: "What's the biggest operational risk this month?", subject: ["property", "portfolio", "maintenance", "other"], capability: "identify_risk" },
  { q: "Which issue should I solve first?", subject: ["property", "work_order", "portfolio", "other"], forbidBriefing: false },
  { q: "Give me three recommendations to improve my portfolio.", subject: ["portfolio", "property"], forbidBriefing: false },
  { q: "What can I automate?", subject: "other", forbidBriefing: true },

  // Analytics
  { q: "Which property performs the best?", subject: "property", forbidBriefing: false },
  { q: "Compare all my buildings.", subject: "property", forbidBriefing: false },
  { q: "Which property has the highest maintenance cost per unit?", subject: ["finance", "property"], forbidBriefing: true },
  { q: "Show occupancy trends.", subject: "other", forbidBriefing: true },
  { q: "Which property has the happiest residents?", subject: ["property", "resident"], forbidBriefing: true },
  { q: "Which building is becoming riskier?", subject: ["property", "maintenance"], forbidBriefing: false },
  { q: "What's my average response time?", subject: ["vendor", "other"], forbidBriefing: true },

  // Natural conversation / briefing
  { q: "Catch me up.", subject: ["portfolio", "other"], intent: "executive_briefing" },
  { q: "Anything important happen today?", subject: ["period", "portfolio", "other"], forbidBriefing: false },
  { q: "What did I miss while I was away?", subject: ["portfolio", "other"], intent: "executive_briefing" },
  { q: "What would you recommend?", subject: ["portfolio", "property", "other"], forbidBriefing: false },

  // Workflow
  { q: "Which workflows are overdue?", subject: "workflow", forbidBriefing: true },
  { q: "Why is this workflow escalated?", subject: "workflow", forbidBriefing: true },
  { q: "Which workflows are blocked?", subject: "workflow", forbidBriefing: true },
  { q: "What decisions are waiting on me?", subject: "workflow", capability: "identify_pending_decision", forbidBriefing: true },
  { q: "What tasks is Ulo handling right now?", subject: "workflow", capability: "explain_status", forbidBriefing: true },
  { q: "What is Ulo working on?", subject: "workflow", capability: "explain_status", forbidBriefing: true },
  { q: "Show me active workflows.", subject: "workflow", forbidBriefing: true },
  { q: "Which maintenance jobs are waiting for vendor approval?", subject: "work_order", forbidBriefing: true },

  // Predictive / external
  { q: "Which property is most likely to need major repairs next?", subject: ["property", "other"], forbidBriefing: true },
  { q: "Which tenant might not renew?", subject: ["resident", "other"], forbidBriefing: true },
  { q: "Predict next month's maintenance volume.", subject: ["other", "finance", "maintenance"], forbidBriefing: true },
  { q: "What maintenance should I schedule before winter?", subject: ["maintenance", "other"], forbidBriefing: true },
  { q: "Forecast occupancy over the next six months.", subject: "other", forbidBriefing: true },
  { q: "Find plumbers near Property A.", subject: "vendor", forbidBriefing: true },
  { q: "What's the average rent for a two-bedroom nearby?", subject: "market_intelligence", intent: "market_rent_estimate", forbidBriefing: true },
  { q: "How much does an HVAC replacement usually cost?", subject: ["finance", "other"], forbidBriefing: true },
  { q: "Are there any weather alerts that could affect my properties?", subject: "weather", forbidBriefing: true },
  { q: "What grants or tax incentives are available for landlords?", subject: "incentives", forbidBriefing: true },

  // Admin / wow
  { q: "Draft a message to all residents about scheduled maintenance.", subject: ["resident", "other"], forbidBriefing: true },
  { q: "Write an email to this vendor asking for an update.", subject: ["vendor", "other"], forbidBriefing: true },
  { q: "Draft a notice for water shutoff tomorrow.", subject: "other", capability: "draft", forbidBriefing: true },
  { q: "If you owned my portfolio, what would you do first?", subject: "portfolio", intent: "property_priority", capability: "recommend" },
  { q: "Find the three biggest problems costing me money.", subject: ["finance", "property", "portfolio"], forbidBriefing: false },
  { q: "Show me everything that needs my attention today.", subject: ["portfolio", "property", "workflow"], forbidBriefing: false },
  { q: "Which property worries you the most, and why?", subject: ["property", "portfolio"], forbidBriefing: false },
  { q: "Summarize my entire portfolio in under a minute.", subject: "portfolio", intent: "executive_briefing" },
  { q: "Pretend you're my regional property manager. Give me today's briefing.", subject: "portfolio", intent: "executive_briefing" },
  { q: "What's the smartest decision I can make today to improve my portfolio?", subject: ["portfolio", "property"], intent: "property_priority", capability: "recommend" },
]

Deno.test("Ask Ulo gold-set: subject routing", () => {
  for (const c of GOLD) {
    assertSubject(c.q, c.subject)
  }
})

Deno.test("Ask Ulo gold-set: forbid briefing where required", () => {
  for (const c of GOLD) {
    if (c.forbidBriefing) assertNoBriefing(c.q)
  }
})

Deno.test("Ask Ulo gold-set: intent locks", () => {
  for (const c of GOLD) {
    if (!c.intent) continue
    const got = classifyAskUloIntent(c.q).intent
    const ok = Array.isArray(c.intent) ? c.intent.includes(got) : got === c.intent
    assertEquals(ok, true, `${c.q}\n  intent got=${got} expected=${JSON.stringify(c.intent)}`)
  }
})

Deno.test("Ask Ulo gold-set: capability locks", () => {
  for (const c of GOLD) {
    if (!c.capability) continue
    const subject = detectQuestionSubject(c.q)
    const got = detectAskUloCapability(c.q, subject).capability
    const ok = Array.isArray(c.capability)
      ? c.capability.includes(got)
      : got === c.capability
    assertEquals(ok, true, `${c.q}\n  capability got=${got} expected=${JSON.stringify(c.capability)}`)
  }
})
