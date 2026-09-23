/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildEstimateDecisionStatusSms,
  resolveEstimateScheduleKickoff,
  shouldKickoffScheduleOnEstimateApprove,
  vendorJobDecisionFromWorkStatus,
} from "./workOrderAdminStatusSms.ts"

Deno.test("vendorJobDecisionFromWorkStatus maps statuses", () => {
  assertEquals(vendorJobDecisionFromWorkStatus("pending_accept"), "pending")
  assertEquals(vendorJobDecisionFromWorkStatus("accepted"), "accepted")
  assertEquals(vendorJobDecisionFromWorkStatus("in_progress"), "accepted")
  assertEquals(vendorJobDecisionFromWorkStatus("declined"), "declined")
  assertEquals(vendorJobDecisionFromWorkStatus(null), "pending")
})

Deno.test("approve SMS for pending vendor keeps asking YES/NO", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 450,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "pending",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "Hi Flex Plumbing,")
  assertStringIncludes(body!, "Update for work order WO-F23A.")
  assertStringIncludes(body!, "approved your estimate of $450.00")
  assertStringIncludes(body!, "Would you like to continue with this job?")
  assertStringIncludes(
    body!,
    "Reply YES to accept the work order or NO if you're unable to take it.",
  )
  assertStringIncludes(
    body!,
    "After you accept, we'll set a visit time with the resident.",
  )
  assertStringIncludes(body!, "View details:")
  assertStringIncludes(body!, "https://www.ulohome.io/w/token")
})

Deno.test("approve SMS for accepted vendor without schedule ask does not re-ask YES", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "accepted",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "You can now continue with the repair.")
  assertEquals(body!.includes("Reply YES"), false)
  assertEquals(body!.includes("Would you like to continue"), false)
  assertEquals(body!.includes("earliest availability"), false)
})

Deno.test("approve SMS confirms existing vendor window with the resident", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "accepted",
    confirmingWindowText: "Thu 2–4pm",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "We're confirming Thu 2–4pm with the resident now.")
  assertEquals(body!.includes("What's your earliest availability?"), false)
  assertEquals(body!.includes("You can now continue with the repair."), false)
})

Deno.test("approve SMS for accepted vendor with schedule kickoff asks for a visit window", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "accepted",
    includeScheduleAsk: true,
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "What's your earliest availability?")
  assertStringIncludes(body!, "We'll confirm that time with the resident before you go.")
  assertEquals(body!.includes("You can now continue with the repair."), false)
  assertEquals(body!.includes("Reply YES to accept"), false)
})

Deno.test("approve schedule kickoff includes resident-shared times when present", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    vendorDecision: "accepted",
    includeScheduleAsk: true,
    residentAvailabilityText: "weekdays after 5pm",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "The resident shared these times: weekdays after 5pm.")
  assertEquals(body!.includes("What's your earliest availability?"), false)
})

Deno.test("resolveEstimateScheduleKickoff prefers tenant confirm when window exists", () => {
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "accepted",
      ticketId: "t1",
      proposedWindowText: "Thu 2–4pm",
    }),
    { kind: "confirm_tenant", windowText: "Thu 2–4pm", scheduledAt: null },
  )
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "accepted",
      ticketId: "t1",
      proposedWindowText: "Thu 2–4pm",
      scheduleStep: "awaiting_availability",
      scheduleTicketId: "t1",
    }).kind,
    "confirm_tenant",
  )
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "accepted",
      ticketId: "t1",
    }),
    { kind: "ask_vendor" },
  )
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "pending",
      ticketId: "t1",
      proposedWindowText: "Thu 2–4pm",
    }),
    { kind: "none" },
  )
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "accepted",
      scheduleConfirmedAt: "2026-09-22T12:00:00Z",
      ticketId: "t1",
      proposedWindowText: "Thu 2–4pm",
    }),
    { kind: "none" },
  )
  assertEquals(
    resolveEstimateScheduleKickoff({
      approved: true,
      vendorDecision: "accepted",
      scheduleStep: "awaiting_tenant_confirmation",
      scheduleTicketId: "t1",
      ticketId: "t1",
      proposedWindowText: "Thu 2–4pm",
    }),
    { kind: "none" },
  )
})

Deno.test("shouldKickoffScheduleOnEstimateApprove gates correctly", () => {
  assertEquals(
    shouldKickoffScheduleOnEstimateApprove({
      approved: true,
      vendorDecision: "accepted",
      ticketId: "t1",
    }),
    true,
  )
  assertEquals(
    shouldKickoffScheduleOnEstimateApprove({
      approved: true,
      vendorDecision: "pending",
      ticketId: "t1",
    }),
    false,
  )
  assertEquals(
    shouldKickoffScheduleOnEstimateApprove({
      approved: true,
      vendorDecision: "accepted",
      scheduleConfirmedAt: "2026-09-22T12:00:00Z",
      ticketId: "t1",
    }),
    false,
  )
  assertEquals(
    shouldKickoffScheduleOnEstimateApprove({
      approved: true,
      vendorDecision: "accepted",
      scheduleStep: "awaiting_availability",
      scheduleTicketId: "t1",
      ticketId: "t1",
    }),
    false,
  )
  assertEquals(
    shouldKickoffScheduleOnEstimateApprove({
      approved: true,
      vendorDecision: "accepted",
      scheduleStep: "awaiting_tenant_confirmation",
      scheduleTicketId: "t1",
      ticketId: "t1",
    }),
    false,
  )
})

Deno.test("declined vendor gets no estimate decision SMS", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    vendorDecision: "declined",
  })
  assertEquals(body, null)
})

Deno.test("estimate decline asks for an updated estimate with the estimate link", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: false,
    totalCost: 450,
    jobLink: "https://www.ulohome.io/w/token",
    estimateLink: "https://www.ulohome.io/estimate/token",
    vendorDecision: "accepted",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "did not approve your estimate of $450.00")
  assertStringIncludes(body!, "updated estimate")
  assertStringIncludes(body!, "https://www.ulohome.io/estimate/token")
  assertEquals(body!.includes("Reply YES"), false)
  assertEquals(body!.includes("/w/token"), false)
})

Deno.test("estimate decline for a pending vendor still asks for an updated estimate", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: false,
    totalCost: 450,
    estimateLink: "https://www.ulohome.io/estimate/token",
    vendorDecision: "pending",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "updated estimate")
  assertEquals(body!.includes("Would you like to continue"), false)
})
