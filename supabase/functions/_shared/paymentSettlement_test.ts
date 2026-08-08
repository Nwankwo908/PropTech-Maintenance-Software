/**
 * Payment settlement helpers — pure run/invoice checks.
 *
 * Run: deno test --no-check supabase/functions/_shared/paymentSettlement_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isMaintenanceInvoicePaidFromRow,
  isRentChargePaidFromRun,
} from "./paymentSettlement.ts"

Deno.test("isRentChargePaidFromRun: unpaid active run", () => {
  const result = isRentChargePaidFromRun({
    id: "run-1",
    template_id: "rent_collection",
    status: "active",
    metadata: {
      billing_period: "2026-07",
      payment_intent: "partial",
    },
  })
  assertEquals(result.paid, false)
  assertEquals(result.billingPeriod, "2026-07")
})

Deno.test("isRentChargePaidFromRun: stripe checkout completed", () => {
  const result = isRentChargePaidFromRun({
    id: "run-2",
    template_id: "rent_collection",
    status: "completed",
    metadata: {
      billing_period: "2026-07",
      payment_intent: "paid",
      rent_classification: "paid",
      stripe_checkout_session_id: "cs_test_123",
      stripe_payment_completed_at: "2026-07-05T12:00:00.000Z",
    },
  })
  assertEquals(result.paid, true)
  assertEquals(result.source, "stripe_checkout")
  assertEquals(result.stripeCheckoutSessionId, "cs_test_123")
})

Deno.test("isRentChargePaidFromRun: admin marked received", () => {
  const result = isRentChargePaidFromRun({
    id: "run-3",
    template_id: "rent_collection",
    status: "completed",
    metadata: {
      billing_period: "2026-06",
      payment_intent: "paid",
      admin_payment_received_at: "2026-06-20T12:00:00.000Z",
    },
  })
  assertEquals(result.paid, true)
  assertEquals(result.source, "admin_marked")
})

Deno.test("isRentChargePaidFromRun: billing period mismatch", () => {
  const result = isRentChargePaidFromRun(
    {
      id: "run-4",
      template_id: "rent_collection",
      status: "completed",
      metadata: {
        billing_period: "2026-07",
        payment_intent: "paid",
      },
    },
    { billingPeriod: "2026-08" },
  )
  assertEquals(result.paid, false)
})

Deno.test("isMaintenanceInvoicePaidFromRow: submitted unpaid", () => {
  const result = isMaintenanceInvoicePaidFromRow({
    id: "inv-1",
    status: "submitted",
    metadata: {},
  })
  assertEquals(result.paid, false)
  assertEquals(result.status, "submitted")
})

Deno.test("isMaintenanceInvoicePaidFromRow: approved via stripe", () => {
  const result = isMaintenanceInvoicePaidFromRow({
    id: "inv-2",
    status: "approved",
    metadata: {
      stripe_checkout_session_id: "cs_test_invoice",
      stripe_payment_intent_id: "pi_test",
    },
  })
  assertEquals(result.paid, true)
  assertEquals(result.source, "stripe_checkout")
})

Deno.test("isMaintenanceInvoicePaidFromRow: approved without stripe", () => {
  const result = isMaintenanceInvoicePaidFromRow({
    id: "inv-3",
    status: "approved",
    metadata: {},
  })
  assertEquals(result.paid, true)
  assertEquals(result.source, "admin_approved")
})
