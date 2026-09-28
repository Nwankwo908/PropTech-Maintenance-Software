/// <reference lib="deno.ns" />
/**
 * ensureInvoice and finalizeAfterResidentFeedback share idempotency key
 * `invoice:{id}`. The call that carries invoicePaidConfirmation must win in
 * either order so awaiting_invoice_paid_confirmation is set.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { readAwaitingInvoicePaidConfirmation } from "./invoicePaidConfirmation.ts"

type AttentionCall = {
  invoicePaidConfirmation?: {
    invoiceId: string
    ticketId: string
    amount: number
    unit: string | null
    vendorName: string
    jobHeadline: string
  } | null
}

/**
 * Pure model of notifyLandlordNeedsAttention idempotency + paid-ask upgrade.
 * Mirrors landlordAttentionNotify findPriorAttentionAlert / upgrade rules.
 */
function simulateInvoiceReadyOrder(calls: AttentionCall[]): {
  invoicePaidAsk: boolean
  pendingAskSet: boolean
  smsBodies: string[]
} {
  let prior: { invoicePaidAsk: boolean } | null = null
  let pendingAskSet = false
  const smsBodies: string[] = []

  for (const call of calls) {
    const hasPaid = Boolean(call.invoicePaidConfirmation)
    if (prior) {
      if (hasPaid && !prior.invoicePaidAsk) {
        // Upgrade: paid version wins
        prior = { invoicePaidAsk: true }
        pendingAskSet = true
        smsBodies.push("paid_confirmation")
        continue
      }
      // already_sent — skip
      continue
    }
    // First send
    prior = { invoicePaidAsk: hasPaid }
    if (hasPaid) {
      pendingAskSet = true
      smsBodies.push("paid_confirmation")
    } else {
      smsBodies.push("generic_invoice_ready")
    }
  }

  return {
    invoicePaidAsk: prior?.invoicePaidAsk ?? false,
    pendingAskSet,
    smsBodies,
  }
}

const paidAsk = {
  invoiceId: "inv-1",
  ticketId: "tix-1",
  amount: 450,
  unit: "2B",
  vendorName: "Flex",
  jobHeadline: "Leak",
}

Deno.test("order: ensureInvoice (paid) then finalize (paid) — ask set once", () => {
  const result = simulateInvoiceReadyOrder([
    { invoicePaidConfirmation: paidAsk },
    { invoicePaidConfirmation: paidAsk },
  ])
  assertEquals(result.pendingAskSet, true)
  assertEquals(result.invoicePaidAsk, true)
  assertEquals(result.smsBodies, ["paid_confirmation"])
})

Deno.test("order: finalize (paid) then ensureInvoice (paid) — ask set once", () => {
  const result = simulateInvoiceReadyOrder([
    { invoicePaidConfirmation: paidAsk },
    { invoicePaidConfirmation: paidAsk },
  ])
  assertEquals(result.pendingAskSet, true)
  assertEquals(result.invoicePaidAsk, true)
  assertEquals(result.smsBodies, ["paid_confirmation"])
})

Deno.test("order: generic finalize first then ensureInvoice paid — upgrade wins", () => {
  const result = simulateInvoiceReadyOrder([
    { invoicePaidConfirmation: null },
    { invoicePaidConfirmation: paidAsk },
  ])
  assertEquals(result.pendingAskSet, true)
  assertEquals(result.invoicePaidAsk, true)
  assertEquals(result.smsBodies, ["generic_invoice_ready", "paid_confirmation"])
})

Deno.test("order: ensureInvoice paid first then generic finalize — paid keeps win", () => {
  const result = simulateInvoiceReadyOrder([
    { invoicePaidConfirmation: paidAsk },
    { invoicePaidConfirmation: null },
  ])
  assertEquals(result.pendingAskSet, true)
  assertEquals(result.invoicePaidAsk, true)
  assertEquals(result.smsBodies, ["paid_confirmation"])
})

Deno.test("readAwaitingInvoicePaidConfirmation requires invoice id in ask", () => {
  assertEquals(
    readAwaitingInvoicePaidConfirmation({
      awaiting_invoice_paid_confirmation: {
        invoice_id: "inv-9",
        ticket_id: "tix-9",
      },
    })?.invoiceId,
    "inv-9",
  )
  assertEquals(
    readAwaitingInvoicePaidConfirmation({
      awaiting_invoice_paid_confirmation: { ticket_id: "tix-9" },
    }),
    null,
  )
})
