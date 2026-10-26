import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { tryHandleEstimateDecisionInbound } from "./estimateDecisionInbound.ts"
import { tryHandleTenantScheduleConfirmInbound } from "./tenantScheduleConfirm.ts"
import {
  addScheduleQuestion,
  selectScheduleQuestion,
} from "./questionReplyRef.ts"

function fakeDb(
  intake: Record<string, unknown>,
  estimates: Record<string, unknown>[] = [],
) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let update: Record<string, unknown> | null = null
      for (const method of ["select", "eq", "gte", "lte", "limit", "order"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return chain
        }
      }
      chain.update = (value: Record<string, unknown>) => {
        update = value
        return chain
      }
      chain.maybeSingle = () =>
        Promise.resolve({
          data: table === "sms_conversations"
            ? {
              id: "sim-thread",
              conversation_type: "landlord_update",
              intake_state: intake,
            }
            : { vendor_work_status: "completed" },
          error: null,
        })
      chain.then = (resolve: (value: unknown) => unknown) => {
        if (update?.intake_state) {
          for (const key of Object.keys(intake)) delete intake[key]
          Object.assign(intake, update.intake_state)
        }
        return Promise.resolve({
          data: table === "maintenance_estimates" ? estimates : [],
          error: null,
        }).then(resolve)
      }
      return chain
    },
  }
  return { db: db as never, calls }
}

Deno.test("old superseded estimate reply never approves the newer pending estimate", async () => {
  const old = "11111111-1111-4111-8111-111111111111"
  const newer = "22222222-2222-4222-8222-222222222222"
  const intake = {
    awaiting_estimate_decision: {
      estimate_id: newer,
      action_token: "sim-token",
      ticket_id: "sim-job",
    },
  }
  const { db, calls } = fakeDb(intake, [{ id: old, status: "superseded" }])
  const result = await tryHandleEstimateDecisionInbound(db, {
    landlordId: "sim-account",
    conversationId: "sim-thread",
    messageId: "sim-message",
    body: "E-111111111111 APPROVE",
    identityType: "landlord",
  })
  assertEquals(result.handled, true)
  if (result.handled) assertEquals(result.estimateId, old)
  assertEquals(intake.awaiting_estimate_decision.estimate_id, newer)
  assertEquals(
    calls.some((c) =>
      c.table === "maintenance_estimates" && c.method === "eq" &&
      c.args[0] === "landlord_id" && c.args[1] === "sim-account"
    ),
    true,
  )
})

Deno.test("estimate reference collision or unknown account match never picks a version", async () => {
  for (const estimates of [[], [{ id: "one" }, { id: "two" }]]) {
    const { db } = fakeDb({}, estimates)
    const result = await tryHandleEstimateDecisionInbound(db, {
      landlordId: "sim-account",
      conversationId: "sim-thread",
      messageId: "sim-message",
      body: "E-111111111111 APPROVE",
      identityType: "landlord",
    })
    assertEquals(result.handled, true)
    if (result.handled) assertEquals(result.estimateId, "")
  }
})

Deno.test("vendor cannot authorize a landlord estimate using its question reference", async () => {
  const result = await tryHandleEstimateDecisionInbound({} as never, {
    landlordId: "sim-account",
    conversationId: "sim-thread",
    messageId: "sim-message",
    body: "E-111111111111 APPROVE",
    identityType: "vendor",
  })
  assertEquals(result.handled, false)
})

Deno.test("older completed visit is acknowledged without removing another job's question", async () => {
  const old = {
    reply_ref: "S-111111111111",
    ticket_id: "sim-old-job",
    vendor_id: "sim-vendor",
    window_text: "Monday 9am",
    expires_at: "2099-01-01T00:00:00Z",
  }
  const newer = {
    ...old,
    reply_ref: "S-222222222222",
    ticket_id: "sim-new-job",
  }
  const intake = addScheduleQuestion(addScheduleQuestion({}, old), newer)
  const { db, calls } = fakeDb(intake)
  const result = await tryHandleTenantScheduleConfirmInbound(db, {
    landlordId: "sim-account",
    conversationId: "sim-thread",
    messageId: "sim-inbound",
    body: "S-111111111111 YES",
    identityType: "resident",
  })
  assertEquals(result.handled, true)
  if (result.handled) assertEquals(result.ticketId, "sim-old-job")
  assertEquals(
    selectScheduleQuestion(intake, "S-222222222222 YES").kind,
    "selected",
  )
  assertEquals(
    selectScheduleQuestion(intake, "S-111111111111 YES").kind,
    "clarify",
  )
  assertEquals(
    calls.some((c) =>
      c.table === "maintenance_requests" && c.method === "eq" &&
      c.args[0] === "id" && c.args[1] === "sim-old-job"
    ),
    true,
  )
})
