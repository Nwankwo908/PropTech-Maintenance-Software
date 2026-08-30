/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  allowsNewMaintenanceTicket,
  resolveMaintenanceWorkIntent,
  tenantIntentForResolved,
} from "./resolveMaintenanceWorkIntent.ts"
import type { OpenRequestSummary } from "./inboundContextualFollowUp.ts"

const electrical: OpenRequestSummary = {
  id: "t-elec",
  description: "Bedroom outlet sparking",
  vendor_work_status: "accepted",
  issue_category: "electrical",
}

const plumbing: OpenRequestSummary = {
  id: "t-plumb",
  description: "Kitchen sink leak",
  vendor_work_status: "in_progress",
  issue_category: "plumbing",
}

const ac: OpenRequestSummary = {
  id: "t-ac",
  description: "AC not cooling",
  vendor_work_status: "unassigned",
  issue_category: "hvac",
}

Deno.test("Saad: who is coming to fix electrical → vendor/status, not NEW_ISSUE", () => {
  const resolved = resolveMaintenanceWorkIntent({
    body: "Who is coming to fix my electrical issue?",
    heuristicIntent: "maintenance_new",
    openTickets: [electrical],
  })
  assertEquals(resolved, "VENDOR_QUESTION")
  assertEquals(allowsNewMaintenanceTicket(resolved), false)
  assertEquals(tenantIntentForResolved(resolved), "maintenance_status")
})

Deno.test("status of my repair → STATUS", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "What's the status of my repair?",
      openTickets: [electrical],
    }),
    "STATUS",
  )
})

Deno.test("when is my electrician coming → STATUS or VENDOR_QUESTION", () => {
  const resolved = resolveMaintenanceWorkIntent({
    body: "When is my electrician coming?",
    openTickets: [electrical],
  })
  assertEquals(
    resolved === "STATUS" || resolved === "VENDOR_QUESTION" || resolved === "SCHEDULING",
    true,
  )
  assertEquals(allowsNewMaintenanceTicket(resolved), false)
})

Deno.test("did you find someone → not NEW_ISSUE", () => {
  const resolved = resolveMaintenanceWorkIntent({
    body: "Did you find someone?",
    openTickets: [electrical],
  })
  assertEquals(allowsNewMaintenanceTicket(resolved), false)
})

Deno.test("it's getting worse → WORSENED", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "It's getting worse.",
      openTickets: [electrical],
    }),
    "WORSENED",
  )
})

Deno.test("they never showed up → NO_SHOW", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "They never showed up.",
      openTickets: [electrical],
    }),
    "NO_SHOW",
  )
})

Deno.test("photo without problem report → PHOTO_UPDATE", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "Here's another photo.",
      hasMedia: true,
      openTickets: [electrical],
    }),
    "PHOTO_UPDATE",
  )
})

Deno.test("clearly separate bathroom faucet → NEW_ISSUE", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "My bathroom faucet just broke.",
      heuristicIntent: "maintenance_new",
      openTickets: [electrical],
    }),
    "NEW_ISSUE",
  )
  assertEquals(allowsNewMaintenanceTicket("NEW_ISSUE"), true)
})

Deno.test("different trade is a new work order even if the message sounds like a follow-up", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "The AC is not working",
      heuristicIntent: "maintenance_new",
      openTickets: [plumbing],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("different trade is a new work order when the open ticket has no category", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "My toilet is overflowing",
      openTickets: [{
        id: "t-vague",
        description: "Need help",
        vendor_work_status: "unassigned",
        issue_category: null,
      }],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("possibly related kitchen lights → AMBIGUOUS", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "Now my kitchen lights aren't working either.",
      heuristicIntent: "maintenance_new",
      openTickets: [electrical],
    }),
    "AMBIGUOUS",
  )
})

Deno.test("multiple open + vague who's coming → AMBIGUOUS", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "Who's coming?",
      openTickets: [electrical, plumbing, ac],
    }),
    "AMBIGUOUS",
  )
})

Deno.test("trade words alone in assignment question do not allow a new ticket", () => {
  const resolved = resolveMaintenanceWorkIntent({
    body: "Who is coming to fix my electrical issue?",
    heuristicIntent: "maintenance_new",
    openTickets: [electrical],
  })
  assertEquals(allowsNewMaintenanceTicket(resolved), false)
})

Deno.test("gas smell is NEW_ISSUE even with an open plumbing ticket", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "I smell gas in the kitchen",
      heuristicIntent: "maintenance_new",
      openTickets: [plumbing],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("no open tickets + problem report → NEW_ISSUE", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "My toilet is overflowing",
      openTickets: [],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("Osi: door damaged → NEW_ISSUE (not landlord handoff)", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "My door is damaged",
      openTickets: [],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("Osi: I need a repair → NEW_ISSUE (not landlord handoff)", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "I need a repair",
      openTickets: [],
    }),
    "NEW_ISSUE",
  )
})
