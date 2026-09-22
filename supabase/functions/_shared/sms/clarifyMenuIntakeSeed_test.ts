import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isVagueTicketDescription,
  looksLikeBareRepairRequest,
  looksLikeClarifyMenuRepairEcho,
  resolveIssueSeedFromRecentInbounds,
} from "./clarifyMenuIntakeSeed.ts"
import { inferIssueTypeFromText } from "./residentIntakeTypes.ts"
import {
  matchesWaterOutage,
  matchesWholeHomeWaterOutage,
} from "../../../../shared/maintenance/deterministicRules.ts"
import { applyQuestionPlan, applyDiagnosticAnswer } from "./determineNextMaintenanceQuestion.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import { buildConfirmationSummary } from "./residentIntakeTypes.ts"

Deno.test("no hot water is plumbing via inferIssueTypeFromText", () => {
  assertEquals(inferIssueTypeFromText("No hot water"), "plumbing")
  assertEquals(inferIssueTypeFromText("I have no hot water water"), "plumbing")
  assertEquals(inferIssueTypeFromText("water heater not working"), "plumbing")
})

Deno.test("no hot water starts maintenance_new (not clarify handoff)", () => {
  const interp = heuristicInterpretInbound("No hot water")
  assertEquals(interp.intent, "maintenance_new")
})

Deno.test("clarify menu echo A repair is bare repair, not a ticket headline", () => {
  assertEquals(looksLikeClarifyMenuRepairEcho("A repair"), true)
  assertEquals(looksLikeClarifyMenuRepairEcho("A repair "), true)
  assertEquals(looksLikeBareRepairRequest("A repair"), true)
  assertEquals(isVagueTicketDescription("A repair"), true)
  assertEquals(isVagueTicketDescription("A repair is needed."), true)
  assertEquals(isVagueTicketDescription("No hot water"), false)
})

Deno.test("Adriana: menu echo recovers prior no hot water into the ticket seed", () => {
  const seed = resolveIssueSeedFromRecentInbounds("A repair", [
    "A repair",
    "I have no hot water water",
    "No hot water",
    "Never mind",
  ])
  assertEquals(seed, "I have no hot water water")
  assertEquals(inferIssueTypeFromText(seed), "plumbing")
})

Deno.test("vague A repair intake asks symptom before room/photo/confirm", () => {
  const planned = applyQuestionPlan({
    initial_message: "A repair",
    description: "A repair",
    issue_type: "general",
    vendor_trade: "general",
    primary_category: "general",
    preferred_contact_method: "text",
  })
  assertEquals(planned.diagnostic_question_type, "symptom_clarify")
  assertMatch(planned.diagnostic_question ?? "", /what needs to be fixed/i)
  assertEquals(planned.step === "awaiting_confirm", false)
})

Deno.test("symptom_clarify replaces menu echo with real issue on the ticket", () => {
  const after = applyDiagnosticAnswer(
    {
      initial_message: "A repair",
      description: "A repair",
      issue_type: "general",
      vendor_trade: "general",
      diagnostic_question_type: "symptom_clarify",
      preferred_contact_method: "text",
    },
    "No hot water",
  )
  assertEquals(after.description, "No hot water")
  assertEquals(after.initial_message, "No hot water")
  assertEquals(after.issue_type, "plumbing")
  assertEquals(after.vendor_trade, "plumbing")
  const confirm = buildConfirmationSummary(applyQuestionPlan(after))
  assertMatch(confirm, /hot water/i)
  assertEquals(/[“"]A repair[.”"]/i.test(confirm), false)
})

Deno.test("no water is recognized as plumbing, apart from no hot water", () => {
  assertEquals(inferIssueTypeFromText("I have no water"), "plumbing")
  assertEquals(inferIssueTypeFromText("There's no water anywhere"), "plumbing")
  assertEquals(inferIssueTypeFromText("the water is shut off"), "plumbing")
  // "no hot water" must not be swallowed by the outage rule.
  assertEquals(matchesWaterOutage("I have no hot water water"), false)
  assertEquals(matchesWaterOutage("no hot water"), false)
  assertEquals(matchesWholeHomeWaterOutage("There's no water anywhere"), true)
  assertEquals(matchesWholeHomeWaterOutage("no water from the kitchen faucet"), false)
})

Deno.test("seed recovery takes the newest problem report, not the newest classifiable one", () => {
  // Adriana's thread: "I have no water" came 11 seconds before the menu reply,
  // while "I have no hot water water" was hours old and already cancelled.
  const seed = resolveIssueSeedFromRecentInbounds("Repair", [
    "I have no water",
    "I have no hot water water",
  ])
  assertEquals(seed, "I have no water")
})

Deno.test("seed recovery stops at a cancelled request", () => {
  const seed = resolveIssueSeedFromRecentInbounds("A repair", [
    "Never mind",
    "My toilet is clogged",
  ])
  assertEquals(seed, "A repair")
})

Deno.test("seed recovery ignores intake answers with no problem signal", () => {
  const seed = resolveIssueSeedFromRecentInbounds("A repair", [
    "Yes",
    "Skip",
    "Bedroom bathroom",
    "My sink is leaking",
  ])
  assertEquals(seed, "My sink is leaking")
})

Deno.test("no water intake asks about water, never about hot water", () => {
  const planned = applyQuestionPlan({
    initial_message: "I have no water",
    description: "I have no water",
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    preferred_contact_method: "text",
  })
  assertEquals(planned.diagnostic_question_type, "plumbing_water_outage_scope")
  assertMatch(planned.diagnostic_question ?? "", /water out everywhere/i)
  assertEquals(/hot water/i.test(planned.diagnostic_question ?? ""), false)
})

Deno.test("a total outage answer outranks an opening hot water report", () => {
  // Her real state: opened with hot water, then corrected to no water at all.
  const confirm = buildConfirmationSummary({
    initial_message: "I have no hot water water",
    description: "I have no hot water water",
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    preferred_contact_method: "text",
    diagnostic_facts: { plumbing_hot_water_scope: "There's no water anywhere" },
  })
  assertMatch(confirm, /No water in the home/i)
  assertEquals(/[“"]No hot water[.”"]/i.test(confirm), false)
  // The hot-water tip is wrong when there is no water to run.
  assertEquals(/use cold water/i.test(confirm), false)
  assertMatch(confirm, /faucets turned off/i)
})

Deno.test("a No answer next to an overflow note is not a water outage", () => {
  // Intake appends answers to the description, so this exact string occurs.
  assertEquals(
    matchesWaterOutage("My sink is clogged. Tenant update: No Water is not actively overflowing"),
    false,
  )
  // A real report that happens to use the same verb still counts.
  assertEquals(matchesWaterOutage("no water is coming out of the faucet"), true)
})
