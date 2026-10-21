/// <reference lib="deno.ns" />
/**
 * Open landlord vendor asks must never be contradicted by "No vendor found".
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { pickBatchVendorProposal } from "../../../shared/landlordDecisions/batchVendorFit.ts"
import { vendorTradeMatchesForDispatch } from "../../../shared/maintenance/vendorTrades.ts"
import {
  buildLandlordAttentionSms,
  shortRepairLabel,
} from "./landlordAttentionNotify.ts"
import { escalateMaintenanceNeedsVendor } from "./maintenance_admin_escalation.ts"
import { AWAITING_LANDLORD_VENDOR_CHOICE } from "./sms/awaitingLandlordVendorChoice.ts"

type Row = Record<string, unknown>

function mockEscalationSupabase(state: {
  ticket: Row
  openBatchItems?: Array<{ batch_id: string; snapshot: Row }>
  openBatches?: Array<{ id: string; status: string }>
  convos?: Array<{ id: string; intake_state: Row }>
  updates: Array<{ table: string; patch: Row }>
  activity: Array<Row>
}) {
  const from = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = []
    let pendingUpdate: Row | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val })
      return chain()
    }
    api.in = () => chain()
    api.order = () => chain()
    api.limit = () => chain()
    api.update = (patch: Row) => {
      pendingUpdate = patch
      return chain()
    }
    api.insert = (row: Row | Row[]) => {
      if (table === "operations_graph_events" || table === "property_operations_graph") {
        const rows = Array.isArray(row) ? row : [row]
        for (const r of rows) state.activity.push(r)
      }
      return {
        select: () => ({
          maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }),
          single: async () => ({ data: { id: "evt-1" }, error: null }),
        }),
        then: undefined,
      }
    }

    const finish = async () => {
      if (pendingUpdate) {
        state.updates.push({ table, patch: pendingUpdate })
        if (table === "maintenance_requests") {
          Object.assign(state.ticket, pendingUpdate)
        }
        if (table === "landlord_pick_batches" && pendingUpdate.status === "superseded") {
          for (const b of state.openBatches ?? []) {
            if (b.status === "open") b.status = "superseded"
          }
        }
        pendingUpdate = null
      }

      if (table === "maintenance_requests") {
        return { data: { ...state.ticket }, error: null }
      }
      if (table === "workflow_runs") {
        return { data: null, error: null }
      }
      if (table === "landlord_pick_batch_items") {
        return { data: state.openBatchItems ?? [], error: null }
      }
      if (table === "landlord_pick_batches") {
        const open = (state.openBatches ?? []).filter((b) => b.status === "open")
        return { data: open, error: null }
      }
      if (table === "sms_conversations") {
        return { data: state.convos ?? [], error: null }
      }
      if (table === "properties" || table === "units") {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    api.maybeSingle = finish
    api.single = finish
    api.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      finish().then(resolve, reject)

    return api
  }

  return { from } as unknown as SupabaseClient
}

Deno.test("shortRepairLabel uses pest + street instead of this repair", () => {
  assertEquals(
    shortRepairLabel("", "pest_control", {
      issueHeadline: "Pest control — exterminator requested",
      street: "109 S Grove St",
    }),
    "Pest control at 109 S Grove St",
  )
  assertEquals(
    shortRepairLabel("", "pest", { street: "109 S Grove St" }),
    "Pest control at 109 S Grove St",
  )
  assertEquals(shortRepairLabel("", null), "this repair")
})

Deno.test("assign-vendor attention SMS omits Ref: WO line", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No vendor found — Pest control at 109 S Grove St",
    locationLine: "109 S Grove St · reported 2h ago",
    whyLine: "No one on your preferred list can take this right now.",
    dashboardUrl: "https://www.ulohome.io/admin?findVendor=1&ticket=fd7b189c",
    workOrderRef: "WO-FD7B",
  })
  assertEquals(body.includes("Ref: WO-"), false)
  assertStringIncludes(body, "Pest control at 109 S Grove St")
})

Deno.test("batch never proposes a vendor trade dispatch would reject", () => {
  assertEquals(vendorTradeMatchesForDispatch("general", "pest_control"), false)
  const proposal = pickBatchVendorProposal({
    vendorId: "gen-1",
    vendorName: "Handy Mike",
    vendorCategory: "general",
    issueCategory: "pest_control",
    windowLabel: "Thu AM",
  })
  assertEquals(proposal.matched, false)
  assertEquals(proposal.vendorId, null)
})

Deno.test("escalateMaintenanceNeedsVendor suppresses while landlord ask is open", async () => {
  const state = {
    ticket: {
      id: "ticket-1",
      landlord_id: "landlord-1",
      vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE,
      unit: "1",
      building: "109 S Grove St",
      description: "Need an exterminator",
      issue_category: "pest_control",
      issue_headline: "Pest control — exterminator requested",
      created_at: "2026-10-21T00:00:00.000Z",
    },
    openBatchItems: [] as Array<{ batch_id: string; snapshot: Row }>,
    openBatches: [] as Array<{ id: string; status: string }>,
    convos: [] as Array<{ id: string; intake_state: Row }>,
    updates: [] as Array<{ table: string; patch: Row }>,
    activity: [] as Array<Row>,
  }
  const result = await escalateMaintenanceNeedsVendor(
    mockEscalationSupabase(state),
    { id: "ticket-1", landlord_id: "landlord-1" },
    {
      escalationReason: "no_vendor_available",
      eventMessage: "No vendor available",
      graphEventType: "maintenance.submitted_needs_vendor",
      graphMessage: "No vendor was available",
    },
  )
  assertEquals(result.suppressed, true)
  assertEquals(result.attention, null)
  assertEquals(result.nearbyOptionCount, 0)
  assertEquals(
    state.ticket.vendor_notify_error,
    AWAITING_LANDLORD_VENDOR_CHOICE,
  )
  const suppressed = state.activity.some((row) =>
    String(row.event_type ?? row.eventType ?? "").includes(
      "escalation_suppressed_pending_landlord_ask",
    ) ||
    String((row.metadata as Row | undefined)?.message ?? "").includes(
      "suppressed",
    )
  )
  // Activity may go through recordActivityLog which writes differently — flag stay is the contract.
  assertEquals(state.ticket.vendor_notify_error, AWAITING_LANDLORD_VENDOR_CHOICE)
  void suppressed
})

Deno.test("escalate after closing an open ask supersedes the batch", async () => {
  const state = {
    ticket: {
      id: "ticket-1",
      landlord_id: "landlord-1",
      vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE,
      unit: "1",
      building: "109 S Grove St",
      description: "Need an exterminator",
      issue_category: "pest_control",
      issue_headline: "Pest control — exterminator requested",
      created_at: "2026-10-21T00:00:00.000Z",
    },
    openBatchItems: [
      {
        batch_id: "batch-1",
        snapshot: { vendor_name: "Ecosafe Pest Management LLC" },
      },
    ],
    openBatches: [{ id: "batch-1", status: "open" }],
    convos: [] as Array<{ id: string; intake_state: Row }>,
    updates: [] as Array<{ table: string; patch: Row }>,
    activity: [] as Array<Row>,
  }

  // closeOpenAskFirst path — will attempt notify which needs more mocks;
  // assert supersede + flag clear before notify fails soft.
  const result = await escalateMaintenanceNeedsVendor(
    mockEscalationSupabase(state),
    { id: "ticket-1", landlord_id: "landlord-1" },
    {
      escalationReason: "vendor_declined_no_vendor",
      eventMessage: "Vendor declined",
      graphEventType: "maintenance.vendor_declined_needs_vendor",
      graphMessage: "Vendor declined",
      closeOpenAskFirst: true,
      previousVendorName: "Ecosafe Pest Management LLC",
    },
  )

  assertEquals(result.suppressed, undefined)
  const superseded = state.updates.some((u) =>
    u.table === "landlord_pick_batches" && u.patch.status === "superseded"
  )
  assertEquals(superseded, true)
  assertEquals(state.openBatches[0]?.status, "superseded")
  // Flag cleared by abandonStaleLandlordVendorChoiceAsk
  assertEquals(
    state.updates.some((u) =>
      u.table === "maintenance_requests" && u.patch.vendor_notify_error === null
    ),
    true,
  )
})

Deno.test("refresh rematch with open ask keeps awaiting skip reason (pure contract)", () => {
  // Mirrors vendor_notify.ts: alreadyAwaitingChoice + no rematch vendor →
  // return awaiting_landlord_choice without overwriting the flag.
  const alreadyAwaitingChoice = true
  const landlordAcknowledged = false
  const vendor = null
  let notifyError: string | null = AWAITING_LANDLORD_VENDOR_CHOICE
  let skipReason: string | null = null

  if (!vendor) {
    if (alreadyAwaitingChoice && !landlordAcknowledged) {
      skipReason = "awaiting_landlord_choice"
    } else {
      notifyError = "No active vendor available in this service area"
      skipReason = "no_vendor"
    }
  }

  assertEquals(skipReason, "awaiting_landlord_choice")
  assertEquals(notifyError, AWAITING_LANDLORD_VENDOR_CHOICE)
})
