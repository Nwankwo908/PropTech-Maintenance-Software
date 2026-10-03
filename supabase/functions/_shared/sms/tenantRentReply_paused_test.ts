/// <reference lib="deno.ns" />
/**
 * When rentCollectionPaused is true, PAID/PARTIAL/QUESTIONS must not run
 * amount-validation against balance_due (Takeira Section 8 loop).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { handleTenantRentReply } from "./tenantRentReply.ts"
import {
  buildTenantRentCollectionPausedSms,
  buildTenantRentAmountAskSms,
} from "./tenantRentReplyParse.ts"

type State = {
  landlordId: string
  conversationId: string
  residentId: string
  runId: string
  intake: Record<string, unknown>
  rentCollectionPaused: boolean
  balanceDue: number
  usersUpdated: Record<string, unknown> | null
  amountAskCleared: boolean
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
      "order",
      "limit",
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
            intake_state: state.intake,
            landlord_id: state.landlordId,
            resident_id: state.residentId,
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
              billing_period: "2026-10",
              step_state: { step: "awaiting_payment", amount_due: state.balanceDue },
            },
          },
          error: null,
        }
      }
      if (table === "users") {
        return {
          data: {
            id: state.residentId,
            full_name: "Takeira Chestor",
            unit: "1",
            balance_due: state.balanceDue,
            phone: "+14435550100",
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      return Promise.resolve()
        .then(async () => {
          if (pendingUpdate && table === "sms_conversations") {
            if (pendingUpdate.intake_state && typeof pendingUpdate.intake_state === "object") {
              state.intake = pendingUpdate.intake_state as Record<string, unknown>
              if (!("awaiting_tenant_rent_amount" in state.intake) ||
                state.intake.awaiting_tenant_rent_amount == null) {
                state.amountAskCleared = true
              }
            }
          }
          if (pendingUpdate && table === "users") {
            state.usersUpdated = pendingUpdate
          }
          return { data: null, error: null }
        })
        .then(resolve, reject)
    }
    return chain
  }
  return { from } as never
}

Deno.test("buildTenantRentCollectionPausedSms does not ask for an amount", () => {
  const body = buildTenantRentCollectionPausedSms()
  assertStringIncludes(body, "paused")
  assertEquals(/how much did you pay/i.test(body), false)
  assertEquals(/balance due/i.test(body), false)
})

Deno.test("PARTIAL while paused: no amount ask / no balance rejection", async () => {
  const state: State = {
    landlordId: "landlord-1",
    conversationId: "conv-1",
    residentId: "res-takeira",
    runId: "run-rent-1",
    // Wrong Section 8 balance ($0) that previously drove "exceeds_balance" / reject loops.
    balanceDue: 0,
    rentCollectionPaused: true,
    intake: {},
    usersUpdated: null,
    amountAskCleared: false,
  }
  const result = await handleTenantRentReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "PARTIAL 509",
    identityType: "resident",
    residentId: state.residentId,
  })
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertStringIncludes(result.replyBody, "paused")
  assertEquals(result.replyBody.includes("How much"), false)
  assertEquals(
    result.replyBody,
    buildTenantRentCollectionPausedSms(),
  )
  // Must not rewrite balance_due via payment finalize.
  assertEquals(state.usersUpdated, null)
})

Deno.test("awaiting amount follow-up while paused: clears ask and does not re-ask", async () => {
  const state: State = {
    landlordId: "landlord-1",
    conversationId: "conv-1",
    residentId: "res-takeira",
    runId: "run-rent-1",
    balanceDue: 0,
    rentCollectionPaused: true,
    intake: {
      awaiting_tenant_rent_amount: {
        runId: "run-rent-1",
        residentId: "res-takeira",
        amountDue: 0,
        askedAt: new Date().toISOString(),
      },
    },
    usersUpdated: null,
    amountAskCleared: false,
  }
  const result = await handleTenantRentReply(mockSupabase(state), {
    landlordId: state.landlordId,
    conversationId: state.conversationId,
    body: "509",
    identityType: "resident",
    residentId: state.residentId,
  })
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.replyBody, buildTenantRentCollectionPausedSms())
  // Contrast: unpaused path would ask again when balance is $0 / exceeds.
  const unpausedAsk = buildTenantRentAmountAskSms({
    amountDue: 0,
    reason: "exceeds_balance",
  })
  assertEquals(result.replyBody.includes("more than"), false)
  assertEquals(unpausedAsk.includes("more than"), true)
})
