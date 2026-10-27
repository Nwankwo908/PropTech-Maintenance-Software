/// <reference lib="deno.ns" />

import { shouldMintEarlyTicket, mayLinkWorkflowRunToNewTicket } from "./ensureEarlySmsTicket.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

Deno.test("mints early ticket once issue is classifiable", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "room_or_area",
      issue_type: "plumbing",
      vendor_trade: "plumbing",
      initial_message: "leaky faucet in the kitchen",
    }),
    true,
    "classified plumbing",
  )
})

Deno.test("does not mint during clarification", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "classification_clarification",
      initial_message: "something is broken",
    }),
    false,
    "clarification",
  )
})

Deno.test("does not mint after submitted", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "submitted",
      issue_type: "plumbing",
      vendor_trade: "plumbing",
      initial_message: "leaky faucet",
    }),
    false,
    "submitted",
  )
})

Deno.test("does not mint while confidence is low", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "issue_type",
      initial_message: "something is broken",
      confidence_band: "low",
    }),
    false,
    "low confidence",
  )
})

Deno.test("requires a description plus trade or issue type", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "issue_type",
      initial_message: "help",
    }),
    false,
    "no trade",
  )
})

Deno.test("mints a gas emergency even when the trade is other", () => {
  assertEqual(
    shouldMintEarlyTicket({
      step: "awaiting_confirm",
      confidence_band: "high",
      vendor_trade: "other",
      initial_message: "I smell gas in the kitchen",
      description: "I smell gas in the kitchen",
    }),
    true,
    "gas draft",
  )
})

Deno.test("does not retarget an AC work-order run to a new gas ticket", () => {
  assertEqual(
    mayLinkWorkflowRunToNewTicket({
      templateId: "maintenance_request",
      entityId: "30a0b8cc-4284-42a7-8139-b59e219219f0",
      ticketId: "gas-ticket",
    }),
    false,
    "ac run stays",
  )
  assertEqual(
    mayLinkWorkflowRunToNewTicket({
      templateId: "maintenance_intake",
      entityId: "30a0b8cc-4284-42a7-8139-b59e219219f0",
      ticketId: "gas-ticket",
    }),
    false,
    "intake already tied to ac",
  )
  assertEqual(
    mayLinkWorkflowRunToNewTicket({
      templateId: "maintenance_intake",
      entityId: "",
      ticketId: "gas-ticket",
    }),
    true,
    "fresh intake run",
  )
})
