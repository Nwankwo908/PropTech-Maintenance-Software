/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  reduceScheduleFsm,
  SCHEDULE_TTL_MS,
  VENDOR_SCHEDULE_KEY,
  withVendorScheduleFsm,
} from "./vendor_schedule_fsm.ts"
import { processScheduleFsmTtlChecks } from "./scheduleFsmTtl.ts"

type Convo = {
  id: string
  landlord_id: string
  vendor_id: string
  maintenance_request_id: string | null
  intake_state: Record<string, unknown>
  conversation_type: string
  updated_at: string
}

function mockSupabase(state: { convos: Convo[] }) {
  const from = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingInsert: unknown = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val })
      return chain()
    }
    api.not = () => chain()
    api.order = () => chain()
    api.limit = () => chain()
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.insert = (row: unknown) => {
      pendingInsert = row
      return chain()
    }
    api.maybeSingle = async () => {
      if (table === "vendors") {
        return { data: null, error: null }
      }
      if (table === "sms_conversations") {
        const id = String(filters.find((f) => f.col === "id")?.val ?? "")
        const row = state.convos.find((c) => c.id === id)
        return {
          data: row
            ? { id: row.id, intake_state: row.intake_state }
            : null,
          error: null,
        }
      }
      return { data: null, error: null }
    }
    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (pendingUpdate && table === "sms_conversations") {
          const id = String(filters.find((f) => f.col === "id")?.val ?? "")
          const row = state.convos.find((c) => c.id === id)
          if (row) {
            Object.assign(row, pendingUpdate)
            if (pendingUpdate.intake_state) {
              row.intake_state = pendingUpdate.intake_state as Record<
                string,
                unknown
              >
            }
          }
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingInsert) {
          pendingInsert = null
          resolve({ data: null, error: null })
          return
        }
        if (table === "sms_conversations") {
          let rows = state.convos.filter(
            (c) => c.conversation_type === "vendor_alert",
          )
          const landlordFilter = filters.find((f) => f.col === "landlord_id")
          if (landlordFilter) {
            rows = rows.filter((c) => c.landlord_id === landlordFilter.val)
          }
          resolve({ data: rows, error: null })
          return
        }
        resolve({ data: null, error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }

  return {
    from,
  } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test("processScheduleFsmTtlChecks fires TTL_CHECK on expired awaiting_tenant_confirmation", async () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t-ttl-1",
    at: "2026-07-19T12:00:00.000Z",
  })
  const proposed = reduceScheduleFsm(started.state, {
    type: "AVAILABILITY_TEXT",
    at: "2026-07-19T12:05:00.000Z",
    windowText: "Wed 2pm",
    scheduledAt: "2026-07-22T18:00:00.000Z",
    outcome: "resolved",
  })
  assertEquals(proposed.state.step, "awaiting_tenant_confirmation")

  const expired = {
    ...proposed.state,
    expiresAt: "2026-07-19T13:00:00.000Z",
  }
  const state = {
    convos: [
      {
        id: "conv-1",
        landlord_id: "llllllll-llll-4lll-8lll-llllllllllll",
        vendor_id: "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv",
        maintenance_request_id: "t-ttl-1",
        conversation_type: "vendor_alert",
        updated_at: "2026-07-19T12:10:00.000Z",
        intake_state: withVendorScheduleFsm({}, expired),
      },
    ],
  }
  const supabase = mockSupabase(state)
  const summary = await processScheduleFsmTtlChecks(supabase, {
    now: new Date("2026-07-20T14:00:00.000Z"),
  })
  assertEquals(summary.scanned >= 1, true)
  assertEquals(summary.expired, 1)

  const fsm = state.convos[0]!.intake_state[VENDOR_SCHEDULE_KEY] as {
    step: string
  }
  assertEquals(fsm.step, "awaiting_availability")
  assertEquals(SCHEDULE_TTL_MS, 24 * 60 * 60 * 1000)
})

Deno.test("processScheduleFsmTtlChecks skips non-expired pre-scheduled steps", async () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t-ttl-2",
    at: "2026-07-20T12:00:00.000Z",
  })
  assertEquals(started.state.step, "awaiting_availability")
  const state = {
    convos: [
      {
        id: "conv-2",
        landlord_id: "llllllll-llll-4lll-8lll-llllllllllll",
        vendor_id: "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv",
        maintenance_request_id: "t-ttl-2",
        conversation_type: "vendor_alert",
        updated_at: "2026-07-20T12:00:00.000Z",
        intake_state: withVendorScheduleFsm({}, started.state),
      },
    ],
  }
  const supabase = mockSupabase(state)
  const summary = await processScheduleFsmTtlChecks(supabase, {
    now: new Date("2026-07-20T12:30:00.000Z"),
  })
  assertEquals(summary.scanned, 1)
  assertEquals(summary.expired, 0)
  assertEquals(summary.skipped, 1)
  const fsm = state.convos[0]!.intake_state[VENDOR_SCHEDULE_KEY] as {
    step: string
  }
  assertEquals(fsm.step, "awaiting_availability")
})
