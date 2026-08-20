/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  heuristicInterpretInbound,
  looksLikeCancelRepair,
  looksLikeRentBalanceAsk,
  shouldHandleInterpretedIntent,
} from "./inboundInterpretation.ts"
import {
  classifyFollowUpKind,
  resolveContextualFollowUp,
} from "./inboundContextualFollowUp.ts"
import { resolveMaintenanceWorkIntent } from "./resolveMaintenanceWorkIntent.ts"
import {
  isActiveMaintenanceTicketStatus,
  isHistoricalMaintenanceTicketStatus,
  looksLikeClosedRepairStatusAsk,
  looksLikeMaintenanceRelatedMessage,
  looksLikeProblemReturned,
  partitionMaintenanceTicketsByStatus,
} from "./maintenanceTicketContext.ts"

const sinkOpen = {
  id: "sink-1",
  description: "Kitchen sink is leaking",
  vendor_work_status: "pending_accept",
  issue_category: "plumbing",
}

const outletOpen = {
  id: "outlet-1",
  description: "The outlet in my bedroom is sparking",
  vendor_work_status: "unassigned",
  issue_category: "electrical",
}

const sinkClosed = {
  id: "sink-closed",
  description: "Kitchen sink is leaking",
  vendor_work_status: "cancelled",
  issue_category: "plumbing",
}

const plumbingCompleted = {
  id: "plumb-done",
  description: "Kitchen sink leak",
  vendor_work_status: "completed",
  issue_category: "plumbing",
}

const electricalClosed = {
  id: "elec-closed",
  description: "Bedroom outlet sparking",
  vendor_work_status: "cancelled",
  issue_category: "electrical",
}

Deno.test("active vs historical status partition", () => {
  assertEquals(isActiveMaintenanceTicketStatus("pending_accept"), true)
  assertEquals(isHistoricalMaintenanceTicketStatus("cancelled"), true)
  assertEquals(isHistoricalMaintenanceTicketStatus("completed"), true)
  const { active, historical } = partitionMaintenanceTicketsByStatus([
    sinkOpen,
    sinkClosed,
    plumbingCompleted,
  ])
  assertEquals(active.map((t) => t.id), ["sink-1"])
  assertEquals(historical.map((t) => t.id).sort(), ["plumb-done", "sink-closed"])
})

Deno.test("closure intent: It's fixed / You can close it / Cancel my request", () => {
  assertEquals(looksLikeCancelRepair("It's fixed."), true)
  assertEquals(looksLikeCancelRepair("You can close it."), true)
  assertEquals(looksLikeCancelRepair("Cancel my request."), true)
  assertEquals(looksLikeCancelRepair("Everything's good now."), true)
  assertEquals(looksLikeCancelRepair("We're all good."), true)
  assertEquals(looksLikeCancelRepair("The plumber already fixed it."), true)
  assertEquals(looksLikeCancelRepair("I don't need anyone anymore."), true)
  assertEquals(heuristicInterpretInbound("It's fixed.").intent, "maintenance_cancel")
  assertEquals(heuristicInterpretInbound("You can close it.").intent, "maintenance_cancel")
  assertEquals(heuristicInterpretInbound("Cancel my request.").intent, "maintenance_cancel")
})

Deno.test("open ticket + It's fixed → cancel follow-up on that ticket", () => {
  const decision = resolveContextualFollowUp({
    body: "It's fixed.",
    hasMedia: false,
    intent: "maintenance_cancel",
    openTickets: [sinkOpen],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_cancel")
    assertEquals(decision.ticketId, "sink-1")
  }
})

Deno.test("multiple active tickets + It's fixed → clarify before closing", () => {
  const decision = resolveContextualFollowUp({
    body: "It's fixed.",
    hasMedia: false,
    intent: "maintenance_cancel",
    openTickets: [sinkOpen, outletOpen],
    activeIntake: false,
  })
  assertEquals(decision.action, "clarify")
  if (decision.action === "clarify") {
    assertEquals(decision.ticketIds.sort(), ["outlet-1", "sink-1"])
  }
})

Deno.test("closed ticket remains historical; closed status ask confirms closed", () => {
  assertEquals(looksLikeClosedRepairStatusAsk("Is that repair closed?"), true)
  assertEquals(looksLikeClosedRepairStatusAsk("Didn't I already close that sink request?"), true)
  const decision = resolveContextualFollowUp({
    body: "Is that repair closed?",
    hasMedia: false,
    intent: "maintenance_status",
    openTickets: [sinkClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
    assertEquals(decision.slots.historical, "true")
    assertEquals(decision.ticketId, "sink-closed")
  }
})

Deno.test("closed ticket + problem came back → reopen on historical", () => {
  assertEquals(looksLikeProblemReturned("The problem came back."), true)
  assertEquals(looksLikeProblemReturned("The sink is leaking again."), true)
  assertEquals(classifyFollowUpKind("The sink is leaking again.", false), "reopen")
  const decision = resolveContextualFollowUp({
    body: "The sink is leaking again.",
    hasMedia: false,
    intent: null,
    openTickets: [sinkClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_update")
    assertEquals(decision.slots.kind, "reopen")
    assertEquals(decision.ticketId, "sink-closed")
  }
})

Deno.test("closed plumbing + When is the plumber coming? → historical status", () => {
  const decision = resolveContextualFollowUp({
    body: "When is the plumber coming?",
    hasMedia: false,
    intent: "maintenance_status",
    openTickets: [plumbingCompleted],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
    assertEquals(decision.slots.historical, "true")
    assertEquals(decision.ticketId, "plumb-done")
  }
})

Deno.test("Saad: How much I owe in rent is rent_balance", () => {
  assertEquals(looksLikeRentBalanceAsk("How much I owe in rent"), true)
  assertEquals(heuristicInterpretInbound("How much I owe in rent").intent, "rent_balance")
  assertEquals(heuristicInterpretInbound("How much rent do I owe?").intent, "rent_balance")
  const decision = resolveContextualFollowUp({
    body: "How much I owe in rent",
    hasMedia: false,
    intent: "rent_balance",
    openTickets: [{
      id: "today-1",
      description: "Today\n\nAffected area: today.",
      vendor_work_status: "unassigned",
      issue_category: null,
    }],
    activeIntake: false,
  })
  assertEquals(decision.action, "switch_intent")
})

Deno.test("closed electrical + rent question → rent flow wins (no RELATED)", () => {
  assertEquals(
    heuristicInterpretInbound("How much rent do I owe?").intent,
    "rent_balance",
  )
  const decision = resolveContextualFollowUp({
    body: "How much rent do I owe?",
    hasMedia: false,
    intent: "rent_balance",
    openTickets: [electricalClosed, outletOpen],
    activeIntake: false,
  })
  assertEquals(decision.action, "switch_intent")
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "How much rent do I owe?",
      heuristicIntent: "rent_balance",
      openTickets: [outletOpen],
    }),
    "OTHER",
  )
})

Deno.test("closed maintenance + lease question → lease wins", () => {
  const decision = resolveContextualFollowUp({
    body: "When does my lease expire?",
    hasMedia: false,
    intent: "lease_info",
    openTickets: [electricalClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "switch_intent")
})

Deno.test("closed maintenance + move-out intent → move-out wins", () => {
  const decision = resolveContextualFollowUp({
    body: "I'm moving out June 30.",
    hasMedia: false,
    intent: "move_out_intent",
    openTickets: [electricalClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "switch_intent")
})

Deno.test("historical ticket does not become active context from trade keywords alone", () => {
  assertEquals(looksLikeMaintenanceRelatedMessage("How much rent do I owe?"), false)
  const resolved = resolveMaintenanceWorkIntent({
    body: "How much rent do I owe?",
    openTickets: [outletOpen],
  })
  // Without heuristic, rent-shaped text must not become AMBIGUOUS RELATED.
  assertEquals(resolved, "OTHER")
  const decision = resolveContextualFollowUp({
    body: "Thanks",
    hasMedia: false,
    intent: null,
    openTickets: [electricalClosed],
    activeIntake: false,
  })
  // No active tickets → do not RELATED/SEPARATE against history.
  assertEquals(decision.action !== "follow_up" ||
    (decision.action === "follow_up" && decision.slots.needs_related_clarify !== "true"), true)
})

Deno.test("junk Today ticket does not drive RELATED for rent", () => {
  const junk = {
    id: "today-1",
    description: "Today\n\nAffected area: today.",
    vendor_work_status: "unassigned",
    issue_category: null,
  }
  const decision = resolveContextualFollowUp({
    body: "How much rent do I owe?",
    hasMedia: false,
    intent: heuristicInterpretInbound("How much rent do I owe?").intent,
    openTickets: [junk],
    activeIntake: false,
  })
  assertEquals(decision.action, "switch_intent")
})

Deno.test("STOP/HELP still skip interpretation", () => {
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("STOP"), "STOP"), false)
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("HELP"), "HELP"), false)
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("START"), "START"), false)
})

Deno.test("safety/emergency stays NEW_ISSUE even with open tickets", () => {
  assertEquals(
    resolveMaintenanceWorkIntent({
      body: "I smell gas in the kitchen",
      openTickets: [sinkOpen],
    }),
    "NEW_ISSUE",
  )
})

Deno.test("already-closed cancel maps to cancel follow-up on historical (idempotent act)", () => {
  const decision = resolveContextualFollowUp({
    body: "Cancel that request.",
    hasMedia: false,
    intent: "maintenance_cancel",
    openTickets: [sinkClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_cancel")
    assertEquals(decision.slots.historical, "true")
    assertEquals(decision.ticketId, "sink-closed")
  }
})

Deno.test("recurrence does not start unrelated new_issue when historical match exists", () => {
  const decision = resolveContextualFollowUp({
    body: "The outlet started sparking again.",
    hasMedia: false,
    intent: null,
    openTickets: [electricalClosed],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.slots.kind, "reopen")
    assertEquals(decision.ticketId, "elec-closed")
  }
})
