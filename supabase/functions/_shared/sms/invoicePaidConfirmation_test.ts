/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildInvoiceReadyPaidConfirmationSms,
  canHandleInvoicePaidConfirmation,
  cleanInvoiceJobHeadline,
  parseInvoicePaidConfirmationReply,
  readAwaitingInvoicePaidConfirmation,
  serializeAwaitingInvoicePaidConfirmation,
  tryHandleInvoicePaidConfirmationInbound,
  unclearInvoicePaidConfirmationReply,
} from "./invoicePaidConfirmation.ts"

Deno.test("parseInvoicePaidConfirmationReply: YES / paid equivalents", () => {
  for (const body of [
    "YES",
    "yes",
    "Yes!",
    "y",
    "paid",
    "PAID",
    "done",
    "already paid",
    "mark paid",
    "yes paid",
    "i paid",
  ]) {
    assertEquals(parseInvoicePaidConfirmationReply(body), "paid", body)
  }
})

Deno.test("parseInvoicePaidConfirmationReply: NO / not yet equivalents", () => {
  for (const body of [
    "NO",
    "no",
    "n",
    "nope",
    "not yet",
    "not paid",
    "unpaid",
    "haven't paid",
  ]) {
    assertEquals(parseInvoicePaidConfirmationReply(body), "unpaid", body)
  }
})

Deno.test("parseInvoicePaidConfirmationReply: unrelated and legacy '1' are not paid/unpaid", () => {
  assertEquals(parseInvoicePaidConfirmationReply("1"), null)
  assertEquals(parseInvoicePaidConfirmationReply("yes toilet is leaking"), null)
  assertEquals(parseInvoicePaidConfirmationReply("kitchen sink overflowing"), null)
  assertEquals(parseInvoicePaidConfirmationReply(""), null)
})

Deno.test("canHandleInvoicePaidConfirmation requires pending ask", () => {
  assertEquals(
    canHandleInvoicePaidConfirmation({
      identityType: "landlord",
      intakeState: {},
    }),
    false,
  )
  assertEquals(
    canHandleInvoicePaidConfirmation({
      identityType: "landlord",
      intakeState: {
        awaiting_invoice_paid_confirmation: {
          invoice_id: "inv-1",
          ticket_id: "tix-1",
        },
      },
    }),
    true,
  )
  assertEquals(
    canHandleInvoicePaidConfirmation({
      identityType: "vendor",
      intakeState: {
        awaiting_invoice_paid_confirmation: {
          invoice_id: "inv-1",
          ticket_id: "tix-1",
        },
      },
    }),
    false,
  )
})

Deno.test("buildInvoiceReadyPaidConfirmationSms title-cases vendor and asks YES/NO", () => {
  const body = buildInvoiceReadyPaidConfirmationSms({
    landlordFirstName: "Maya",
    unit: "4A",
    vendorName: "apex pipe & drain",
    amount: 320.5,
    jobHeadline: "Clogged bathtub drain",
    detailsUrl: "https://app.ulohome.io/admin/requests?q=WO-ABCD",
  })
  assertStringIncludes(body, "Hi Maya — invoice ready")
  assertStringIncludes(body, "Unit 4A · Apex Pipe & Drain · $320.50")
  assertStringIncludes(body, "Job: Clogged bathtub drain")
  assertStringIncludes(body, "Have you paid this invoice?")
  assertStringIncludes(body, "Reply YES if paid, or NO if not yet.")
  assertEquals(body.includes("1 —"), false)
})

Deno.test("cleanInvoiceJobHeadline prefers issue_headline then description", () => {
  assertEquals(
    cleanInvoiceJobHeadline("Kitchen sink leaking\nMore detail", "plumbing", null),
    "Kitchen sink leaking",
  )
  assertEquals(
    cleanInvoiceJobHeadline("ignored", "plumbing", "dripping faucet"),
    "Dripping faucet",
  )
})

Deno.test("serialize/read awaiting_invoice_paid_confirmation round-trips", () => {
  const raw = serializeAwaitingInvoicePaidConfirmation({
    invoiceId: "inv-9",
    ticketId: "tix-9",
    amount: 450,
    unit: "2B",
    vendorName: "Flex Plumbing",
    jobHeadline: "Leaking faucet",
  })
  const read = readAwaitingInvoicePaidConfirmation({
    awaiting_invoice_paid_confirmation: raw,
  })
  assertEquals(read?.invoiceId, "inv-9")
  assertEquals(read?.ticketId, "tix-9")
  assertEquals(read?.amount, 450)
  assertEquals(read?.vendorName, "Flex Plumbing")
})

type HandlerState = {
  landlordId: string
  conversationId: string
  intake: Record<string, unknown>
  invoice: Record<string, unknown>
  scope: Record<string, unknown>
  ticket: Record<string, unknown>
  activityEvents: Array<{ eventType: string }>
}

/**
 * Charts / YTD / data-graph spend recognition all read approved invoices
 * (maintenance_recognized_spend_view uses status=approved + approved_at).
 * YES must call the same approve path so those three surfaces stay consistent.
 */
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
    chain.select = () => chain
    chain.eq = () => chain
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
    ) => finish().then(resolve, reject)

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

Deno.test("YES on pending invoice_paid confirmation marks invoice paid + recognized spend", async () => {
  const state = baseState()
  const supabase = mockSupabaseForInvoicePaid(state)

  const result = await tryHandleInvoicePaidConfirmationInbound(supabase, {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "yes",
    identityType: "landlord",
  })

  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.action, "paid")
  assertEquals(result.recognizedAmount, 450)
  assertEquals(state.invoice.status, "approved")
  assertEquals(typeof state.invoice.approved_at === "string", true)
  assertEquals(state.ticket.spend_status, "recognized")
  assertEquals(state.ticket.recognized_spend_amount, 450)
  assertEquals(state.intake.awaiting_invoice_paid_confirmation, undefined)

  // Downstream figures (data graph / YTD / monthly chart) all read approved
  // invoices via approved_at — asserting the shared write path here.
  const paidOrSpend = state.activityEvents.some(
    (e) =>
      e.eventType === "maintenance.invoice_paid" ||
      e.eventType === "maintenance.spend_recorded",
  )
  assertEquals(paidOrSpend, true)
  assertStringIncludes(result.replyBody, "marked")
})

Deno.test("NO on pending invoice_paid confirmation leaves invoice open and logs", async () => {
  const state = baseState()
  const supabase = mockSupabaseForInvoicePaid(state)

  const result = await tryHandleInvoicePaidConfirmationInbound(supabase, {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "not yet",
    identityType: "landlord",
  })

  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.action, "unpaid")
  assertEquals(state.invoice.status, "submitted")
  assertEquals(state.ticket.spend_status, "pending_approval")
  assertEquals(state.ticket.recognized_spend_amount, null)
  // Pending ask kept so a later YES can still mark paid.
  assertEquals(
    readAwaitingInvoicePaidConfirmation(state.intake)?.invoiceId,
    "inv-1",
  )
  const unpaidLog = state.activityEvents.some(
    (e) => e.eventType === "maintenance.invoice_unpaid_confirmed",
  )
  assertEquals(unpaidLog, true)
})

Deno.test("unrelated message while invoice_paid pending: claimed with clarify, not generic fallback", async () => {
  const state = baseState()
  const supabase = mockSupabaseForInvoicePaid(state)

  const result = await tryHandleInvoicePaidConfirmationInbound(supabase, {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "kitchen sink overflowing again",
    identityType: "landlord",
  })

  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.action, "clarify")
  assertEquals(result.replyBody, unclearInvoicePaidConfirmationReply())
  assertEquals(state.invoice.status, "submitted")
  assertEquals(
    readAwaitingInvoicePaidConfirmation(state.intake)?.invoiceId,
    "inv-1",
  )
  // Must not invent the inboundFinish generic maintenance help line.
  assertEquals(
    result.replyBody.includes("How can we help with your maintenance issue"),
    false,
  )
})

Deno.test("old failure case: reply '1' with pending state is claimed (not inboundFinish fallback)", async () => {
  const state = baseState()
  const supabase = mockSupabaseForInvoicePaid(state)

  const result = await tryHandleInvoicePaidConfirmationInbound(supabase, {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "1",
    identityType: "landlord",
  })

  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.action, "clarify")
  assertEquals(result.replyBody, unclearInvoicePaidConfirmationReply())
  assertEquals(state.invoice.status, "submitted")
})

Deno.test("old failure case: reply 'yes' with pending state is claimed as paid", async () => {
  const state = baseState()
  const supabase = mockSupabaseForInvoicePaid(state)

  const result = await tryHandleInvoicePaidConfirmationInbound(supabase, {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "yes",
    identityType: "landlord",
  })

  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.action, "paid")
})
