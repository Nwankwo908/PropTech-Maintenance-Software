import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { escalateMaintenanceNeedsVendor } from "../maintenance_admin_escalation.ts"
import {
  isManualStageOverrideFresh,
  shouldSuppressAutomationForManualOverride,
} from "./manualStageOverride.ts"

function workflowRunsMock(metadata: Record<string, unknown>) {
  const chain = {
    eq() {
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
    maybeSingle: async () => ({
      data: { id: "run-1", metadata },
      error: null,
    }),
  }
  return {
    select() {
      return chain
    },
  }
}

Deno.test("escalateMaintenanceNeedsVendor is suppressed while manual_stage_override is fresh", async () => {
  const ticketId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const landlordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

  const supabase = {
    from(table: string) {
      if (table === "workflow_runs") {
        return workflowRunsMock({
          manual_stage_override: {
            stage: "in_progress",
            at: new Date().toISOString(),
            by: "landlord",
          },
        })
      }
      return {
        insert() {
          return Promise.resolve({ error: null })
        },
        select() {
          return {
            eq() {
              return this
            },
            maybeSingle: async () => ({ data: null, error: null }),
          }
        },
      }
    },
  }

  const result = await escalateMaintenanceNeedsVendor(
    supabase as never,
    { id: ticketId, landlord_id: landlordId },
    {
      escalationReason: "no_vendor_available",
      eventMessage: "test",
      graphEventType: "maintenance.submitted_needs_vendor",
      graphMessage: "test",
    },
  )

  assertEquals(result.suppressed, true)
  assertEquals(result.nearbyOptionCount, 0)
})

Deno.test("stale manual_stage_override does not suppress automation", async () => {
  assertEquals(
    isManualStageOverrideFresh({
      stage: "in_progress",
      at: "2020-01-01T00:00:00.000Z",
      by: "landlord",
    }),
    false,
  )

  const supabase = {
    from(table: string) {
      if (table === "workflow_runs") {
        return workflowRunsMock({
          manual_stage_override: {
            stage: "in_progress",
            at: "2020-01-01T00:00:00.000Z",
            by: "landlord",
          },
        })
      }
      return {
        insert() {
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  const suppressed = await shouldSuppressAutomationForManualOverride(supabase as never, {
    ticketId: "ticket-1",
    landlordId: "landlord-1",
    reason: "escalate_needs_vendor",
  })
  assertEquals(suppressed, false)
})

Deno.test("cleared override (no metadata) does not suppress", async () => {
  const supabase = {
    from(table: string) {
      if (table === "workflow_runs") {
        return workflowRunsMock({})
      }
      return {
        insert() {
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  const suppressed = await shouldSuppressAutomationForManualOverride(supabase as never, {
    ticketId: "ticket-1",
    landlordId: "landlord-1",
    reason: "vendor_accepted",
  })
  assertEquals(suppressed, false)
})
