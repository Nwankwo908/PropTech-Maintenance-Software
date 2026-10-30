/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { expandQuestionSearchTerms, textMatchesOpsTerms } from "../../tools/maintenance/deepOperationalInvestigation.ts"
import { isClosedMaintenanceTicket } from "../../tools/maintenance/searchOperationalRecords.ts"
import {
  answerFromUploadedText,
  isUploadedDocumentQuestion,
  isDetailedRecordQuestion,
  preparedAnswerCoversAskedFacts,
  reportedDetailLine,
  retrievedRecordMatchesQuestionSubject,
} from "../../tools/maintenance/reportedFactAnswer.ts"
import { formatCatchAllWorkOrdersMarkdown } from "../../retrieval/catchAllFallback.ts"
import type { OperationalWorkOrder } from "../../tools/maintenance/searchOperationalRecords.ts"
import { supportNotifyRetryDelayMs } from "../../../support/retrySupportNotifications.ts"

Deno.test("detailed record questions are separate from a plain count", () => {
  assertEquals(isDetailedRecordQuestion("How many open work orders do I have?"), false)
  assertEquals(isDetailedRecordQuestion("What indoor temperature is recorded?"), true)
  assertEquals(isDetailedRecordQuestion("Who feels unwell on the air conditioning request?"), true)
  assertEquals(isDetailedRecordQuestion("Is there an open request about a gas smell?"), true)
})

Deno.test("a temperature card has to be about the same subject", () => {
  const ac = "Issue: AC. Reported: It is 100 inside and my son feels dizzy. Property: Maintenance test house."
  const plumbing = "WO-5585 plumbing. A nearby reading was 100. Property: Maintenance test house."
  assertEquals(retrievedRecordMatchesQuestionSubject("What indoor temperature is recorded on the air conditioning problem?", ac), true)
  assertEquals(retrievedRecordMatchesQuestionSubject("How hot is the purple staircase?", plumbing), false)
})

Deno.test("gas question terms match a smell report and ignore filler words", () => {
  const terms = expandQuestionSearchTerms(["Is there an open request about a gas smell at Maintenance test house?"])
  assertEquals(terms.includes("gas"), true)
  assertEquals(terms.includes("smell"), true)
  assertEquals(terms.includes("house"), false)
})

Deno.test("short search words do not match inside other words", () => {
  assertEquals(textMatchesOpsTerms("Home Check furnace or boiler", ["air"]), false)
  assertEquals(textMatchesOpsTerms("I smell gas in the kitchen", ["gas"]), true)
})

Deno.test("closed tickets use the same rule as the open count", () => {
  assertEquals(isClosedMaintenanceTicket({ completed_at: "2026-01-01", status: "open" }), true)
  assertEquals(isClosedMaintenanceTicket({ status: "cancelled" }), true)
  assertEquals(isClosedMaintenanceTicket({ status: "open", completed_at: null, cancelled_at: null }), false)
})

Deno.test("catch-all card keeps the reported temperature and omits a single-family unit", () => {
  const wo: OperationalWorkOrder = {
    workOrderId: "WO-30A0",
    maintenanceRequestId: "id",
    workflowRunId: null,
    propertyName: "Maintenance test house",
    unitLabel: "1",
    propertyType: "single_family",
    category: "hvac",
    title: "AC issue",
    description: "AC issue",
    reportedDetail: "The AC isn't working. It's 100 inside and my son feels dizzy.",
    priority: "emergency",
    urgency: "emergency",
    estimatedCost: null,
    estimatedCostSource: null,
    repairScope: "Repair",
    laborEstimate: "1 hour",
    workflowStage: "new_intake",
    workflowStatus: "active",
    vendorName: null,
    vendorWorkStatus: "unassigned",
    slaExpired: true,
    approvalStatus: "not_required",
    dueAt: null,
    expectedCompletion: null,
    createdAt: new Date().toISOString(),
    daysOpen: 2,
    estimatedMinutes: null,
  }
  const md = formatCatchAllWorkOrdersMarkdown([wo])
  assertEquals(md.includes("100"), true)
  assertEquals(md.includes("dizzy"), true)
  assertEquals(/unit\s*1/i.test(md), false)
  assertEquals(md.includes("Maintenance test house"), true)
  assertEquals(preparedAnswerCoversAskedFacts("What indoor temperature is recorded?", md), true)
  assertEquals(reportedDetailLine(wo)?.includes("100"), true)
})

Deno.test("uploaded lease text answers rent and otherwise asks for a paste", () => {
  assertEquals(isUploadedDocumentQuestion("What monthly rent does the uploaded lease PDF state?"), true)
  const answer = answerFromUploadedText(
    "What monthly rent does the uploaded lease PDF state?",
    "Monthly rent is 1847 dollars. QAASKULORENT1847.",
  )
  assertEquals(answer?.includes("1847"), true)
  assertEquals(answerFromUploadedText(
    "What does the uploaded insurance policy say about the deductible?",
    "Monthly rent is 1847 dollars.",
  ), null)
})

Deno.test("support notification retries stop after three attempts", () => {
  assertEquals(supportNotifyRetryDelayMs(1), 5 * 60 * 1000)
  assertEquals(supportNotifyRetryDelayMs(2), 30 * 60 * 1000)
  assertEquals(supportNotifyRetryDelayMs(3), null)
})
