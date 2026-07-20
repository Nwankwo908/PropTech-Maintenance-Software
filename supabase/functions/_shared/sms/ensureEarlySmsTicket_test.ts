/// <reference lib="deno.ns" />

import { shouldMintEarlyTicket } from "./ensureEarlySmsTicket.ts"

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
