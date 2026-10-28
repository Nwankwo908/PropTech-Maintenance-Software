/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { closeWorkOrderResolvedByResident } from "./tenantResolvedWorkOrder.ts"

const TICKET = "676fe1dd-e025-4608-bec5-045e0a3345f5"
const OTHER = "30a0b8cc-4284-42a7-8139-b59e219219f0"
const LANDLORD = "d15a0000-0000-4000-8000-000000000001"
const RUN = "4334bad2-1c8f-4fdb-b926-fee98588ab2e"

type Write = { op: "update" | "insert"; table: string; payload: Record<string, unknown> }

function client(state: {
  ticket: Record<string, unknown>
  runs: Record<string, unknown>[]
  writes: Write[]
}) {
  return {
    from(table: string) {
      let last: "update" | "insert" | "read" = "read"
      const builder: Record<string, unknown> = {}
      const self = new Proxy(builder, {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) => {
              let data: unknown = []
              if (last === "update" && table === "maintenance_requests") {
                data = [{ id: state.ticket.id }]
              } else if (table === "workflow_runs" && last === "read") {
                data = state.runs
              } else if (last === "insert") {
                data = { id: "event-1" }
              }
              return Promise.resolve({ data, error: null }).then(resolve)
            }
          }
          if (prop === "update") {
            return (payload: Record<string, unknown>) => {
              last = "update"
              state.writes.push({ op: "update", table, payload })
              if (table === "maintenance_requests") {
                state.ticket = { ...state.ticket, ...payload }
              }
              if (table === "workflow_runs" && state.runs[0]) {
                state.runs[0] = { ...state.runs[0], ...payload }
              }
              return self
            }
          }
          if (prop === "insert") {
            return (payload: Record<string, unknown>) => {
              last = "insert"
              state.writes.push({ op: "insert", table, payload })
              return self
            }
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => {
              if (table === "maintenance_requests") {
                return { data: { ...state.ticket }, error: null }
              }
              return { data: last === "insert" ? { id: "event-1" } : null, error: null }
            }
          }
          return () => self
        },
      })
      return self
    },
  } as unknown as SupabaseClient
}

function openTicket(): {
  ticket: Record<string, unknown>
  runs: Record<string, unknown>[]
  writes: Write[]
} {
  return {
    ticket: {
      id: TICKET,
      status: "open",
      vendor_work_status: "unassigned",
      completed_at: null,
      landlord_id: LANDLORD,
    },
    runs: [{
      id: RUN,
      entity_id: TICKET,
      entity_type: "maintenance_request",
      metadata: {},
      resident_id: null,
      completed_at: null,
      status: "active",
    }],
    writes: [] as Write[],
  }
}

Deno.test("a tenant fix completes the request and its task without vendor outreach", async () => {
  const state = openTicket()
  const result = await closeWorkOrderResolvedByResident(client(state), {
    landlordId: LANDLORD,
    ticketId: TICKET,
    residentId: "resident-1",
  })
  assertEquals(result.ok, true)
  assertEquals(result.alreadyClosed, false)
  assertEquals(state.ticket.status, "completed")
  assertEquals(state.ticket.vendor_work_status, "completed")
  assertEquals(state.ticket.resolution, "tenant_self_fix")
  assertEquals(state.runs[0].status, "completed")
  assertEquals(state.writes.some((row) => row.table === "sms_messages"), false)
  assertEquals(
    state.writes.some((row) =>
      row.op === "insert" && row.table === "operations_graph_events" &&
      row.payload.event_type === "maintenance.tenant_self_fix"
    ),
    true,
  )
  const before = state.writes.length
  const again = await closeWorkOrderResolvedByResident(client(state), {
    landlordId: LANDLORD,
    ticketId: TICKET,
  })
  assertEquals(again.alreadyClosed, true)
  assertEquals(state.writes.length, before)
})

Deno.test("only the named request is completed", async () => {
  const state = openTicket()
  state.runs.push({
    id: "other-run",
    entity_id: OTHER,
    entity_type: "maintenance_request",
    metadata: {},
    resident_id: null,
    completed_at: null,
    status: "active",
  })
  await closeWorkOrderResolvedByResident(client(state), {
    landlordId: LANDLORD,
    ticketId: TICKET,
  })
  assertEquals(state.runs[0].status, "completed")
  assertEquals(state.runs[1].status, "active")
})

Deno.test("a misclassified cancellation can be corrected once", async () => {
  const state = openTicket()
  state.ticket.vendor_work_status = "cancelled"
  state.ticket.status = "open"
  state.runs[0].status = "cancelled"
  const left = await closeWorkOrderResolvedByResident(client(state), {
    landlordId: LANDLORD,
    ticketId: TICKET,
  })
  assertEquals(left.alreadyClosed, true)
  assertEquals(state.ticket.vendor_work_status, "cancelled")
  const corrected = await closeWorkOrderResolvedByResident(client(state), {
    landlordId: LANDLORD,
    ticketId: TICKET,
    completedAt: "2026-10-28T02:00:00.000Z",
    correctMisclassifiedCancel: true,
  })
  assertEquals(corrected.alreadyClosed, false)
  assertEquals(state.ticket.status, "completed")
  assertEquals(state.ticket.vendor_work_status, "completed")
  assertEquals(state.runs[0].status, "completed")
})
