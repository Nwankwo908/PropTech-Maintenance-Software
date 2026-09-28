/// <reference lib="deno.ns" />
/**
 * End-to-end through tryInboundSmsHandlers: invoice-ready pending ask → YES/NO.
 * Approving via SMS must write the same recognized-spend fields YTD / monthly
 * charts read (approved invoice + ticket recognized_spend_*).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import {
  readAwaitingInvoicePaidConfirmation,
  unclearInvoicePaidConfirmationReply,
} from "./invoicePaidConfirmation.ts"

type HandlerState = {
  landlordId: string
  conversationId: string
  intake: Record<string, unknown>
  invoice: Record<string, unknown>
  scope: Record<string, unknown>
  ticket: Record<string, unknown>
  activityEvents: Array<{ eventType: string }>
}

function mockSupabaseForInvoicePaid(state: HandlerState) {
  const applyUpdate = (table: string, row: Record<string, unknown>) => {
    if (table === "sms_conversations") {
      if (row.intake_state && typeof row.intake_state === "object") {
        state.intake = row.intake_state as Record<string, unknown>
      }
    }
    if (table === "maintenance_invoices") {
      Object.assign(state.invoice, row)
    }
    if (table === "maintenance_requests") {
      Object.assign(state.ticket, row)
    }
  }

  const recordInsert = (table: string, row: Record<string, unknown>) => {
    if (
      table === "operations_graph_events" ||
      table === "property_operations_graph"
    ) {
      const et = String(row.event_type ?? "")
      if (et) state.activityEvents.push({ eventType: et })
    }
  }

  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingInsert: Record<string, unknown> | null = null

    const finish = async () => {
      if (pendingUpdate) applyUpdate(table, pendingUpdate)
      if (pendingInsert) recordInsert(table, pendingInsert)
      return { data: pendingInsert ? { id: "row-1" } : null, error: null }
    }

    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "not",
      "is",
      "gte",
      "lte",
      "gt",
      "lt",
      "order",
      "limit",
      "range",
      "filter",
      "match",
    ]) {
      chain[m] = passthrough
    }
    chain.maybeSingle = async () => {
      if (table === "sms_conversations") {
        return {
          data: { id: state.conversationId, intake_state: state.intake },
          error: null,
        }
      }
      if (table === "maintenance_invoices") {
        return { data: { ...state.invoice }, error: null }
      }
      if (table === "maintenance_request_enriched") {
        return { data: { ...state.scope }, error: null }
      }
      return { data: null, error: null }
    }
    chain.single = async () => {
      await finish()
      return { data: { id: "row-1" }, error: null }
    }
    chain.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain
    }
    chain.insert = (row: Record<string, unknown> | Record<string, unknown>[]) => {
      pendingInsert = Array.isArray(row) ? (row[0] ?? null) : row
      return chain
    }
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      // Arrays for .select().eq()... without maybeSingle (vendor choice, etc.)
      Promise.resolve({ data: [], error: null }).then(async (empty) => {
        if (pendingUpdate || pendingInsert) return finish().then(resolve, reject)
        return resolve(empty)
      }, reject)

    return chain
  }

  return { from } as never
}

function baseState(): HandlerState {
  return {
    landlordId: "ll-1",
    conversationId: "conv-1",
    intake: {
      awaiting_invoice_paid_confirmation: {
        invoice_id: "inv-1",
        ticket_id: "tix-1",
        amount: 450,
        unit: "2B",
        vendor_name: "Flex Plumbing",
        job_headline: "Leaking kitchen faucet",
      },
    },
    invoice: {
      id: "inv-1",
      landlord_id: "ll-1",
      maintenance_request_id: "tix-1",
      vendor_id: "ven-1",
      total_cost: 450,
      labor_cost: 300,
      material_cost: 150,
      tax_amount: 0,
      status: "submitted",
      invoice_number: "INV-100",
      metadata: {},
    },
    scope: {
      id: "tix-1",
      landlord_id: "ll-1",
      assigned_vendor_id: "ven-1",
      unit_id: "unit-1",
      property_id: "prop-1",
      resident_id: "res-1",
    },
    ticket: {
      id: "tix-1",
      spend_status: "pending_approval",
      recognized_spend_amount: null,
      recognized_spend_at: null,
    },
    activityEvents: [],
  }
}

function routerCtx(
  state: HandlerState,
  body: string,
): InboundSmsHandlerContext {
  return {
    supabase: mockSupabaseForInvoicePaid(state),
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    messageId: "msg-1",
    conversationType: "landlord_update",
    activeMaintenanceIntake: false,
    identity: {
      id: "ident-1",
      identity_type: "landlord",
      resident_id: null,
      vendor_id: null,
    },
    inbound: {
      body,
      from: "+15551234567",
      to: "+15559876543",
      provider: "telnyx",
      mediaUrls: [],
    },
  } as InboundSmsHandlerContext
}

async function assertPaidViaRouter(body: string) {
  const state = baseState()
  const result = await tryInboundSmsHandlers(routerCtx(state, body))
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.workflowRoute, "landlord_invoice_paid_confirmation")
  assertEquals(result.maintenanceRequestId, "tix-1")
  assertEquals(result.workflowMetadata?.action, "paid")
  assertEquals(state.invoice.status, "approved")
  assertEquals(state.ticket.spend_status, "recognized")
  assertEquals(state.ticket.recognized_spend_amount, 450)
  assertEquals(state.intake.awaiting_invoice_paid_confirmation, undefined)
  // YTD / monthly cost graphs read approved invoices + recognized ticket spend.
  const paidOrSpend = state.activityEvents.some(
    (e) =>
      e.eventType === "maintenance.invoice_paid" ||
      e.eventType === "maintenance.spend_recorded",
  )
  assertEquals(paidOrSpend, true)
  assertStringIncludes(String(result.reply?.body ?? ""), "marked")
  assertEquals(result.reply?.skipGenericFallback, true)
}

Deno.test("router: invoice created + ask pending + yes marks paid (YTD path)", async () => {
  await assertPaidViaRouter("yes")
})

Deno.test("router: Yes (capital Y) marks paid", async () => {
  await assertPaidViaRouter("Yes")
})

Deno.test("router: paid marks paid", async () => {
  await assertPaidViaRouter("paid")
})

Deno.test("router: y marks paid", async () => {
  await assertPaidViaRouter("y")
})

Deno.test("router: No leaves invoice open and keeps ask", async () => {
  const state = baseState()
  const result = await tryInboundSmsHandlers(routerCtx(state, "No"))
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.workflowMetadata?.action, "unpaid")
  assertEquals(state.invoice.status, "submitted")
  assertEquals(state.ticket.recognized_spend_amount, null)
  assertEquals(
    readAwaitingInvoicePaidConfirmation(state.intake)?.invoiceId,
    "inv-1",
  )
  assertEquals(result.reply?.skipGenericFallback, true)
})

Deno.test("router: unrelated message clarifies — not swallowed as generic fallback", async () => {
  const state = baseState()
  const result = await tryInboundSmsHandlers(
    routerCtx(state, "kitchen sink overflowing again"),
  )
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.workflowMetadata?.action, "clarify")
  assertEquals(result.reply?.body, unclearInvoicePaidConfirmationReply())
  assertEquals(result.reply?.skipGenericFallback, true)
  assertEquals(
    String(result.reply?.body ?? "").includes(
      "How can we help with your maintenance issue",
    ),
    false,
  )
  assertEquals(state.invoice.status, "submitted")
  assertEquals(
    readAwaitingInvoicePaidConfirmation(state.intake)?.invoiceId,
    "inv-1",
  )
})

Deno.test("router: without pending ask, invoice_paid_confirmation does not claim", async () => {
  const state = baseState()
  state.intake = {}
  const result = await tryInboundSmsHandlers(routerCtx(state, "yes"))
  // Other handlers may also return false; assert we did not mark paid.
  assertEquals(state.invoice.status, "submitted")
  if (result.handled) {
    assertEquals(
      result.workflowRoute === "landlord_invoice_paid_confirmation",
      false,
    )
  }
})
