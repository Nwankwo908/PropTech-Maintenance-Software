/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  parseRepeatedApprovalReply,
  resolveRepeatedApproval,
  vendorNotificationVerified,
  type RepeatedApprovalTarget,
} from "../../../../shared/sms/repeatedApprovalAck.ts"
import { tryHandleRepeatedLandlordApproval } from "./repeatedLandlordApproval.ts"

const HALLWAY = "c06e11f2-df1c-4a20-9e69-f8cbf32d214a"
const BATH = "eb1d7cfc-3d70-4f57-bd59-680bdb997120"
const LANDLORD = "d15a0000-0000-4000-8000-000000000001"
const CONV = "42a2c3fe-2682-4ce2-b179-101889418d05"
const PHONE = "+18623306458"

function target(
  patch: Partial<RepeatedApprovalTarget> & Pick<RepeatedApprovalTarget, "ticketId" | "ref">,
): RepeatedApprovalTarget {
  return {
    workOrderRef: `WO-${patch.ticketId.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
    label: "That request",
    vendorNotified: true,
    batchId: "latest",
    ...patch,
  }
}

const hallway = target({
  ticketId: HALLWAY,
  ref: "C06E11F2",
  label: "The ceiling light in the upstairs hallway near the bedrooms is out",
  batchId: "hallway-batch",
})
const bathroom = target({
  ticketId: BATH,
  ref: "EB1D7CFC",
  label: "The bathroom light won't turn on",
  batchId: "bath-batch",
})

Deno.test("a repeated YES acknowledges the one completed approval", () => {
  const decision = resolveRepeatedApproval({
    body: "Yes",
    pendingQuestionCount: 0,
    latestAsk: [hallway],
    namedPool: [hallway, bathroom],
  })
  assertEquals(decision.action, "acknowledge")
  if (decision.action !== "acknowledge") return
  assertEquals(decision.ticketId, HALLWAY)
  assertEquals(
    decision.body,
    "This request is already approved. The vendor has already been notified. Ref: C06E11F2.",
  )
})

Deno.test("a delayed YES still acknowledges that same approval", () => {
  const decision = resolveRepeatedApproval({
    body: "YES",
    pendingQuestionCount: 0,
    latestAsk: [hallway],
    namedPool: [hallway],
  })
  assertEquals(decision.action, "acknowledge")
  if (decision.action !== "acknowledge") return
  assertEquals(decision.body.includes("Ref: C06E11F2."), true)
})

Deno.test("several requests in the latest ask are clarified", () => {
  const decision = resolveRepeatedApproval({
    body: "approve",
    pendingQuestionCount: 0,
    latestAsk: [hallway, { ...bathroom, batchId: "hallway-batch" }],
    namedPool: [],
  })
  assertEquals(decision.action, "clarify")
  if (decision.action !== "clarify") return
  assertEquals(decision.body.includes("Which request did you mean?"), true)
  assertEquals(decision.body.includes("C06E11F2"), true)
  assertEquals(decision.body.includes("EB1D7CFC"), true)
  assertEquals(decision.body.includes("has already been notified"), false)
})

Deno.test("a pending question with nothing approved is left to its own handler", () => {
  const decision = resolveRepeatedApproval({
    body: "Yes",
    pendingQuestionCount: 1,
    latestAsk: [],
    namedPool: [],
  })
  assertEquals(decision.action, "ignore")
})

Deno.test("a different pending question is clarified instead of assumed", () => {
  const decision = resolveRepeatedApproval({
    body: "Yes",
    pendingQuestionCount: 2,
    latestAsk: [hallway],
    namedPool: [hallway],
  })
  assertEquals(decision.action, "clarify")
  if (decision.action !== "clarify") return
  assertEquals(decision.body.includes("different question"), true)
  assertEquals(decision.body.includes("C06E11F2"), false)
})

Deno.test("a failed vendor notification is not described as sent", () => {
  assertEquals(
    vendorNotificationVerified({
      vendorNotifiedAt: "2026-10-28T05:05:27.257Z",
      vendorNotifyError: "SMS provider rejected the message",
    }),
    false,
  )
  assertEquals(
    vendorNotificationVerified({ vendorNotifiedAt: null, vendorNotifyError: null }),
    false,
  )
  const decision = resolveRepeatedApproval({
    body: "Yes",
    pendingQuestionCount: 0,
    latestAsk: [{ ...hallway, vendorNotified: false }],
    namedPool: [],
  })
  assertEquals(decision.action, "acknowledge")
  if (decision.action !== "acknowledge") return
  assertEquals(
    decision.body,
    "This request is already approved. The vendor has not been notified yet. Ref: C06E11F2.",
  )
  assertEquals(decision.body.includes("has already been notified"), false)
})

Deno.test("a named reference selects that approval and ignores a newer one", () => {
  const decision = resolveRepeatedApproval({
    body: "YES EB1D7CFC",
    pendingQuestionCount: 0,
    latestAsk: [hallway],
    namedPool: [hallway, bathroom],
  })
  assertEquals(decision.action, "acknowledge")
  if (decision.action !== "acknowledge") return
  assertEquals(decision.ticketId, BATH)
  assertEquals(decision.body.includes("Ref: EB1D7CFC."), true)
})

Deno.test("an unrelated landlord text is ignored", () => {
  assertEquals(parseRepeatedApprovalReply("The sink is leaking").kind, "none")
  assertEquals(
    resolveRepeatedApproval({
      body: "The sink is leaking",
      pendingQuestionCount: 0,
      latestAsk: [hallway],
      namedPool: [hallway],
    }).action,
    "ignore",
  )
})

type Filter = { op: "eq" | "in"; col: string; val: unknown }

function mockDb(input: {
  intake?: unknown
  batches: Array<Record<string, unknown>>
  items: Array<Record<string, unknown>>
  tickets: Array<Record<string, unknown>>
}): { client: SupabaseClient; writes: string[] } {
  const writes: string[] = []
  const client = {
    from(table: string) {
      const filters: Filter[] = []
      const rows = () => {
        const all = table === "sms_conversations"
          ? [{
            id: CONV,
            landlord_id: LANDLORD,
            intake_state: input.intake ?? {},
            external_phone_number: PHONE,
          }]
          : table === "landlord_pick_batches"
          ? input.batches
          : table === "landlord_pick_batch_items"
          ? input.items
          : table === "maintenance_requests"
          ? input.tickets
          : []
        return all.filter((row) => {
          const record = row as Record<string, unknown>
          return filters.every((filter) => {
            if (filter.op === "eq") return record[filter.col] === filter.val
            const values = filter.val as unknown[]
            return values.includes(record[filter.col])
          })
        })
      }
      const api: Record<string, unknown> = {}
      const chain = () => api
      api.select = chain
      api.eq = (col: string, val: unknown) => {
        filters.push({ op: "eq", col, val })
        return api
      }
      api.in = (col: string, val: unknown) => {
        filters.push({ op: "in", col, val })
        return api
      }
      api.order = chain
      api.limit = chain
      api.update = () => {
        writes.push(`update ${table}`)
        return api
      }
      api.insert = () => {
        writes.push(`insert ${table}`)
        return api
      }
      api.delete = () => {
        writes.push(`delete ${table}`)
        return api
      }
      api.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      api.then = (resolve: (value: unknown) => void) => {
        resolve({ data: rows(), error: null })
      }
      return api
    },
  }
  return { client: client as unknown as SupabaseClient, writes }
}

function hallwayState(patch?: {
  intake?: unknown
  notifiedAt?: string | null
  notifyError?: string | null
  assigned?: string | null
  extraTicket?: boolean
}) {
  const notifiedAt = patch && "notifiedAt" in patch
    ? patch.notifiedAt
    : "2026-10-28T05:05:27.257Z"
  return mockDb({
    intake: patch?.intake,
    batches: [
      {
        id: "hallway-batch",
        landlord_id: LANDLORD,
        status: "closed",
        created_at: "2026-10-28T02:45:20.633Z",
        recipient_phone: PHONE,
      },
      {
        id: "bath-batch",
        landlord_id: LANDLORD,
        status: "closed",
        created_at: "2026-10-27T11:54:40.426Z",
        recipient_phone: PHONE,
      },
    ],
    items: [
      {
        batch_id: "hallway-batch",
        ticket_id: HALLWAY,
        position: 1,
        snapshot: { issue: "hallway light" },
      },
      ...(patch?.extraTicket
        ? [{
          batch_id: "hallway-batch",
          ticket_id: BATH,
          position: 2,
          snapshot: { issue: "bathroom light" },
        }]
        : [{
          batch_id: "bath-batch",
          ticket_id: BATH,
          position: 1,
          snapshot: { issue: "bathroom light" },
        }]),
    ],
    tickets: [
      {
        id: HALLWAY,
        landlord_id: LANDLORD,
        resident_request_ref: "C06E11F2",
        vendor_notified_at: notifiedAt,
        vendor_notify_error: patch?.notifyError ?? null,
        assigned_vendor_id: patch && "assigned" in patch
          ? patch.assigned
          : "a1b2c3d4-0000-4000-8000-000000000022",
        vendor_work_status: "pending_accept",
        issue_headline: "The ceiling light in the upstairs hallway near the bedrooms is out",
      },
      {
        id: BATH,
        landlord_id: LANDLORD,
        resident_request_ref: "EB1D7CFC",
        vendor_notified_at: "2026-10-27T12:00:00.000Z",
        vendor_notify_error: null,
        assigned_vendor_id: "a1b2c3d4-0000-4000-8000-000000000022",
        vendor_work_status: "accepted",
        issue_headline: "The bathroom light won't turn on",
      },
    ],
  })
}

function call(client: SupabaseClient, body: string, identity = "landlord") {
  return tryHandleRepeatedLandlordApproval(client, {
    landlordId: LANDLORD,
    conversationId: CONV,
    body,
    identityType: identity,
    fromPhone: PHONE,
  })
}

Deno.test("the closed-batch YES replies once and does not write", async () => {
  const { client, writes } = hallwayState()
  const result = await call(client, "Yes")
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(
    result.replyBody,
    "This request is already approved. The vendor has already been notified. Ref: C06E11F2.",
  )
  assertEquals(writes, [])
})

Deno.test("a pending estimate question is not treated as the old approval", async () => {
  const { client, writes } = hallwayState({
    intake: {
      awaiting_estimate_decision: { estimate_id: "est-1", ticket_id: BATH },
    },
  })
  const result = await call(client, "Yes")
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.ticketId, null)
  assertEquals(result.replyBody.includes("different question"), true)
  assertEquals(writes, [])
})

Deno.test("a send error does not claim the vendor was notified", async () => {
  const { client, writes } = hallwayState({
    notifyError: "carrier rejected",
  })
  const result = await call(client, "Yes")
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(
    result.replyBody,
    "This request is already approved. The vendor has not been notified yet. Ref: C06E11F2.",
  )
  assertEquals(writes, [])
})

Deno.test("two requests in the latest approval ask are clarified without a write", async () => {
  const { client, writes } = hallwayState({ extraTicket: true })
  const result = await call(client, "Yes")
  assertEquals(result.handled, true)
  if (!result.handled) return
  assertEquals(result.replyBody.includes("Which request did you mean?"), true)
  assertEquals(writes, [])
})

Deno.test("a vendor YES is not an approval acknowledgement", async () => {
  const { client, writes } = hallwayState()
  const result = await call(client, "Yes", "vendor")
  assertEquals(result.handled, false)
  assertEquals(writes, [])
})
