/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyFollowUpKind,
  dedupeTicketsByRequestLabel,
  isDistinctNewIssue,
  isIdentifiableRequestLabel,
  looksLikeAdditionalIssue,
  matchOpenRequests,
  resolveContextualFollowUp,
  shouldKeepActivePendingContext,
  type OpenRequestSummary,
} from "./inboundContextualFollowUp.ts"

const leak: OpenRequestSummary = {
  id: "t-leak",
  description: "Kitchen sink is leaking",
  vendor_work_status: "in_progress",
  issue_category: "plumbing",
}

const ac: OpenRequestSummary = {
  id: "t-ac",
  description: "AC not cooling",
  vendor_work_status: "accepted",
  issue_category: "hvac",
}

Deno.test("follow-up phrases attach to the open request", () => {
  assertEquals(classifyFollowUpKind("It's getting worse.", false), "worse")
  assertEquals(classifyFollowUpKind("Actually, it stopped.", false), "resolved")
  assertEquals(classifyFollowUpKind("Tomorrow doesn't work.", false), "schedule")
  assertEquals(classifyFollowUpKind("They never showed up.", false), "no_show")
  assertEquals(classifyFollowUpKind("It broke again.", false), "reopen")
  assertEquals(classifyFollowUpKind("Here's a better picture.", true), "photo")
  assertEquals(classifyFollowUpKind("Never mind, I fixed it.", false), "resolved")
  assertEquals(classifyFollowUpKind("Never mind", false), "resolved")
  assertEquals(classifyFollowUpKind("Cancel it", false), "resolved")
  assertEquals(classifyFollowUpKind("I don't need it", false), "resolved")
  assertEquals(classifyFollowUpKind("Can they come after 5?", false), "schedule")
  assertEquals(
    classifyFollowUpKind("I meant the bathroom, not the kitchen.", false),
    "correction",
  )
})

Deno.test("electrician ETA is a status ask, not a new repair or update confirm", () => {
  const electrical: OpenRequestSummary = {
    id: "t-elec",
    description: "Outlet sparking in the kitchen",
    vendor_work_status: "accepted",
    issue_category: "electrical",
  }
  const body = "When is my electrician coming ?"
  assertEquals(classifyFollowUpKind(body, false), null)
  const decision = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: null,
    openTickets: [electrical],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
  }
})

Deno.test("also + new trade is a separate issue", () => {
  assertEquals(looksLikeAdditionalIssue("Also, my AC isn't working."), true)
  assertEquals(
    isDistinctNewIssue("Also, my AC isn't working.", [leak]),
    true,
  )
  assertEquals(
    resolveContextualFollowUp({
      body: "Also, my AC isn't working.",
      hasMedia: false,
      intent: "maintenance_new",
      openTickets: [leak],
      activeIntake: false,
    }).action,
    "new_issue",
  )
})

Deno.test("lease questions switch intent instead of staying on the repair", () => {
  assertEquals(
    resolveContextualFollowUp({
      body: "When does my lease end?",
      hasMedia: false,
      intent: "lease_info",
      openTickets: [leak],
      activeIntake: true,
    }).action,
    "switch_intent",
  )
})

Deno.test("quoting one leak title does not also match the other leak", () => {
  const worse: OpenRequestSummary = {
    id: "t-worse",
    description: "The leak is getting worse\n\nAffected area: start.",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const sink: OpenRequestSummary = {
    id: "t-sink",
    description: "My kitchen sink is leaking\n\nAffected area: kitchen.",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const matched = matchOpenRequests("The leak is getting worse", [worse, sink])
  assertEquals(matched.length, 1)
  assertEquals(matched[0].id, "t-worse")

  const cancel = resolveContextualFollowUp({
    body: "The leak is getting worse",
    hasMedia: false,
    intent: "maintenance_cancel",
    openTickets: [worse, sink],
    activeIntake: true,
  })
  assertEquals(cancel.action, "follow_up")
  if (cancel.action === "follow_up") {
    assertEquals(cancel.ticketId, "t-worse")
    assertEquals(cancel.intent, "maintenance_cancel")
  }
})

Deno.test("it's worse with two open tickets asks which one", () => {
  const decision = resolveContextualFollowUp({
    body: "It's worse.",
    hasMedia: false,
    intent: "maintenance_update",
    openTickets: [leak, ac],
    activeIntake: false,
  })
  assertEquals(decision.action, "clarify")
})

Deno.test("AC follow-up with a plumbing ticket is a new issue", () => {
  assertEquals(
    resolveContextualFollowUp({
      body: "My AC isn't working",
      hasMedia: false,
      intent: "maintenance_new",
      openTickets: [leak],
      activeIntake: false,
    }).action,
    "new_issue",
  )
  assertEquals(
    resolveContextualFollowUp({
      body: "The AC is not working",
      hasMedia: false,
      intent: "maintenance_update",
      openTickets: [leak],
      activeIntake: false,
    }).action,
    "new_issue",
  )
})

Deno.test("photo on an open request continues that request", () => {
  const decision = resolveContextualFollowUp({
    body: "Here's a better picture.",
    hasMedia: true,
    intent: "maintenance_new",
    openTickets: [leak],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_update")
    assertEquals(decision.ticketId, "t-leak")
  }
})

Deno.test("photo during active intake stays on the wizard", () => {
  const draft: OpenRequestSummary = {
    id: "f671-draft",
    description: "My toilet is clogged and overflowing",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  assertEquals(
    resolveContextualFollowUp({
      body: "",
      hasMedia: true,
      intent: null,
      openTickets: [draft],
      activeIntake: true,
    }).action,
    "continue_intake",
  )
  assertEquals(
    shouldKeepActivePendingContext({
      body: "",
      intent: null,
      openTickets: [draft],
      activeIntake: true,
    }),
    true,
  )
})

Deno.test("draft work order does not steal a photo that answers the photo step", () => {
  const draft: OpenRequestSummary = {
    id: "f671-draft",
    description: "My toilet is clogged and overflowing",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  assertEquals(
    resolveContextualFollowUp({
      body: "",
      hasMedia: true,
      intent: "maintenance_update",
      openTickets: [draft],
      activeIntake: true,
    }).action,
    "continue_intake",
  )
})

Deno.test("heater stopped working is a new issue when nothing related is open", () => {
  assertEquals(
    resolveContextualFollowUp({
      body: "The heater stopped working.",
      hasMedia: false,
      intent: "maintenance_new",
      openTickets: [leak],
      activeIntake: true,
    }).action,
    "new_issue",
  )
})

Deno.test("worse with one open request continues that request", () => {
  const decision = resolveContextualFollowUp({
    body: "It's getting worse.",
    hasMedia: false,
    intent: "maintenance_update",
    openTickets: [leak],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_update")
  }
})

Deno.test("fixed it cancels the existing request instead of opening a new one", () => {
  const decision = resolveContextualFollowUp({
    body: "Never mind, I fixed it.",
    hasMedia: false,
    intent: null,
    openTickets: [leak],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_cancel")
  }
})

Deno.test("today during active intake stays on the wizard", () => {
  assertEquals(
    resolveContextualFollowUp({
      body: "today",
      hasMedia: false,
      intent: null,
      openTickets: [],
      activeIntake: true,
    }).action,
    "continue_intake",
  )
  assertEquals(
    resolveContextualFollowUp({
      body: "today",
      hasMedia: false,
      intent: "maintenance_new",
      openTickets: [leak],
      activeIntake: true,
    }).action,
    "continue_intake",
  )
  assertEquals(
    resolveContextualFollowUp({
      body: "today",
      hasMedia: false,
      intent: "maintenance_update",
      openTickets: [leak],
      activeIntake: true,
    }).action,
    "continue_intake",
  )
})

Deno.test("duplicate ceiling titles collapse to one match", () => {
  const first: OpenRequestSummary = {
    id: "t-ceiling-1",
    description: "Water is coming through my ceiling\n\nAffected area: ceiling.",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const junk: OpenRequestSummary = {
    id: "t-today",
    description: "Today\n\nAffected area: today.",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const second: OpenRequestSummary = {
    id: "t-ceiling-2",
    description: "Water is coming through my ceiling.\n\nAffected area: ceiling.\nFirst noticed: today.",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const matched = matchOpenRequests("Water is coming through my ceiling", [
    first,
    junk,
    second,
  ])
  assertEquals(matched.length, 1)
  assertEquals(matched[0].id, "t-ceiling-1")
  assertEquals(
    dedupeTicketsByRequestLabel([first, junk, second]).map((row) => row.id),
    ["t-ceiling-1", "t-today"],
  )
  // Same first line is one list row
  assertEquals(
    dedupeTicketsByRequestLabel([first, second]).map((row) => row.id),
    ["t-ceiling-1"],
  )
})

Deno.test("never mind during intake does not ask which duplicate to cancel", () => {
  const ceiling: OpenRequestSummary = {
    id: "t-ceiling",
    description: "Water is coming through my ceiling",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  const copy: OpenRequestSummary = {
    id: "t-copy",
    description: "Water is coming through my ceiling",
    vendor_work_status: "unassigned",
    issue_category: "plumbing",
  }
  assertEquals(
    resolveContextualFollowUp({
      body: "Never mind",
      hasMedia: false,
      intent: "maintenance_cancel",
      openTickets: [ceiling, copy],
      activeIntake: true,
    }).action,
    "follow_up",
  )
})

Deno.test("pending intake question plus resolution is not trapped on that step", () => {
  assertEquals(
    shouldKeepActivePendingContext({
      body: "Never mind. The leak stopped.",
      intent: "maintenance_cancel",
      openTickets: [leak],
      activeIntake: true,
    }),
    false,
  )
  assertEquals(
    resolveContextualFollowUp({
      body: "Never mind. The leak stopped.",
      hasMedia: false,
      intent: "maintenance_cancel",
      openTickets: [leak],
      activeIntake: true,
    }).action,
    "follow_up",
  )
})

Deno.test("pending intake plus a lease question switches intent", () => {
  assertEquals(
    shouldKeepActivePendingContext({
      body: "When does my lease expire?",
      intent: "lease_info",
      openTickets: [leak],
      activeIntake: true,
    }),
    false,
  )
})

Deno.test("gas smell is a new safety issue even when a plumbing ticket is open", () => {
  assertEquals(
    resolveContextualFollowUp({
      body: "I smell gas in the kitchen",
      hasMedia: false,
      intent: "maintenance_new",
      openTickets: [leak],
      activeIntake: false,
    }).action,
    "new_issue",
  )
})

Deno.test("photo without an active intake still follows up the open request", () => {
  const decision = resolveContextualFollowUp({
    body: "",
    hasMedia: true,
    intent: null,
    openTickets: [leak],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.ticketId, "t-leak")
  }
})

Deno.test("status-question ticket titles are not treated as real repairs", () => {
  const statusAsk: OpenRequestSummary = {
    id: "t-status",
    description: "Who is coming to fix my electrical issue?",
    vendor_work_status: "unassigned",
    issue_category: "electrical",
  }
  const outlet: OpenRequestSummary = {
    id: "t-outlet",
    description: "Bedroom outlet sparking",
    vendor_work_status: "accepted",
    issue_category: "electrical",
  }
  assertEquals(isIdentifiableRequestLabel(statusAsk), false)
  assertEquals(isIdentifiableRequestLabel(outlet), true)

  const decision = resolveContextualFollowUp({
    body: "Never mind, I fixed it.",
    hasMedia: false,
    intent: "maintenance_cancel",
    openTickets: [statusAsk, outlet],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_cancel")
    assertEquals(decision.ticketId, "t-outlet")
  }
})

Deno.test("Saad: electrical assignment question follows existing WO, not new_issue", () => {
  const electrical: OpenRequestSummary = {
    id: "t-elec",
    description: "Bedroom outlet sparking",
    vendor_work_status: "accepted",
    issue_category: "electrical",
  }
  const decision = resolveContextualFollowUp({
    body: "Who is coming to fix my electrical issue?",
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [electrical],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
    assertEquals(decision.ticketId, "t-elec")
  }
})

Deno.test("did you find someone follows existing WO", () => {
  const electrical: OpenRequestSummary = {
    id: "t-elec",
    description: "Bedroom outlet sparking",
    vendor_work_status: "unassigned",
    issue_category: "electrical",
  }
  const decision = resolveContextualFollowUp({
    body: "Did you find someone?",
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [electrical],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
  }
})

Deno.test("pending sink intake + electrician status question breaks out", () => {
  assertEquals(
    shouldKeepActivePendingContext({
      body: "When is my electrician coming?",
      intent: "maintenance_new",
      openTickets: [
        leak,
        {
          id: "t-elec",
          description: "Bedroom outlet sparking",
          vendor_work_status: "accepted",
          issue_category: "electrical",
        },
      ],
      activeIntake: true,
    }),
    false,
  )
  const decision = resolveContextualFollowUp({
    body: "When is my electrician coming?",
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [
      leak,
      {
        id: "t-elec",
        description: "Bedroom outlet sparking",
        vendor_work_status: "accepted",
        issue_category: "electrical",
      },
    ],
    activeIntake: true,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_status")
    assertEquals(decision.ticketId, "t-elec")
  }
})

Deno.test("multiple open + who's coming asks which repair", () => {
  const decision = resolveContextualFollowUp({
    body: "Who's coming?",
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [leak, ac],
    activeIntake: false,
  })
  assertEquals(decision.action, "clarify")
})

Deno.test("same-trade kitchen lights asks related vs separate", () => {
  const electrical: OpenRequestSummary = {
    id: "t-elec",
    description: "Bedroom outlet sparking",
    vendor_work_status: "accepted",
    issue_category: "electrical",
  }
  const decision = resolveContextualFollowUp({
    body: "Now my kitchen lights aren't working either.",
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [electrical],
    activeIntake: false,
  })
  assertEquals(decision.action, "follow_up")
  if (decision.action === "follow_up") {
    assertEquals(decision.intent, "maintenance_update")
    assertEquals(decision.slots.needs_related_clarify, "true")
  }
})
