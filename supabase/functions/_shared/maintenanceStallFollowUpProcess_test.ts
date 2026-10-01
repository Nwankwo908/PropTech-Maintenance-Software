/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { NO_VENDOR_RESPONSE_FOLLOW_UP_MS } from "../../../shared/ops/maintenanceStallFollowUp.ts"
import { processMaintenanceStallFollowUps } from "./maintenanceStallFollowUpProcess.ts"

const NOW = Date.parse("2026-09-30T16:00:00.000Z")
const HOUR = 60 * 60 * 1000

type TicketRow = Record<string, unknown>

function buildStalledTicket(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: "maint-1",
    landlord_id: "ll-1",
    vendor_work_status: "pending_accept",
    assigned_vendor_id: "v-1",
    assigned_at: new Date(NOW - NO_VENDOR_RESPONSE_FOLLOW_UP_MS - HOUR).toISOString(),
    scheduled_at: null,
    schedule_confirmed_at: null,
    updated_at: new Date(NOW - HOUR).toISOString(),
    created_at: new Date(NOW - 3 * HOUR).toISOString(),
    inspection_report_id: null,
    description: "Kitchen sink dripping",
    issue_headline: "Kitchen sink dripping",
    auto_reassign_last_outcome: null,
    awaiting_landlord_choice_at: null,
    awaiting_vendor_availability_at: null,
    vendor_notify_error: null,
    stall_follow_up_sent_at: null,
    stall_follow_up_kind: null,
    stall_follow_up_episode_key: null,
    resident_id: "res-1",
    resident_name: "Alex Resident",
    resident_phone: "+15551234567",
    unit: "1",
    property_id: "prop-1",
    unit_id: null,
    ...over,
  }
}

function mockSupabase(state: {
  tickets: TicketRow[]
  workflowRuns: Array<Record<string, unknown>>
  updates: Array<{ table: string; patch: Record<string, unknown>; ids?: string[] }>
}) {
  const from = (table: string) => {
    const filters: Array<{ kind: string; col: string; val: unknown }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ kind: "eq", col, val })
      return chain()
    }
    api.in = (col: string, val: unknown) => {
      filters.push({ kind: "in", col, val })
      return chain()
    }
    api.not = () => chain()
    api.order = () => chain()
    api.limit = () => chain()
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.maybeSingle = async () => {
      if (table === "vendors") {
        return {
          data: { id: "v-1", name: "Mike Plumb", phone: "+15559876543" },
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (pendingUpdate) {
          const idFilter = filters.find((f) => f.kind === "eq" && f.col === "id")
          const inFilter = filters.find((f) => f.kind === "in" && f.col === "id")
          const ids = idFilter
            ? [String(idFilter.val)]
            : Array.isArray(inFilter?.val)
            ? (inFilter!.val as string[])
            : []
          state.updates.push({ table, patch: pendingUpdate, ids })
          for (const id of ids) {
            const row = state.tickets.find((t) => t.id === id)
            if (row) Object.assign(row, pendingUpdate)
          }
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }

        if (table === "maintenance_requests") {
          resolve({ data: state.tickets, error: null })
          return
        }
        if (table === "workflow_runs") {
          const entityType = filters.find(
            (f) => f.kind === "eq" && f.col === "entity_type",
          )
          let rows = state.workflowRuns
          if (entityType) {
            rows = rows.filter((r) => r.entity_type === entityType.val)
          }
          resolve({ data: rows, error: null })
          return
        }
        if (table === "sms_conversations") {
          resolve({ data: [], error: null })
          return
        }
        resolve({ data: [], error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }

  return {
    from,
  } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test("stall follow-up: one message per episode (dry-run), not every cron cycle", async () => {
  const state = {
    tickets: [buildStalledTicket()],
    workflowRuns: [
      {
        entity_type: "maintenance_request",
        entity_id: "maint-1",
        template_id: "maintenance_request",
        metadata: {},
      },
    ],
    updates: [] as Array<{
      table: string
      patch: Record<string, unknown>
      ids?: string[]
    }>,
  }
  const supabase = mockSupabase(state)

  const first = await processMaintenanceStallFollowUps(supabase, {
    nowMs: NOW,
    dryRun: true,
  })
  assertEquals(first.followUpsSent, 1)
  assertEquals(first.wouldSend?.length, 1)
  assertEquals(first.wouldSend?.[0]?.audience, "vendor")

  const { classifyMaintenanceStallFollowUp } = await import(
    "../../../shared/ops/maintenanceStallFollowUp.ts"
  )
  const classified = classifyMaintenanceStallFollowUp(
    {
      id: "maint-1",
      landlordId: "ll-1",
      vendorWorkStatus: "pending_accept",
      assignedVendorId: "v-1",
      assignedAt: state.tickets[0]!.assigned_at as string,
      scheduledAt: null,
      scheduleConfirmedAt: null,
      updatedAt: state.tickets[0]!.updated_at as string,
      createdAt: state.tickets[0]!.created_at as string,
      inspectionReportId: null,
      description: "Kitchen sink dripping",
      issueHeadline: "Kitchen sink dripping",
      autoReassignLastOutcome: null,
      awaitingLandlordChoiceAt: null,
      awaitingVendorAvailabilityAt: null,
      vendorNotifyError: null,
      stallFollowUpSentAt: null,
      stallFollowUpKind: null,
      stallFollowUpEpisodeKey: null,
      linkedWorkflowTemplateIds: ["maintenance_request"],
    },
    NOW,
  )
  assertEquals(classified.action, "follow_up")
  if (classified.action !== "follow_up") return

  // Simulate stamp from a live send, then re-run — must not follow up again.
  state.tickets[0]!.stall_follow_up_sent_at = new Date(NOW - 10 * 60 * 1000)
    .toISOString()
  state.tickets[0]!.stall_follow_up_kind = classified.kind
  state.tickets[0]!.stall_follow_up_episode_key = classified.episodeKey

  const second = await processMaintenanceStallFollowUps(supabase, {
    nowMs: NOW,
    dryRun: true,
  })
  assertEquals(second.followUpsSent, 0)
  assertEquals(second.skipped >= 1, true)
})

Deno.test("stall follow-up: needs_admin_vendor sticky tickets are skipped", async () => {
  const state = {
    tickets: [
      buildStalledTicket({
        auto_reassign_last_outcome: "needs_admin_vendor|pending_accept_stale",
      }),
    ],
    workflowRuns: [
      {
        entity_type: "maintenance_request",
        entity_id: "maint-1",
        template_id: "maintenance_request",
        metadata: {},
      },
    ],
    updates: [],
  }
  const summary = await processMaintenanceStallFollowUps(mockSupabase(state), {
    nowMs: NOW,
    dryRun: true,
  })
  assertEquals(summary.followUpsSent, 0)
  assertEquals(summary.skipped, 1)
})

Deno.test("stall follow-up: inspection group gets one follow-up for 5 siblings", async () => {
  const report = "8ac8ee35-9f78-44ec-85a8-97b90442e54c"
  const tickets = [1, 2, 3, 4, 5].map((n) =>
    buildStalledTicket({
      id: `t-${n}`,
      inspection_report_id: report,
      issue_headline: `Item ${n}`,
    }),
  )
  const state = {
    tickets,
    workflowRuns: tickets.map((t) => ({
      entity_type: "maintenance_request",
      entity_id: t.id,
      template_id: "maintenance_request",
      metadata: {},
    })),
    updates: [],
  }
  const summary = await processMaintenanceStallFollowUps(mockSupabase(state), {
    nowMs: NOW,
    dryRun: true,
  })
  assertEquals(summary.followUpsSent, 1)
  assertEquals(summary.wouldSend?.length, 1)
  assertEquals(summary.wouldSend?.[0]?.ticketIds.length, 5)
  const body = summary.wouldSend?.[0]?.body ?? ""
  assertEquals(/5 open (items|jobs)/.test(body), true)
  assertEquals(body.includes("Item 1"), true)
  assertEquals(body.includes("Item 5"), true)
})

Deno.test("stall follow-up: rent_collection-linked ticket never triggers; maintenance does", async () => {
  const state = {
    tickets: [
      buildStalledTicket({
        id: "rent-linked",
        description: "Overdue rent follow-up should not be here",
      }),
      buildStalledTicket({ id: "maint-ok" }),
    ],
    workflowRuns: [
      {
        entity_type: "maintenance_request",
        entity_id: "rent-linked",
        template_id: "rent_collection",
        metadata: { maintenance_request_id: "rent-linked" },
      },
      {
        entity_type: "sms_conversation",
        entity_id: "convo-rent",
        template_id: "rent_collection",
        metadata: {},
      },
      {
        entity_type: "maintenance_request",
        entity_id: "maint-ok",
        template_id: "maintenance_request",
        metadata: {},
      },
    ],
    updates: [],
  }
  const summary = await processMaintenanceStallFollowUps(mockSupabase(state), {
    nowMs: NOW,
    dryRun: true,
  })
  assertEquals(summary.followUpsSent, 1)
  assertEquals(summary.wouldSend?.[0]?.ticketIds, ["maint-ok"])
  // rent_collection run rows are never written by this processor
  assertEquals(
    state.updates.every((u) => u.table !== "workflow_runs"),
    true,
  )
})
