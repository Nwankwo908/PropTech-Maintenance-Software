/// <reference lib="deno.ns" />
/**
 * Routing precedence regression for the original rent-reply bug:
 * "Partial" was eaten by tryHandleInterpretedInbound → unclear → clarify menu
 * before rent_collection / parsePaymentIntent ever ran.
 *
 * These tests assert handlers claim the message when pending rent state exists,
 * and that the same body is what the recognizer treats as unclear (the steal path).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { LIMITED_ALPHA_1_LANDLORD_ID } from "../../../../shared/landlordCapabilities.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import {
  TENANT_RENT_REPORT_CONFIRM_TTL_MS,
  upsertAwaitingTenantRentReportConfirmation,
} from "./tenantRentReportConfirmation.ts"

type State = {
  landlordId: string
  conversationId: string
  intake: Record<string, unknown>
  run: Record<string, unknown> | null
  residentId: string
}

function mockSupabase(state: State) {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null
    const eqFilters: Record<string, unknown> = {}
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
    chain.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain
    }
    chain.insert = () => chain
    chain.maybeSingle = async () => {
      if (table === "sms_conversations") {
        return {
          data: {
            id: state.conversationId,
            landlord_id: state.landlordId,
            intake_state: state.intake,
            workflow_run_id: state.run?.id ?? null,
            workflow_template_id: state.run ? "rent_collection" : null,
            resident_id: state.residentId,
            external_phone_number: "+14434692705",
          },
          error: null,
        }
      }
      if (table === "workflow_runs") {
        return { data: state.run, error: null }
      }
      if (table === "users") {
        return {
          data: {
            id: state.residentId,
            full_name: "Shahita Sanders",
            unit: "1",
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    chain.single = async () => ({ data: { id: "row-1" }, error: null })
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ data: state.run ? [state.run] : [], error: null }).then(
        async (empty) => {
          if (pendingUpdate?.intake_state && typeof pendingUpdate.intake_state === "object") {
            state.intake = pendingUpdate.intake_state as Record<string, unknown>
          }
          return resolve(empty)
        },
        reject,
      )
    return chain
  }
  return {
    from,
    rpc: async () => ({ data: "prop-1", error: null }),
  } as never
}

function activeRentRun(residentId: string, conversationId: string) {
  return {
    id: "run-rent-1",
    template_id: "rent_collection",
    status: "active",
    landlord_id: LIMITED_ALPHA_1_LANDLORD_ID,
    resident_id: residentId,
    entity_type: "sms_conversation",
    entity_id: conversationId,
    current_step: "awaiting_payment",
    property_id: "prop-1",
    unit_id: "unit-1",
    metadata: {
      amount_due: 1406,
      unit_label: "1",
      step_state: { step: "payment_reminder_sent", amount_due: 1406 },
    },
  }
}

function residentCtx(state: State, body: string): InboundSmsHandlerContext {
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
    conversationId: state.conversationId,
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

function landlordCtx(state: State, body: string): InboundSmsHandlerContext {
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
    conversationId: state.conversationId,
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

/**
 * Mirrors inbound_processor order: handlers → (interpretation only if not handled).
 * Does not call interpretation — returns which layer would run next.
 */
async function dispatchLayer(
  ctx: InboundSmsHandlerContext,
): Promise<"handlers" | "interpretation_next"> {
  const handlers = await tryInboundSmsHandlers(ctx)
  if (handlers.handled) return "handlers"
  return "interpretation_next"
}

Deno.test(
  "regression: Partial is unclear to recognizer (the steal path) but claimed by tenant_rent_reply when rent run is active",
  async () => {
    // 1. Mechanism of the original bug: menu recognizer treats Partial as unclear.
    const recognition = recognizeInboundIntentSync("Partial")
    assertEquals(recognition.intent, "unclear")
    assertEquals(recognition.showMenu, true)

    // 2. With active rent_collection pending state, handlers claim before interpretation.
    const withRun: State = {
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      conversationId: "conv-resident",
      intake: {},
      residentId: "res-shahita",
      run: activeRentRun("res-shahita", "conv-resident"),
    }
    const claimed = await tryInboundSmsHandlers(residentCtx(withRun, "Partial"))
    assertEquals(claimed.handled, true)
    if (!claimed.handled) return
    assertEquals(claimed.workflowRoute, "tenant_rent_reply")
    assertStringIncludes(claimed.reply?.body ?? "", "How much")
    assertEquals((claimed.reply?.body ?? "").toLowerCase().includes("repair"), false)

    const layer = await dispatchLayer(residentCtx(withRun, "Partial"))
    assertEquals(layer, "handlers")

    // 3. Without pending rent state, handlers do not claim → interpretation would run next
    //    (and would hit the unclear → clarify menu path from step 1).
    const noRun: State = {
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      conversationId: "conv-resident",
      intake: {},
      residentId: "res-shahita",
      run: null,
    }
    const missed = await tryInboundSmsHandlers(residentCtx(noRun, "Partial"))
    assertEquals(missed.handled, false)
    assertEquals(await dispatchLayer(residentCtx(noRun, "Partial")), "interpretation_next")
  },
)

Deno.test(
  "regression: landlord YES on tenant_rent_report_confirmation is claimed by handlers (not interpretation)",
  async () => {
    const state: State = {
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      conversationId: "conv-landlord",
      intake: {},
      residentId: "res-shahita",
      run: activeRentRun("res-shahita", "conv-resident"),
    }
    state.intake = upsertAwaitingTenantRentReportConfirmation({}, {
      runId: "run-rent-1",
      residentId: state.residentId,
      residentConversationId: "conv-resident",
      ledgerEventId: "ledger-1",
      reportedAmount: 700,
      amountDue: 1406,
      remainingDue: 706,
      unitLabel: "1",
      kind: "partial",
      askedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TENANT_RENT_REPORT_CONFIRM_TTL_MS).toISOString(),
    })

    // Landlord identity never enters tryHandleInterpretedInbound, but still assert
    // the registry claims the pending ask rather than falling through to workflow.
    const result = await tryInboundSmsHandlers(landlordCtx(state, "YES"))
    assertEquals(result.handled, true)
    if (!result.handled) return
    assertEquals(result.workflowRoute, "tenant_rent_report_confirmation")
    // Same claim is what dispatchLayer would short-circuit on (handlers layer).
    assertEquals(
      result.handled ? "handlers" : "interpretation_next",
      "handlers",
    )
  },
)

Deno.test(
  "contract: inbound_processor still runs handlers before tryHandleInterpretedInbound",
  async () => {
    const processorUrl = new URL("./inbound_processor.ts", import.meta.url)
    const source = await Deno.readTextFile(processorUrl)
    const handlerCall = source.indexOf("tryInboundSmsHandlers(handlerContext)")
    const interpretCall = source.indexOf("tryHandleInterpretedInbound(handlerContext)")
    assertEquals(handlerCall >= 0, true)
    assertEquals(interpretCall >= 0, true)
    assertEquals(
      handlerCall < interpretCall,
      true,
      "Handlers must run before interpretation — otherwise Partial is stolen again",
    )
    const between = source.slice(handlerCall, interpretCall)
    assertEquals(between.includes("if (handlerResult.handled)"), true)
    assertEquals(between.includes("return finishHandledInbound"), true)
  },
)
