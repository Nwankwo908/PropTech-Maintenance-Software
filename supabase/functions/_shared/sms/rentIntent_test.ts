/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyRentSmsIntent,
  hasCompetingFinancialContext,
  looksLikeRentBalanceAsk,
} from "./rentIntent.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import { resolveContextualFollowUp } from "./inboundContextualFollowUp.ts"
import {
  allowsNewMaintenanceTicket,
  resolveMaintenanceWorkIntent,
} from "./resolveMaintenanceWorkIntent.ts"

const openElectrical = {
  id: "elec-1",
  description: "Bedroom outlet sparking",
  vendor_work_status: "unassigned",
  issue_category: "electrical",
}

const closedElectrical = {
  ...openElectrical,
  id: "elec-closed",
  vendor_work_status: "cancelled",
}

function expectBalance(body: string) {
  const c = classifyRentSmsIntent(body)
  assertEquals(c.kind, "rent_balance", body)
  assertEquals(c.topic, "balance", body)
  assertEquals(heuristicInterpretInbound(body).intent, "rent_balance", body)
}

Deno.test("natural rent-balance wording (diverse)", () => {
  const phrases = [
    "How much rent do I owe?",
    "How much do I owe for rent?",
    "For rent, how much do I owe?",
    "What do I still owe on my rent?",
    "What do I owe?",
    "What's my balance?",
    "What's my rent balance?",
    "Do I still owe anything?",
    "What's left to pay?",
    "How much more do I owe?",
    "Am I paid up?",
    "Rent balance?",
    "Amount due?",
    "Can you check what I owe?",
    "What do I owe this month?",
    "How much do I owe this month?",
    "How much do I need to pay?",
    "What do I need to pay?",
    "How much do I have to pay?",
    "What's due?",
    "How much is due?",
    "What's my amount due?",
    "How much rent is due?",
    "Do I owe anything?",
    "Do I still owe rent?",
    "Do I have a balance?",
    "Is there anything left to pay?",
    "What's left on my rent?",
    "How much do I have left?",
    "What's my remaining balance?",
    "How much is left?",
    "What do I still owe?",
    "Did I pay everything?",
    "Am I caught up on rent?",
    "Do I have anything outstanding?",
    "What's outstanding on my account?",
    "Can you tell me my rent balance?",
    "Can you tell me what I owe?",
    "Check my rent balance.",
    "Send me my balance.",
    "Balance?",
    "What I owe?",
    "How much I owe?",
    "How much for rent?",
    "Rent due?",
    "Yo how much I still owe?",
    "How much I owe in rent",
  ]
  for (const phrase of phrases) {
    expectBalance(phrase)
  }
})

Deno.test("rent sub-intents stay distinct from balance", () => {
  assertEquals(classifyRentSmsIntent("When is my rent due?").topic, "due_date")
  assertEquals(classifyRentSmsIntent("Send me the link to pay rent.").topic, "payment_link")
  assertEquals(
    classifyRentSmsIntent("Did my rent payment go through?").topic,
    "payment_status",
  )
  assertEquals(classifyRentSmsIntent("I'm going to be late on rent.").kind, "rent_late")
  assertEquals(classifyRentSmsIntent("How much is my rent?").topic, "monthly_rent")
  assertEquals(
    classifyRentSmsIntent("I have a question about my rent increase.").kind,
    "rent_general",
  )
  assertEquals(
    heuristicInterpretInbound("When is my rent due?").extractedSlots.topic,
    "due_date",
  )
  assertEquals(heuristicInterpretInbound("I'm going to be late on rent.").intent, "rent_late")
})

Deno.test("open or closed maintenance + rent balance → rent wins, no new ticket", () => {
  for (const tickets of [[openElectrical], [closedElectrical], [openElectrical, closedElectrical]]) {
    const body = "How much rent do I owe?"
    const decision = resolveContextualFollowUp({
      body,
      hasMedia: false,
      intent: "rent_balance",
      openTickets: tickets,
      activeIntake: false,
    })
    assertEquals(decision.action, "switch_intent")
    const resolved = resolveMaintenanceWorkIntent({
      body,
      heuristicIntent: "rent_balance",
      openTickets: tickets,
    })
    assertEquals(resolved, "OTHER")
    assertEquals(allowsNewMaintenanceTicket(resolved), false)
  }
})

Deno.test("competing financial context → clarify bare how much do I owe", () => {
  assertEquals(
    hasCompetingFinancialContext("Ulo: Your invoice for the repair is ready."),
    true,
  )
  const clarified = classifyRentSmsIntent("How much do I owe?", {
    recentTurns: "Vendor invoice #12 is ready for $240.",
  })
  assertEquals(clarified.kind, "rent_balance")
  assertEquals(clarified.needsClarification, true)
  // Explicit rent still confident
  const withRent = classifyRentSmsIntent("How much rent do I owe?", {
    recentTurns: "Vendor invoice #12 is ready for $240.",
  })
  assertEquals(withRent.needsClarification, false)
})

Deno.test("looksLikeRentBalanceAsk is balance-topic only", () => {
  assertEquals(looksLikeRentBalanceAsk("What's my balance?"), true)
  assertEquals(looksLikeRentBalanceAsk("When is my rent due?"), false)
  assertEquals(looksLikeRentBalanceAsk("Send me the payment link"), false)
})
