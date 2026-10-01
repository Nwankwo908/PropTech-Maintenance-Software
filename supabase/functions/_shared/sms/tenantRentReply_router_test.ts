/// <reference lib="deno.ns" />
/**
 * Tenant rent-reply through tryInboundSmsHandlers — ahead of interpretation.
 * Limited Alpha (payments off) must complete landlord-confirm, not silent drop.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { LIMITED_ALPHA_1_LANDLORD_ID } from "../../../../shared/landlordCapabilities.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import {
  handleTenantRentReply,
  handleTenantRentReportConfirmationReply,
  readAwaitingTenantRentAmount,
} from "./tenantRentReply.ts"
import {
  readAwaitingTenantRentReportConfirmation,
  TENANT_RENT_REPORT_CONFIRM_TTL_MS,
  upsertAwaitingTenantRentReportConfirmation,
} from "./tenantRentReportConfirmation.ts"
import { processTenantRentReportConfirmTtl } from "../tenantRentReportTtl.ts"

type LedgerRow = {
  id: string
  event_type: string
  amount: number | null
  metadata: Record<string, unknown>
  description?: string | null
}

type HandlerState = {
  landlordId: string
  residentConversationId: string
  landlordConversationId: string
  activeConversationId: string
  lastConversationId: string | null
  residentId: string
  runId: string
  residentIntake: Record<string, unknown>
  landlordIntake: Record<string, unknown>
  run: Record<string, unknown>
  ledger: LedgerRow[]
  users: Record<string, unknown>
  activityEvents: Array<{ eventType: string }>
}

function mockSupabase(state: HandlerState) {
  const applyUpdate = (table: string, row: Record<string, unknown>, eqFilters: Record<string, unknown>) => {
    if (table === "sms_conversations") {
      if (row.intake_state && typeof row.intake_state === "object") {
        const id = String(
          eqFilters.id ?? state.lastConversationId ?? state.activeConversationId,
        )
        if (id === state.landlordConversationId) {
          state.landlordIntake = row.intake_state as Record<string, unknown>
        } else {
          state.residentIntake = row.intake_state as Record<string, unknown>
        }
      }
    }
    if (table === "workflow_runs") {
      Object.assign(state.run, row)
      if (row.metadata && typeof row.metadata === "object") {
        state.run.metadata = {
          ...(state.run.metadata as object ?? {}),
          ...(row.metadata as object),
        }
      }
    }
    if (table === "ledger_events") {
      const id = String(eqFilters.id ?? "")
      const target = state.ledger.find((l) => l.id === id) ?? state.ledger[0]
      if (target) {
        if (row.amount !== undefined) target.amount = row.amount as number | null
        if (row.description !== undefined) {
          target.description = row.description as string | null
        }
        if (row.metadata && typeof row.metadata === "object") {
          target.metadata = {
            ...target.metadata,
            ...(row.metadata as Record<string, unknown>),
          }
        }
      }
    }
    if (table === "users") {
      Object.assign(state.users, row)
    }
  }

  const recordInsert = (table: string, row: Record<string, unknown>) => {
    if (table === "ledger_events") {
      const id = `ledger-${state.ledger.length + 1}`
      state.ledger.push({
        id,
        event_type: String(row.event_type ?? ""),
        amount: typeof row.amount === "number" ? row.amount : null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        description: typeof row.description === "string" ? row.description : null,
      })
      return id
    }
    if (
      table === "operations_graph_events" ||
      table === "property_operations_graph"
    ) {
      const et = String(row.event_type ?? "")
      if (et) state.activityEvents.push({ eventType: et })
    }
    return "row-1"
  }

  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingInsert: Record<string, unknown> | null = null
    const eqFilters: Record<string, unknown> = {}

    const finish = async () => {
      if (pendingUpdate) applyUpdate(table, pendingUpdate, eqFilters)
      let insertId = "row-1"
      if (pendingInsert) insertId = recordInsert(table, pendingInsert)
      return { data: pendingInsert ? { id: insertId } : null, error: null }
    }

    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const m of [
      "select",
      "neq",
      "in",
      "not",
      "is",
      "gte",
      "lte",
      "gt",
      "lt",
      "ilike",
      "like",
      "order",
      "limit",
      "range",
      "filter",
      "match",
    ]) {
      chain[m] = passthrough
    }
    chain.eq = (col: string, val: unknown) => {
      eqFilters[col] = val
      return chain
    }
    chain.maybeSingle = async () => {
      if (table === "sms_conversations") {
        const id = String(eqFilters.id ?? state.activeConversationId)
        state.lastConversationId = id
        if (id === state.landlordConversationId) {
          return {
            data: {
              id: state.landlordConversationId,
              landlord_id: state.landlordId,
              intake_state: state.landlordIntake,
              external_phone_number: "+15551234567",
              workflow_run_id: state.runId,
            },
            error: null,
          }
        }
        return {
          data: {
            id: state.residentConversationId,
            landlord_id: state.landlordId,
            intake_state: state.residentIntake,
            external_phone_number: "+14434692705",
            workflow_run_id: state.runId,
            workflow_template_id: "rent_collection",
            resident_id: state.residentId,
          },
          error: null,
        }
      }
      if (table === "workflow_runs") {
        return { data: { ...state.run }, error: null }
      }
      if (table === "ledger_events") {
        const id = String(eqFilters.id ?? "")
        const hit = state.ledger.find((l) => l.id === id) ?? state.ledger[0] ?? null
        return { data: hit, error: null }
      }
      if (table === "users") {
        return { data: { ...state.users }, error: null }
      }
      if (table === "sms_numbers") {
        return {
          data: {
            id: "sms-main-1",
            phone_number: "+18775803356",
            provider: "twilio",
          },
          error: null,
        }
      }
      if (table === "sms_identities") {
        return {
          data: {
            id: "ident-1",
            landlord_id: state.landlordId,
            identity_type: "landlord",
            phone_number: "+15551234567",
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    chain.single = async () => {
      const result = await finish()
      return result
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
      Promise.resolve({ data: [], error: null }).then(async (empty) => {
        if (pendingUpdate || pendingInsert) return finish().then(resolve, reject)
        if (table === "sms_conversations") {
          return resolve({
            data: [{
              id: state.landlordConversationId,
              landlord_id: state.landlordId,
              intake_state: state.landlordIntake,
              external_phone_number: "+15551234567",
            }],
            error: null,
          })
        }
        if (table === "workflow_runs") {
          return resolve({ data: [state.run], error: null })
        }
        return resolve(empty)
      }, reject)

    return chain
  }

  return {
    from,
    rpc: async () => ({ data: "prop-1", error: null }),
  } as never
}

function baseState(): HandlerState {
  return {
    landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
    residentConversationId: "conv-resident",
    landlordConversationId: "conv-landlord",
    activeConversationId: "conv-resident",
    lastConversationId: null,
    residentId: "res-shahita",
    runId: "run-rent-1",
    residentIntake: {},
    landlordIntake: {},
    run: {
      id: "run-rent-1",
      template_id: "rent_collection",
      status: "active",
      landlord_id: LIMITED_ALPHA_1_LANDLORD_ID,
      resident_id: "res-shahita",
      entity_type: "sms_conversation",
      entity_id: "conv-resident",
      current_step: "awaiting_payment",
      current_stage: "routed",
      metadata: {
        amount_due: 1406,
        unit_label: "1",
        billing_period: "2026-10",
        rent_due_date: "2026-10-01",
        step_state: {
          step: "payment_reminder_sent",
          amount_due: 1406,
          sms_sent: true,
        },
      },
      property_id: "prop-1",
      unit_id: "unit-1",
    },
    ledger: [],
    users: {
      id: "res-shahita",
      full_name: "Shahita Sanders",
      name: "Shahita Sanders",
      unit: "1",
      balance_due: 1406,
    },
    activityEvents: [],
  }
}

function residentCtx(state: HandlerState, body: string): InboundSmsHandlerContext {
  state.activeConversationId = state.residentConversationId
  return {
    supabase: mockSupabase(state),
    inbound: {
      from: "+14434692705",
      to: "+18775803356",
      body,
      provider: "twilio",
      mediaUrls: [],
    },
    landlordId: state.landlordId,
    conversationId: state.residentConversationId,
    conversationType: "resident_intake",
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    identity: {
      id: "ident-res",
      landlord_id: state.landlordId,
      resident_id: state.residentId,
      vendor_id: null,
      unit_id: null,
      phone_number: "+14434692705",
      identity_type: "resident",
      verified: true,
      first_seen_at: null,
      last_seen_at: null,
    },
    maintenanceRequestId: null,
    selfHealed: false,
    resolutionSource: "active_resident",
    selfHealingPhase: "none",
    activeMaintenanceIntake: false,
  }
}

function landlordCtx(state: HandlerState, body: string): InboundSmsHandlerContext {
  state.activeConversationId = state.landlordConversationId
  return {
    supabase: mockSupabase(state),
    inbound: {
      from: "+15551234567",
      to: "+18775803356",
      body,
      provider: "twilio",
      mediaUrls: [],
    },
    landlordId: state.landlordId,
    conversationId: state.landlordConversationId,
    conversationType: "landlord_update",
    messageId: `msg-ll-${Math.random().toString(36).slice(2)}`,
    identity: {
      id: "ident-ll",
      landlord_id: state.landlordId,
      resident_id: null,
      vendor_id: null,
      unit_id: null,
      phone_number: "+15551234567",
      identity_type: "landlord",
      verified: true,
      first_seen_at: null,
      last_seen_at: null,
    },
    maintenanceRequestId: null,
    selfHealed: false,
    resolutionSource: "active_landlord",
    selfHealingPhase: "none",
    activeMaintenanceIntake: false,
  }
}

Deno.test("registry: Partial with no amount asks for dollars (not clarify menu)", async () => {
  const state = baseState()
  const result = await tryInboundSmsHandlers(residentCtx(state, "Partial"))
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.workflowRoute, "tenant_rent_reply")
  assertStringIncludes(result.reply?.body ?? "", "How much")
  assertEquals((result.reply?.body ?? "").toLowerCase().includes("repair"), false)
  const ask = readAwaitingTenantRentAmount(state.residentIntake)
  assertEquals(ask?.runId, state.runId)
  assertEquals(ask?.amountDue, 1406)
})

Deno.test("registry: typo Parital matches via tenant_rent_reply", async () => {
  const state = baseState()
  const result = await tryInboundSmsHandlers(residentCtx(state, "Parital"))
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.workflowRoute, "tenant_rent_reply")
  assertStringIncludes(result.reply?.body ?? "", "How much")
})

Deno.test("Limited Alpha: Partial → 700 → unconfirmed ledger + remaining balance", async () => {
  const state = baseState()
  const step1 = await handleTenantRentReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.residentConversationId,
    body: "Partial",
    identityType: "resident",
    residentId: state.residentId,
  })
  assertEquals(step1.handled, true)
  if (step1.handled) assertStringIncludes(step1.replyBody, "How much")

  const step2 = await handleTenantRentReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.residentConversationId,
    body: "700",
    identityType: "resident",
    residentId: state.residentId,
  })
  assertEquals(step2.handled, true)
  if (step2.handled) {
    assertStringIncludes(step2.replyBody, "700")
    assertStringIncludes(step2.replyBody, "leaves")
    assertStringIncludes(step2.replyBody, "confirm")
  }
  assertEquals(state.ledger.length >= 1, true)
  assertEquals(state.ledger[0]!.event_type, "rent_partial_payment_reported")
  assertEquals(state.ledger[0]!.amount, 700)
  assertEquals(state.ledger[0]!.metadata.confirmation_status, "unconfirmed")
  assertEquals(state.ledger[0]!.metadata.source, "tenant_reported")
  // Not ignored_tenant_payment_intent
  assertEquals(state.ledger[0]!.metadata.confirmation_status !== "ignored", true)
})

Deno.test("inline partial, paid 700: amount captured without follow-up ask", async () => {
  const state = baseState()
  const result = await handleTenantRentReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.residentConversationId,
    body: "partial, paid 700",
    identityType: "resident",
    residentId: state.residentId,
  })
  assertEquals(result.handled, true)
  if (result.handled) {
    assertStringIncludes(result.replyBody, "700")
    assertEquals(result.replyBody.includes("How much did you pay?"), false)
  }
  assertEquals(state.ledger[0]?.amount, 700)
  assertEquals(readAwaitingTenantRentAmount(state.residentIntake), null)
})

Deno.test("landlord confirms reported amount: ledger confirmed + graph event", async () => {
  const state = baseState()
  state.ledger.push({
    id: "ledger-1",
    event_type: "rent_partial_payment_reported",
    amount: 700,
    metadata: {
      confirmation_status: "unconfirmed",
      source: "tenant_reported",
      reported_amount: 700,
    },
  })
  state.landlordIntake = upsertAwaitingTenantRentReportConfirmation({}, {
    runId: state.runId,
    residentId: state.residentId,
    residentConversationId: state.residentConversationId,
    ledgerEventId: "ledger-1",
    reportedAmount: 700,
    amountDue: 1406,
    remainingDue: 706,
    unitLabel: "1",
    residentName: "Shahita Sanders",
    kind: "partial",
    askedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TENANT_RENT_REPORT_CONFIRM_TTL_MS).toISOString(),
  })

  const result = await tryInboundSmsHandlers(landlordCtx(state, "YES"))
  assertEquals(result.handled, true)
  if (result.handled) {
    assertEquals(result.workflowRoute, "tenant_rent_report_confirmation")
    assertStringIncludes(result.reply?.body ?? "", "Confirmed")
  }
  assertEquals(state.ledger[0]?.metadata.confirmation_status, "confirmed")
  assertEquals(
    state.activityEvents.some((e) =>
      e.eventType === "rent.ledger_updated" ||
      e.eventType === "rent.tenant_payment_report_confirmed"
    ),
    true,
  )
  assertEquals(readAwaitingTenantRentReportConfirmation(state.landlordIntake), null)
})

Deno.test("landlord corrects amount: ledger uses landlord figure", async () => {
  const state = baseState()
  state.ledger.push({
    id: "ledger-1",
    event_type: "rent_partial_payment_reported",
    amount: 700,
    metadata: {
      confirmation_status: "unconfirmed",
      source: "tenant_reported",
      reported_amount: 700,
    },
  })
  state.landlordIntake = upsertAwaitingTenantRentReportConfirmation({}, {
    runId: state.runId,
    residentId: state.residentId,
    residentConversationId: state.residentConversationId,
    ledgerEventId: "ledger-1",
    reportedAmount: 700,
    amountDue: 1406,
    remainingDue: 706,
    unitLabel: "1",
    kind: "partial",
    askedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TENANT_RENT_REPORT_CONFIRM_TTL_MS).toISOString(),
  })

  const result = await handleTenantRentReportConfirmationReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.landlordConversationId,
    body: "650",
    identityType: "landlord",
  })
  assertEquals(result.handled, true)
  if (result.handled) {
    assertEquals(result.action, "correct")
    assertStringIncludes(result.replyBody, "650")
  }
  assertEquals(state.ledger[0]?.amount, 650)
  assertEquals(state.ledger[0]?.metadata.confirmed_amount, 650)
  assertEquals(state.ledger[0]?.metadata.confirmation_status, "confirmed")
  assertEquals(
    state.activityEvents.some((e) =>
      e.eventType === "rent.tenant_payment_report_corrected"
    ),
    true,
  )
})

Deno.test("TTL: expired confirm escalates and refreshes expiry", async () => {
  const state = baseState()
  state.activeConversationId = state.landlordConversationId
  const past = new Date(Date.now() - TENANT_RENT_REPORT_CONFIRM_TTL_MS - 60_000)
  state.landlordIntake = upsertAwaitingTenantRentReportConfirmation({}, {
    runId: state.runId,
    residentId: state.residentId,
    residentConversationId: state.residentConversationId,
    ledgerEventId: "ledger-1",
    reportedAmount: 700,
    amountDue: 1406,
    remainingDue: 706,
    unitLabel: "1",
    residentName: "Shahita Sanders",
    kind: "partial",
    askedAt: past.toISOString(),
    expiresAt: past.toISOString(),
  })

  const summary = await processTenantRentReportConfirmTtl(mockSupabase(state), {
    landlordId: state.landlordId,
    now: new Date(),
  })
  assertEquals(summary.expired >= 1, true)
  assertEquals(summary.escalated >= 1, true)
  assertEquals(
    state.activityEvents.some((e) =>
      e.eventType === "rent.tenant_payment_report_confirm_ttl"
    ),
    true,
  )
  const still = readAwaitingTenantRentReportConfirmation(state.landlordIntake)
  assertEquals(Boolean(still), true)
  assertEquals(still != null && Date.parse(still.expiresAt) > Date.now(), true)
})

Deno.test(
  "Kendo/Alpha: bare YES with rent-report confirm + invoice-paid pending asks which (no priority win)",
  async () => {
    const state = baseState()
    state.activeConversationId = state.landlordConversationId
    state.landlordIntake = {
      awaiting_invoice_paid_confirmation: {
        invoices: {
          "inv-1": {
            invoice_id: "inv-1",
            ticket_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            amount: 450,
          },
        },
      },
    }
    state.landlordIntake = upsertAwaitingTenantRentReportConfirmation(
      state.landlordIntake,
      {
        runId: state.runId,
        residentId: state.residentId,
        residentConversationId: state.residentConversationId,
        ledgerEventId: "ledger-1",
        reportedAmount: 700,
        amountDue: 1406,
        remainingDue: 706,
        unitLabel: "1",
        residentName: "Shahita Sanders",
        kind: "partial",
        askedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + TENANT_RENT_REPORT_CONFIRM_TTL_MS)
          .toISOString(),
      },
    )

    const result = await tryInboundSmsHandlers(landlordCtx(state, "YES"))
    assertEquals(result.handled, true)
    if (!result.handled) return
    assertEquals(result.workflowRoute, "ambiguous_yes_pending_asks")
    assertStringIncludes(String(result.reply?.body ?? ""), "more than one yes/no")
    assertStringIncludes(String(result.reply?.body ?? ""), "rent")
    // Must not silently confirm rent via priority 23 alone
    assertEquals(
      readAwaitingTenantRentReportConfirmation(state.landlordIntake) != null,
      true,
    )
    assertEquals(
      state.landlordIntake.awaiting_invoice_paid_confirmation != null,
      true,
    )
  },
)
