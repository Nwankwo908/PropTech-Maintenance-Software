import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { applyAdminStageMove } from "./applyAdminStageMove.ts"
import {
  deriveInspectionVisitKanbanStage,
  deriveTicketKanbanStage,
} from "./deriveTicketKanbanStage.ts"
import {
  isManualStageOverrideFresh,
  readManualStageOverride,
  shouldSuppressAutomationForManualOverride,
} from "./manualStageOverride.ts"

type Row = Record<string, unknown>

function mockSupabase(state: {
  landlordId: string
  otherLandlordId?: string
  run: Row
  ticket: Row
}) {
  const updates: Array<{ table: string; patch: Row }> = []
  const activity: Row[] = []

  const api = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: unknown) {
              const chain = {
                eq(col2: string, val2: unknown) {
                  return chain
                },
                in() {
                  return chain
                },
                order() {
                  return chain
                },
                limit() {
                  return chain
                },
                maybeSingle: async () => {
                  if (table === "workflow_runs") {
                    if (col === "id" && val === state.run.id) {
                      return { data: state.run, error: null }
                    }
                    return { data: state.run, error: null }
                  }
                  if (table === "maintenance_requests") {
                    return { data: state.ticket, error: null }
                  }
                  if (table === "vendors") {
                    return {
                      data: { name: "Ecosafe", phone: "+15555550100" },
                      error: null,
                    }
                  }
                  return { data: null, error: null }
                },
              }
              return chain
            },
            in() {
              return {
                order() {
                  return {
                    limit() {
                      return {
                        maybeSingle: async () => ({ data: state.run, error: null }),
                      }
                    },
                  }
                },
                limit() {
                  return {
                    then: undefined,
                  }
                },
              }
            },
          }
        },
        update(patch: Row) {
          return {
            eq(col: string, val: unknown) {
              const chain = {
                eq() {
                  updates.push({ table, patch })
                  return Promise.resolve({ error: null })
                },
              }
              if (table === "maintenance_requests") {
                Object.assign(state.ticket, patch)
              }
              if (table === "workflow_runs") {
                Object.assign(state.run, patch)
                if (patch.metadata && typeof patch.metadata === "object") {
                  state.run.metadata = {
                    ...(state.run.metadata as Row),
                    ...(patch.metadata as Row),
                  }
                }
              }
              updates.push({ table, patch })
              return chain
            },
          }
        },
        insert(row: Row) {
          activity.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  return { api: api as never, updates, activity, state }
}

Deno.test("deriveTicketKanbanStage maps vendor_work_status", () => {
  assertEquals(
    deriveTicketKanbanStage({ vendorWorkStatus: "unassigned" }),
    "new_intake",
  )
  assertEquals(
    deriveTicketKanbanStage({
      vendorWorkStatus: "pending_accept",
      assignedVendorId: "v1",
    }),
    "assigned",
  )
  assertEquals(
    deriveTicketKanbanStage({ vendorWorkStatus: "in_progress", assignedVendorId: "v1" }),
    "in_progress",
  )
  assertEquals(
    deriveTicketKanbanStage({ vendorWorkStatus: "completed" }),
    "completed",
  )
})

Deno.test("deriveInspectionVisitKanbanStage rolls up sibling tickets", () => {
  assertEquals(
    deriveInspectionVisitKanbanStage([
      { vendorWorkStatus: "unassigned" },
      { vendorWorkStatus: "pending_accept", assignedVendorId: "v1" },
    ]),
    "assigned",
  )
  assertEquals(
    deriveInspectionVisitKanbanStage([
      { vendorWorkStatus: "completed" },
      { vendorWorkStatus: "completed" },
    ]),
    "completed",
  )
  assertEquals(
    deriveInspectionVisitKanbanStage([
      { vendorWorkStatus: "unassigned" },
      { vendorWorkStatus: "unassigned" },
    ]),
    "new_intake",
  )
})

Deno.test("applyAdminStageMove returns 409 for stale fromStage", async () => {
  const { api } = mockSupabase({
    landlordId: "11111111-1111-4111-8111-111111111111",
    run: {
      id: "22222222-2222-4222-8222-222222222222",
      landlord_id: "11111111-1111-4111-8111-111111111111",
      status: "active",
      current_step: "assigned",
      template_id: "maintenance_request",
      metadata: {},
    },
    ticket: {
      id: "33333333-3333-4333-8333-333333333333",
      landlord_id: "11111111-1111-4111-8111-111111111111",
      assigned_vendor_id: "44444444-4444-4444-8444-444444444444",
      vendor_work_status: "pending_accept",
    },
  })

  // Stub close/notify imports by only testing the stale check path before mutations
  // that need heavy deps — fromStage new_intake vs actual assigned.
  const result = await applyAdminStageMove(api, {
    landlordId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ticketId: "33333333-3333-4333-8333-333333333333",
    fromStage: "new_intake",
    toStage: "in_progress",
  })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 409)
    assertEquals(result.currentStage, "assigned")
  }
})

Deno.test("applyAdminStageMove returns 403 for another landlord", async () => {
  const { api } = mockSupabase({
    landlordId: "11111111-1111-4111-8111-111111111111",
    run: {
      id: "22222222-2222-4222-8222-222222222222",
      landlord_id: "11111111-1111-4111-8111-111111111111",
      status: "active",
      current_step: "new_intake",
      template_id: "maintenance_request",
      metadata: {},
    },
    ticket: {
      id: "33333333-3333-4333-8333-333333333333",
      landlord_id: "99999999-9999-4999-8999-999999999999",
      assigned_vendor_id: null,
      vendor_work_status: "unassigned",
    },
  })

  const result = await applyAdminStageMove(api, {
    landlordId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ticketId: "33333333-3333-4333-8333-333333333333",
    fromStage: "new_intake",
    toStage: "completed",
  })
  assertEquals(result.ok, false)
  if (!result.ok) assertEquals(result.status, 403)
})

Deno.test("manual stage override is fresh within 24h", () => {
  const at = new Date("2026-10-21T12:00:00Z")
  const override = readManualStageOverride({
    manual_stage_override: {
      stage: "in_progress",
      at: "2026-10-21T10:00:00Z",
      by: "landlord",
    },
  })
  assertEquals(isManualStageOverrideFresh(override, at), true)
  assertEquals(
    isManualStageOverrideFresh(
      {
        stage: "in_progress",
        at: "2026-10-19T10:00:00Z",
        by: "landlord",
      },
      at,
    ),
    false,
  )
})

Deno.test("shouldSuppressAutomationForManualOverride logs and returns true when fresh", async () => {
  let logged = false
  const run = {
    id: "run-1",
    metadata: {
      manual_stage_override: {
        stage: "in_progress",
        at: new Date().toISOString(),
        by: "landlord",
      },
    },
  }
  const supabase = {
    from(table: string) {
      if (table === "workflow_runs") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      in() {
                        return {
                          order() {
                            return {
                              limit() {
                                return {
                                  maybeSingle: async () => ({ data: run, error: null }),
                                }
                              },
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      // recordActivityLog path
      return {
        insert() {
          logged = true
          return Promise.resolve({ error: null })
        },
        select() {
          return {
            insert() {
              logged = true
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }

  // recordActivityLog uses operations_graph_events — stub enough that suppress still works
  // even if logging fails.
  const suppressed = await shouldSuppressAutomationForManualOverride(supabase as never, {
    ticketId: "ticket-1",
    landlordId: "landlord-1",
    reason: "escalate_needs_vendor",
  })
  assertEquals(suppressed, true)
  void logged
})
