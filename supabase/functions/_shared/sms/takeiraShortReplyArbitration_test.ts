/// <reference lib="deno.ns" />
/**
 * Takeira-style arbitration: ticket-update YES beats rent-pause PAID token.
 * Identical-reply loop only counts delivered/sent outbounds.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { tryInboundSmsHandlers } from "./inboundHandlerRegistry.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import { handleTenantRentReply } from "./tenantRentReply.ts"
import {
  listSpecificYesNoPendingAsks,
  shouldClarifyAmbiguousYesPendingAsks,
  shouldYieldRentReplyToSpecificPendingAsk,
} from "./shortReplyArbitration.ts"
import {
  outboundCountsTowardIdenticalReplyLoop,
  shouldSuppressIdenticalOutbound,
} from "./sms_inbound_guard.ts"
import { buildTenantRentCollectionPausedSms } from "./tenantRentReplyParse.ts"

type State = {
  landlordId: string
  conversationId: string
  residentId: string
  runId: string
  intake: Record<string, unknown>
  rentCollectionPaused: boolean
  balanceDue: number
}

function mockSupabase(state: State) {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null
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
      "order",
      "limit",
      "range",
      "filter",
      "match",
    ]) {
      chain[m] = passthrough
    }
    chain.eq = () => chain
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
            intake_state: state.intake,
            landlord_id: state.landlordId,
            resident_id: state.residentId,
            workflow_run_id: state.runId,
            workflow_template_id: "rent_collection",
          },
          error: null,
        }
      }
      if (table === "landlord_onboarding") {
        return {
          data: {
            landlord_id: state.landlordId,
            account_settings: {
              operational: { rentCollectionPaused: state.rentCollectionPaused },
              organization: { rentCollectionPaused: state.rentCollectionPaused },
            },
          },
          error: null,
        }
      }
      if (table === "landlords") {
        return {
          data: { id: state.landlordId, time_zone: "America/New_York" },
          error: null,
        }
      }
      if (table === "workflow_runs") {
        return {
          data: {
            id: state.runId,
            status: "active",
            template_id: "rent_collection",
            landlord_id: state.landlordId,
            resident_id: state.residentId,
            current_step: "awaiting_payment",
            metadata: {
              amount_due: state.balanceDue,
              step_state: {
                step: "payment_reminder_sent",
                amount_due: state.balanceDue,
              },
            },
          },
          error: null,
        }
      }
      if (table === "users") {
        return {
          data: {
            id: state.residentId,
            full_name: "Takeira Chester",
            unit: "1",
            balance_due: state.balanceDue,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve()
        .then(async () => {
          if (pendingUpdate?.intake_state && typeof pendingUpdate.intake_state === "object") {
            state.intake = pendingUpdate.intake_state as Record<string, unknown>
          }
          return {
            data: [
              {
                id: state.runId,
                status: "active",
                template_id: "rent_collection",
                landlord_id: state.landlordId,
                resident_id: state.residentId,
                current_step: "awaiting_payment",
                metadata: {
                  amount_due: state.balanceDue,
                  step_state: {
                    step: "payment_reminder_sent",
                    amount_due: state.balanceDue,
                  },
                },
              },
            ],
            error: null,
          }
        })
        .then(resolve, reject)
    return chain
  }
  return { from } as never
}

function residentCtx(state: State, body: string): InboundSmsHandlerContext {
  return {
    supabase: mockSupabase(state),
    inbound: {
      from: "+14437507507",
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
      id: "ident-takeira",
      landlord_id: state.landlordId,
      resident_id: state.residentId,
      vendor_id: null,
      unit_id: null,
      phone_number: "+14437507507",
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

Deno.test("ticket-update confirm is a specific YES/NO pending ask", () => {
  const asks = listSpecificYesNoPendingAsks({
    awaiting_ticket_update_confirm: true,
    pending_ticket_update_id: "5fa6af38-f5eb-4274-a2c4-087d5707a36f",
  })
  assertEquals(asks.includes("ticket_update_confirm"), true)
  assertEquals(
    shouldYieldRentReplyToSpecificPendingAsk({
      intakeState: {
        awaiting_ticket_update_confirm: true,
      },
      body: "Yes",
    }),
    true,
  )
  assertEquals(
    shouldYieldRentReplyToSpecificPendingAsk({
      intakeState: {},
      body: "Yes",
    }),
    false,
  )
})

Deno.test(
  "bare Yes with ticket-confirm pending + rent paused yields rent (ticket confirm wins)",
  async () => {
    const state: State = {
      landlordId: "de300000-0000-4000-8000-000000000003",
      conversationId: "30a07f48-214e-4b87-857c-791ac8be3038",
      residentId: "d8059b3a-f03c-4630-97dc-a8f539522256",
      runId: "2164b911-c9bb-48fd-86f4-389c75d9ac1d",
      rentCollectionPaused: true,
      balanceDue: 0,
      intake: {
        awaiting_ticket_update_confirm: true,
        pending_ticket_update_id: "5fa6af38-f5eb-4274-a2c4-087d5707a36f",
        pending_ticket_update_text: "The exterminator already came on Monday",
        awaiting_which_request: true,
      },
    }

    const direct = await handleTenantRentReply(mockSupabase(state), {
      landlordId: state.landlordId,
      conversationId: state.conversationId,
      body: "Yes",
      identityType: "resident",
      residentId: state.residentId,
    })
    assertEquals(direct.handled, false)

    const registry = await tryInboundSmsHandlers(residentCtx(state, "Yes"))
    assertEquals(registry.handled, false)
    // Rent-pause ack must not fire instead of the ticket confirm.
    assertEquals(
      (registry.handled && "reply" in registry
        ? registry.reply?.body
        : "") === buildTenantRentCollectionPausedSms(),
      false,
    )
  },
)

Deno.test(
  "PAID while paused still claims pause ack when no specific YES ask is open",
  async () => {
    const state: State = {
      landlordId: "landlord-1",
      conversationId: "conv-1",
      residentId: "res-1",
      runId: "run-1",
      rentCollectionPaused: true,
      balanceDue: 0,
      intake: {},
    }
    const result = await handleTenantRentReply(mockSupabase(state), {
      landlordId: state.landlordId,
      conversationId: state.conversationId,
      body: "PAID",
      identityType: "resident",
      residentId: state.residentId,
    })
    assertEquals(result.handled, true)
    if (!result.handled) return
    assertEquals(result.replyBody, buildTenantRentCollectionPausedSms())
  },
)

Deno.test("two specific YES asks still clarify", () => {
  assertEquals(
    shouldClarifyAmbiguousYesPendingAsks({
      intakeState: {
        awaiting_invoice_paid_confirmation: {
          invoices: [{ ticketId: "t1" }],
        },
        awaiting_vendor_choice: { options: [{ vendorId: "v1" }] },
      },
      body: "YES",
    }),
    true,
  )
})

Deno.test("failed/undelivered outbound does not count toward identical-reply loop", () => {
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "failed" }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "undelivered" }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({
      providerStatus: "sent",
      rawPayload: { send_error: "twilio timeout" },
    }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "delivered" }),
    true,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "sent" }),
    true,
  )

  const whichRequest =
    "Which request are you asking about?\n\n• Pest control — WO-5FA6\n• Painting — WO-C1E9"
  // Only a failed candidate exists → must not suppress the next real send.
  const fromFailedOnly = shouldSuppressIdenticalOutbound({
    recentOutboundBodies: [],
    candidateBody: whichRequest,
  })
  assertEquals(fromFailedOnly.trip, false)

  // A real prior send still suppresses a duplicate.
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [whichRequest],
      candidateBody: whichRequest,
    }).trip,
    true,
  )
})

Deno.test(
  "Takeira sequence: after YES yields to ticket confirm, scheduling ask is not a rent claim",
  async () => {
    const state: State = {
      landlordId: "de300000-0000-4000-8000-000000000003",
      conversationId: "30a07f48-214e-4b87-857c-791ac8be3038",
      residentId: "d8059b3a-f03c-4630-97dc-a8f539522256",
      runId: "2164b911-c9bb-48fd-86f4-389c75d9ac1d",
      rentCollectionPaused: true,
      balanceDue: 0,
      intake: {
        // Confirm already resolved; scheduling question is free-text.
        awaiting_ticket_update_confirm: false,
        awaiting_which_request: false,
      },
    }
    const body =
      "Which day will someone be reaching out for the repairs before inspection"
    const rent = await handleTenantRentReply(mockSupabase(state), {
      landlordId: state.landlordId,
      conversationId: state.conversationId,
      body,
      identityType: "resident",
      residentId: state.residentId,
    })
    assertEquals(rent.handled, false)
    const registry = await tryInboundSmsHandlers(residentCtx(state, body))
    assertEquals(registry.handled, false)
    assertStringIncludes(body.toLowerCase(), "repairs before inspection")
  },
)
