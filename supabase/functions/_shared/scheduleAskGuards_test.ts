/// <reference lib="deno.ns" />
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  ASK_CLOSING_WORK_STATUSES,
  closeOpenAsksForTicket,
  findZombieScheduleAsks,
  findZombieVendorAvailabilityAsks,
  reconcileZombieScheduleAsks,
  reconcileZombieVendorAvailabilityAsks,
} from "./closeOpenAsksForTicket.ts"

const AWAITING_VENDOR_AVAILABILITY_PROBE =
  "Awaiting vendor availability before landlord choice"
import {
  decideShouldSendAutomatedMessage,
  isReferencedWindowTextPast,
  isWithinResidentQuietHours,
} from "./shouldSendAutomatedMessage.ts"
import { processScheduleFsmTtlChecks } from "./scheduleFsmTtl.ts"
import {
  createIdleScheduleState,
  VENDOR_SCHEDULE_KEY,
  withVendorScheduleFsm,
} from "./vendor_schedule_fsm.ts"
import { AWAITING_SCHEDULE_CONFIRM_KEY } from "./sms/tenantScheduleConfirm.ts"
import {
  buildVendorScheduleAlreadyAdvancedSms,
  ticketStatusBlocksScheduleAsks,
} from "./scheduleAskGuards.ts"
import {
  buildScheduleAnchor,
  resolveVendorAvailability,
  zonedParts,
} from "./vendor_availability_parse.ts"

type Convo = {
  id: string
  landlord_id: string
  vendor_id: string | null
  maintenance_request_id: string | null
  intake_state: Record<string, unknown>
  conversation_type: string
  updated_at: string
}

type Ticket = {
  id: string
  landlord_id: string
  vendor_work_status: string
  vendor_notify_error?: string | null
  assigned_vendor_id?: string | null
  awaiting_vendor_availability_at?: string | null
}

function mockSupabase(state: {
  convos: Convo[]
  tickets: Ticket[]
  activity?: Array<Record<string, unknown>>
}) {
  const from = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = []
    const inFilters: Array<{ col: string; vals: unknown[] }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    let orFilter: string | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val })
      return chain()
    }
    api.in = (col: string, vals: unknown[]) => {
      inFilters.push({ col, vals })
      return chain()
    }
    api.not = (col: string, op: string, _val?: unknown) => {
      if (op === "is") filters.push({ col, val: { __not_null: true } })
      return chain()
    }
    api.or = (expr: string) => {
      orFilter = expr
      return chain()
    }
    api.order = () => chain()
    api.limit = () => chain()
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.insert = (row: unknown) => {
      if (table === "operations_graph_events" || table.includes("graph")) {
        state.activity = state.activity ?? []
        state.activity.push(row as Record<string, unknown>)
      }
      return chain()
    }
    api.maybeSingle = async () => {
      if (table === "maintenance_requests") {
        if (pendingUpdate) {
          const id = String(filters.find((f) => f.col === "id")?.val ?? "")
          const row = state.tickets.find((t) => t.id === id)
          if (row) Object.assign(row, pendingUpdate)
          const applied = pendingUpdate
          pendingUpdate = null
          return { data: row ? { ...row, ...applied } : null, error: null }
        }
        const id = String(filters.find((f) => f.col === "id")?.val ?? "")
        const row = state.tickets.find((t) => t.id === id)
        return { data: row ?? null, error: null }
      }
      if (table === "vendors") {
        return { data: { phone: "+15551234567" }, error: null }
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
          if (row && pendingUpdate.intake_state) {
            row.intake_state = pendingUpdate.intake_state as Record<
              string,
              unknown
            >
          }
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingUpdate && table === "maintenance_requests") {
          const id = String(filters.find((f) => f.col === "id")?.val ?? "")
          const row = state.tickets.find((t) => t.id === id)
          if (row) Object.assign(row, pendingUpdate)
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (table === "maintenance_requests") {
          let rows = [...state.tickets]
          for (const f of filters) {
            if (
              f.val &&
              typeof f.val === "object" &&
              (f.val as { __not_null?: boolean }).__not_null
            ) {
              rows = rows.filter((t) => {
                const v = (t as Record<string, unknown>)[f.col]
                return v != null && v !== ""
              })
              continue
            }
            if (f.col === "id") {
              rows = rows.filter((t) => t.id === f.val)
            }
          }
          resolve({ data: rows, error: null })
          return
        }
        if (table === "sms_conversations") {
          let rows = [...state.convos]
          const typeEq = filters.find((f) => f.col === "conversation_type")
          if (typeEq) {
            rows = rows.filter((c) => c.conversation_type === typeEq.val)
          }
          const typeIn = inFilters.find((f) => f.col === "conversation_type")
          if (typeIn) {
            rows = rows.filter((c) =>
              typeIn.vals.includes(c.conversation_type)
            )
          }
          if (orFilter?.includes("maintenance_request_id.eq.")) {
            const tid = orFilter.split("eq.")[1]
            rows = rows.filter((c) =>
              c.maintenance_request_id === tid ||
              (c.intake_state[VENDOR_SCHEDULE_KEY] as { ticketId?: string })
                ?.ticketId === tid ||
              (c.intake_state[AWAITING_SCHEDULE_CONFIRM_KEY] as {
                ticket_id?: string
              })?.ticket_id === tid
            )
          }
          resolve({ data: rows, error: null })
          return
        }
        if (table === "sms_messages") {
          resolve({ data: [], count: 0, error: null })
          return
        }
        resolve({ data: null, error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }
  return { from } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test("ticketStatusBlocksScheduleAsks covers in_progress/completed/cancelled/archived", () => {
  for (const s of ASK_CLOSING_WORK_STATUSES) {
    assertEquals(ticketStatusBlocksScheduleAsks(s), true)
  }
  assertEquals(ticketStatusBlocksScheduleAsks("accepted"), false)
  assertEquals(ticketStatusBlocksScheduleAsks("pending_accept"), false)
})

Deno.test("buildVendorScheduleAlreadyAdvancedSms for in_progress", () => {
  const body = buildVendorScheduleAlreadyAdvancedSms({
    workOrderRef: "WO-E6F7",
    vendorWorkStatus: "in_progress",
  })
  assert(body.includes("WO-E6F7"))
  assert(body.includes("in progress"))
  assert(body.includes("no schedule"))
})

Deno.test("closeOpenAsksForTicket closes vendor FSM + resident awaiting on in_progress", async () => {
  const ticketId = "e6f7d660-f024-4614-a84c-3a8ee5d84d2c"
  const fsm = withVendorScheduleFsm({}, {
    ...createIdleScheduleState(ticketId),
    step: "awaiting_tenant_confirmation",
    pendingWindowText: "Friday, Sep 18 at 4:30 PM",
    pendingScheduledAt: "2026-09-18T20:30:00.000Z",
    revision: 3,
    expiresAt: "2026-09-19T00:00:00.000Z",
  })
  const state = {
    tickets: [{
      id: ticketId,
      landlord_id: "ll-1",
      vendor_work_status: "in_progress",
    }],
    convos: [
      {
        id: "vendor-convo",
        landlord_id: "ll-1",
        vendor_id: "v-1",
        maintenance_request_id: ticketId,
        conversation_type: "vendor_alert",
        updated_at: new Date().toISOString(),
        intake_state: { ...fsm },
      },
      {
        id: "resident-convo",
        landlord_id: "ll-1",
        vendor_id: null,
        maintenance_request_id: ticketId,
        conversation_type: "resident_intake",
        updated_at: new Date().toISOString(),
        intake_state: {
          [AWAITING_SCHEDULE_CONFIRM_KEY]: {
            ticket_id: ticketId,
            window_text: "Friday, Sep 18 at 4:30 PM",
            scheduled_at: "2026-09-18T20:30:00.000Z",
          },
        },
      },
    ],
  }
  const supabase = mockSupabase(state)
  const result = await closeOpenAsksForTicket(
    supabase,
    ticketId,
    "vendor_work_status → in_progress (test)",
  )
  assert(result.closed.length >= 2)
  const vendorFsm = state.convos[0]!.intake_state[VENDOR_SCHEDULE_KEY] as {
    step?: string
  }
  assertEquals(vendorFsm?.step, "idle")
  assertEquals(
    state.convos[1]!.intake_state[AWAITING_SCHEDULE_CONFIRM_KEY],
    undefined,
  )
})

Deno.test("E6F7 replay: TTL on in_progress + past window quietly closes, no SMS", async () => {
  const ticketId = "e6f7d660-f024-4614-a84c-3a8ee5d84d2c"
  const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  const fsm = withVendorScheduleFsm({}, {
    ...createIdleScheduleState(ticketId),
    step: "awaiting_tenant_confirmation",
    pendingWindowText: "Friday, Sep 18 at 4:30 PM",
    pendingScheduledAt: "2026-09-18T20:30:00.000Z",
    revision: 4,
    expiresAt: past,
    enteredAt: past,
  })
  const state = {
    tickets: [{
      id: ticketId,
      landlord_id: "ll-1",
      vendor_work_status: "in_progress",
    }],
    convos: [{
      id: "vendor-convo",
      landlord_id: "ll-1",
      vendor_id: "v-1",
      maintenance_request_id: ticketId,
      conversation_type: "vendor_alert",
      updated_at: new Date().toISOString(),
      intake_state: { ...fsm },
    }],
  }
  const summary = await processScheduleFsmTtlChecks(mockSupabase(state), {
    now: new Date("2026-09-28T00:00:00.000Z"),
  })
  assertEquals(summary.notified, 0)
  assert(summary.quietExpired >= 1)
  const vendorFsm = state.convos[0]!.intake_state[VENDOR_SCHEDULE_KEY] as {
    step?: string
  }
  assertEquals(vendorFsm?.step, "idle")
})

Deno.test("reconciliation sweep closes B347-style zombie and is idempotent", async () => {
  const ticketId = "b34764d2-aebb-4efb-9dd7-3e45596bbab2"
  const fsm = withVendorScheduleFsm({}, {
    ...createIdleScheduleState(ticketId),
    step: "awaiting_availability",
    revision: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  })
  const state = {
    tickets: [{
      id: ticketId,
      landlord_id: "ll-1",
      vendor_work_status: "completed",
    }],
    convos: [{
      id: "vendor-convo-b347",
      landlord_id: "ll-1",
      vendor_id: "v-2",
      maintenance_request_id: ticketId,
      conversation_type: "vendor_alert",
      updated_at: new Date().toISOString(),
      intake_state: { ...fsm },
    }],
  }
  const supabase = mockSupabase(state)
  const zombies = await findZombieScheduleAsks(supabase, { limit: 10 })
  assert(zombies.some((z) => z.ticketId === ticketId))

  const first = await reconcileZombieScheduleAsks(supabase, { limit: 10 })
  assertEquals(first.closed, 1)
  assertEquals(
    (state.convos[0]!.intake_state[VENDOR_SCHEDULE_KEY] as { step: string }).step,
    "idle",
  )

  const second = await reconcileZombieScheduleAsks(supabase, { limit: 10 })
  assertEquals(second.closed, 0)
})

Deno.test("availability-probe sweep clears flag only on assigned stale tickets", async () => {
  const staleIds = [
    "c2ffb48d-5e86-48ef-97be-adf496c83fb3",
    "5e0a2017-0b4a-4016-9e1a-c0a8cbffadc3",
  ]
  const liveProbeOnly = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  const state = {
    tickets: [
      {
        id: staleIds[0]!,
        landlord_id: "ll-1",
        vendor_work_status: "pending_accept",
        assigned_vendor_id: "vendor-michael",
        awaiting_vendor_availability_at: "2026-09-28T00:38:43.749Z",
        vendor_notify_error: null,
      },
      {
        id: staleIds[1]!,
        landlord_id: "ll-1",
        vendor_work_status: "pending_accept",
        assigned_vendor_id: "vendor-michael",
        awaiting_vendor_availability_at: "2026-09-29T13:21:43.000Z",
        vendor_notify_error: AWAITING_VENDOR_AVAILABILITY_PROBE,
      },
      {
        id: liveProbeOnly,
        landlord_id: "ll-1",
        vendor_work_status: "unassigned",
        assigned_vendor_id: null,
        awaiting_vendor_availability_at: "2026-09-30T12:00:00.000Z",
        vendor_notify_error: AWAITING_VENDOR_AVAILABILITY_PROBE,
      },
    ],
    convos: [] as Convo[],
  }
  const supabase = mockSupabase(state)

  const zombies = await findZombieVendorAvailabilityAsks(supabase, { limit: 20 })
  assertEquals(zombies.length, 2)
  assert(zombies.every((z) => staleIds.includes(z.ticketId)))

  const beforeStatuses = state.tickets.map((t) => ({
    id: t.id,
    status: t.vendor_work_status,
    assigned: t.assigned_vendor_id,
  }))

  const first = await reconcileZombieVendorAvailabilityAsks(supabase, {
    limit: 20,
  })
  assertEquals(first.closed, 2)
  for (const id of staleIds) {
    const row = state.tickets.find((t) => t.id === id)!
    assertEquals(row.awaiting_vendor_availability_at, null)
    assertEquals(row.vendor_notify_error, null)
  }
  // Live unassigned probe untouched
  const live = state.tickets.find((t) => t.id === liveProbeOnly)!
  assertEquals(live.awaiting_vendor_availability_at, "2026-09-30T12:00:00.000Z")
  assertEquals(live.vendor_notify_error, AWAITING_VENDOR_AVAILABILITY_PROBE)

  // Flag cleanup only — status / assignment unchanged
  assertEquals(
    state.tickets.map((t) => ({
      id: t.id,
      status: t.vendor_work_status,
      assigned: t.assigned_vendor_id,
    })),
    beforeStatuses,
  )

  const second = await reconcileZombieVendorAvailabilityAsks(supabase, {
    limit: 20,
  })
  assertEquals(second.closed, 0)
})

Deno.test("closeOpenAsksForTicket clears awaiting_vendor_availability_at when assigned", async () => {
  const ticketId = "new-assign-0001-0000-0000-000000000001"
  const state = {
    tickets: [{
      id: ticketId,
      landlord_id: "ll-1",
      vendor_work_status: "pending_accept",
      assigned_vendor_id: "vendor-1",
      awaiting_vendor_availability_at: "2026-09-30T15:00:00.000Z",
      vendor_notify_error: AWAITING_VENDOR_AVAILABILITY_PROBE,
    }],
    convos: [] as Convo[],
  }
  const result = await closeOpenAsksForTicket(
    mockSupabase(state),
    ticketId,
    "assigned_vendor_id set (test)",
  )
  assert(result.closed.includes("awaiting_vendor_availability"))
  assertEquals(state.tickets[0]!.awaiting_vendor_availability_at, null)
  assertEquals(state.tickets[0]!.vendor_notify_error, null)
  assertEquals(state.tickets[0]!.vendor_work_status, "pending_accept")
  assertEquals(state.tickets[0]!.assigned_vendor_id, "vendor-1")
})

Deno.test("shouldSendAutomatedMessage suppresses advanced ticket + past window + cooldown", () => {
  assertEquals(
    decideShouldSendAutomatedMessage({
      messageType: "schedule_fsm_ttl_tenant_confirm",
      audience: "vendor",
      currentVendorWorkStatus: "in_progress",
    }).action,
    "suppress",
  )
  assertEquals(
    decideShouldSendAutomatedMessage({
      messageType: "schedule_fsm_ttl_tenant_confirm",
      audience: "vendor",
      currentVendorWorkStatus: "accepted",
      referencedWindowText: "Friday, Sep 18 at 4:30 PM",
      nowMs: Date.parse("2026-09-28T00:00:00.000Z"),
    }).action,
    "suppress",
  )
  assertEquals(
    decideShouldSendAutomatedMessage({
      messageType: "schedule_fsm_ttl_availability",
      audience: "vendor",
      currentVendorWorkStatus: "accepted",
      recentAutomatedToRecipient: 1,
    }).action,
    "suppress",
  )
})

Deno.test("resident quiet hours 9pm–8am local", () => {
  // 2026-09-27 02:00 UTC = 2026-09-26 22:00 America/New_York (EDT)
  assertEquals(
    isWithinResidentQuietHours(
      Date.parse("2026-09-27T02:00:00.000Z"),
      "America/New_York",
    ),
    true,
  )
  // 2026-09-27 14:00 UTC = 10:00 AM EDT
  assertEquals(
    isWithinResidentQuietHours(
      Date.parse("2026-09-27T14:00:00.000Z"),
      "America/New_York",
    ),
    false,
  )
})

Deno.test("isReferencedWindowTextPast detects Sep 18 after the fact", () => {
  assertEquals(
    isReferencedWindowTextPast(
      "Friday, Sep 18 at 4:30 PM",
      Date.parse("2026-09-28T00:00:00.000Z"),
      "America/New_York",
    ),
    true,
  )
})

Deno.test("tomorrow 4:30pm at 11:07 PM local resolves to next local calendar day", async () => {
  const TZ = "America/New_York"
  // Wed Sep 16 2026 23:07 EDT = Thu Sep 17 03:07 UTC
  const now = new Date("2026-09-17T03:07:00.000Z")
  const local = zonedParts(now, TZ)
  assertEquals(local.weekday.toLowerCase(), "wednesday")
  assertEquals(local.day, 16)

  const anchor = buildScheduleAnchor(now, TZ)
  assert(anchor.todayLabel.toLowerCase().includes("wednesday"))

  const result = await resolveVendorAvailability("tomorrow afternoon 4:30 pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status === "resolved" || result.status === "needs_confirmation", true)
  if (result.status === "needs_clarification") {
    throw new Error("expected resolved window")
  }
  const start = zonedParts(new Date(result.value.scheduledAt), TZ)
  assertEquals(start.day, 17) // Thursday local — not Friday 18
  assertEquals(start.weekday.toLowerCase(), "thursday")
  assertEquals(start.hour, 16)
  assertEquals(start.minute, 30)
})
