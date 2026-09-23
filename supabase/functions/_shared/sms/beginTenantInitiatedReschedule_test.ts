/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  beginTenantInitiatedReschedule,
  buildVendorTenantInitiatedRescheduleSms,
} from "./vendorRescheduleSms.ts"
import { VENDOR_SCHEDULE_KEY } from "../vendor_schedule_fsm.ts"

const LANDLORD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TICKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const VENDOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CONV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

type State = {
  ticket: Record<string, unknown>
  vendor: { id: string; name: string; phone: string | null }
  conversation: {
    id: string
    landlord_id: string
    vendor_id: string
    maintenance_request_id: string
    conversation_type: string
    intake_state: Record<string, unknown>
  }
}

function mockSupabase(state: State) {
  const from = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingInsert: Record<string, unknown> | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val })
      return chain()
    }
    api.order = () => chain()
    api.limit = () => chain()
    api.maybeSingle = async () => {
      if (table === "maintenance_requests") {
        return { data: state.ticket, error: null }
      }
      if (table === "vendors") {
        return {
          data: { name: state.vendor.name, phone: state.vendor.phone },
          error: null,
        }
      }
      if (table === "sms_conversations") {
        // resolveVendorJobConversationId / persistVendorScheduleFsm
        return {
          data: {
            id: state.conversation.id,
            intake_state: state.conversation.intake_state,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.insert = (row: Record<string, unknown>) => {
      pendingInsert = Array.isArray(row) ? row[0] as Record<string, unknown> : row
      return chain()
    }
    api.single = async () => {
      pendingInsert = null
      return { data: { id: "evt-1" }, error: null }
    }
    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (pendingUpdate && table === "maintenance_requests") {
          Object.assign(state.ticket, pendingUpdate)
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingUpdate && table === "sms_conversations") {
          Object.assign(state.conversation, pendingUpdate)
          if (pendingUpdate.intake_state) {
            state.conversation.intake_state = pendingUpdate.intake_state as Record<
              string,
              unknown
            >
          }
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        // Graph / activity log inserts — ignore
        pendingInsert = null
        resolve({ data: null, error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }
  return { from } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test("beginTenantInitiatedReschedule clears confirmation and moves FSM to awaiting_availability", async () => {
  const state: State = {
    ticket: {
      id: TICKET_ID,
      landlord_id: LANDLORD_ID,
      unit: "1",
      building: "14 Maple",
      assigned_vendor_id: VENDOR_ID,
      scheduled_at: "2026-09-25T18:00:00.000Z",
      scheduled_window_text: "Thu 2–4pm",
      schedule_confirmed_at: "2026-09-22T12:00:00.000Z",
      vendor_work_status: "accepted",
      issue_category: "plumbing",
    },
    // No phone → skip Twilio; resolveVendorJobConversationId still finds the thread.
    vendor: { id: VENDOR_ID, name: "Flex Plumbing", phone: null },
    conversation: {
      id: CONV_ID,
      landlord_id: LANDLORD_ID,
      vendor_id: VENDOR_ID,
      maintenance_request_id: TICKET_ID,
      conversation_type: "vendor_alert",
      intake_state: {},
    },
  }
  const supabase = mockSupabase(state)
  const result = await beginTenantInitiatedReschedule(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    conversationId: "resident-conv",
    residentMessage: "I can't make Thursday anymore",
  })

  assertEquals(result.ok, true)
  assertEquals(state.ticket.schedule_confirmed_at, null)
  assertEquals(state.ticket.reschedule_requested_by, "resident")
  assertEquals(state.ticket.schedule_status, "resident_requested_reschedule")
  assertEquals(result.previousTimeLabel != null, true)

  const fsm = state.conversation.intake_state[VENDOR_SCHEDULE_KEY] as
    | { step?: string; ticketId?: string }
    | undefined
  assertEquals(fsm?.step, "awaiting_availability")
  assertEquals(fsm?.ticketId, TICKET_ID)

  // Vendor-facing SMS copy (what would be sent when a phone is present).
  const body = buildVendorTenantInitiatedRescheduleSms({
    workOrderRef: "WO-CCCC",
    previousTimeLabel: result.previousTimeLabel ?? "Thu 2–4pm",
  })
  assertMatch(body, /can no longer make/)
  assertMatch(body, /new day and arrival window/)
})
