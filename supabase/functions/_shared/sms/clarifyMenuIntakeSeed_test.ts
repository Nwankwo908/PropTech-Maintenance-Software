import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isVagueTicketDescription,
  looksLikeBareRepairRequest,
  looksLikeClarifyMenuRepairEcho,
  resolveIssueSeed,
  resolveIssueSeedFromRecentInbounds,
  SEED_LOOKBACK_MINUTES,
} from "./clarifyMenuIntakeSeed.ts"
import { inferIssueTypeFromText } from "./residentIntakeTypes.ts"
import {
  matchesWaterOutage,
  matchesWholeHomeWaterOutage,
} from "../../../../shared/maintenance/deterministicRules.ts"
import { applyQuestionPlan, applyDiagnosticAnswer } from "./determineNextMaintenanceQuestion.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import {
  buildConfirmationSummary,
  headlineUpdateLine,
  issueSummaryBullet,
} from "./residentIntakeTypes.ts"

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

Deno.test("the answer our scope question invites reads as a whole-home outage", () => {
  // We ask "everywhere in the home, or just at one sink or shower?", so
  // residents answer in those words. Found live: "everywhere" was missing.
  const answer = "I have no water\nTenant update: Everywhere in the home"
  assertEquals(matchesWholeHomeWaterOutage(answer), true)
  assertEquals(matchesWholeHomeWaterOutage("no water, every faucet in the unit"), true)
  assertEquals(matchesWholeHomeWaterOutage("no water all over the house"), true)
  assertEquals(
    matchesWholeHomeWaterOutage("I have no water\nTenant update: Just the kitchen sink"),
    false,
  )

  const confirm = buildConfirmationSummary({
    initial_message: "I have no water",
    description: answer,
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    preferred_contact_method: "text",
    diagnostic_facts: { plumbing_water_outage_scope: "Everywhere in the home" },
  })
  assertMatch(confirm, /No water in the home/i)
  assertMatch(confirm, /faucets turned off/i)
  assertEquals(/use cold water/i.test(confirm), false)
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

Deno.test("reporting the absence of water damage is not an outage", () => {
  // Residents answer safety questions this way, and an outage now drives
  // same-day urgency, so a false read here would over-escalate.
  assertEquals(matchesWaterOutage("no water damage"), false)
  assertEquals(matchesWaterOutage("there is no water damage on the ceiling"), false)
  assertEquals(matchesWaterOutage("no water stains"), false)
  assertEquals(matchesWaterOutage("no water pressure"), false)
  assertEquals(matchesWaterOutage("no water in the home"), true)
})

Deno.test("a changed headline is stated back to the resident", () => {
  // Her real correction: opened on hot water, then "no water anywhere".
  const before = issueSummaryBullet({
    initial_message: "I have no hot water water",
    description: "I have no hot water water",
    issue_type: "plumbing",
    preferred_contact_method: "text",
  })
  const after = issueSummaryBullet({
    initial_message: "I have no hot water water",
    description: "I have no hot water water",
    issue_type: "plumbing",
    preferred_contact_method: "text",
    diagnostic_facts: { plumbing_hot_water_scope: "There's no water anywhere" },
  })
  assertEquals(before, "No hot water")
  assertEquals(after, "No water in the home")

  const line = headlineUpdateLine(before, after)
  assertMatch(line ?? "", /updated this to/i)
  assertMatch(line ?? "", /No water in the home/)

  // Unchanged readings stay quiet, and there is nothing to correct at the start.
  assertEquals(headlineUpdateLine(after, after), null)
  assertEquals(headlineUpdateLine(undefined, after), null)
})

Deno.test("seed selection reports when it differs from the newest text", () => {
  const recovered = resolveIssueSeed("Repair", [
    "I have no water",
    "I have no hot water water",
  ])
  assertEquals(recovered.seed, "I have no water")
  assertEquals(recovered.source, "recovered")
  assertEquals(recovered.mostRecentInbound, "I have no water")
  assertEquals(recovered.differsFromMostRecent, false)
  assertEquals(recovered.lookbackMinutes, SEED_LOOKBACK_MINUTES)

  // Here the newest text is not the one we use — the case worth watching.
  const skipped = resolveIssueSeed("A repair", ["Yes", "Skip", "My sink is leaking"])
  assertEquals(skipped.seed, "My sink is leaking")
  assertEquals(skipped.mostRecentInbound, "Yes")
  assertEquals(skipped.differsFromMostRecent, true)
  assertEquals(skipped.skipped, 2)

  const cancelled = resolveIssueSeed("A repair", ["Never mind", "My toilet is clogged"])
  assertEquals(cancelled.seed, "A repair")
  assertEquals(cancelled.source, "current")
  assertEquals(cancelled.stoppedAtCancel, true)
})

Deno.test("the reclassification notice fires once, on the turn it changes", () => {
  // Adriana's sequence, turn by turn: "I have no water" then the scope answer
  // that makes it a whole-home outage, then a duration answer that does not.
  const opened = applyQuestionPlan({
    initial_message: "I have no water",
    description: "I have no water",
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    preferred_contact_method: "text",
  })
  let told = issueSummaryBullet(opened)
  assertEquals(told, "No water")

  const scoped = applyDiagnosticAnswer(opened, "Everywhere in the home")
  const afterScope = issueSummaryBullet(scoped)
  const notice = headlineUpdateLine(told, afterScope)
  assertMatch(notice ?? "", /I've updated this to .*No water in the home/)
  told = afterScope

  const dated = applyDiagnosticAnswer(
    { ...scoped, diagnostic_question_type: "duration_material" },
    "Yesterday",
  )
  // Same reading, so the resident is not told twice.
  assertEquals(headlineUpdateLine(told, issueSummaryBullet(dated)), null)
})
