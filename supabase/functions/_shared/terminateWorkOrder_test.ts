/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildVendorTerminateEmail,
  buildVendorTerminateSms,
  mapVendorTerminateReason,
  MAX_TERMINATE_SMS_ATTEMPTS,
  resolveVendorTerminateJobPhase,
  shouldWarnLandlordPayment,
  terminateWorkOrder,
} from "./terminateWorkOrder.ts"
import { vendorCompanyName } from "./vendor_outreach_copy.ts"

const LANDLORD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TICKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const VENDOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

Deno.test("vendorCompanyName title-cases all-lowercase company names", () => {
  assertEquals(vendorCompanyName("flex plumbing"), "Flex Plumbing")
  assertEquals(vendorCompanyName("FLEX PLUMBING"), "Flex Plumbing")
  assertEquals(vendorCompanyName("Flex Plumbing"), "Flex Plumbing")
})

Deno.test("resolveVendorTerminateJobPhase maps statuses", () => {
  assertEquals(resolveVendorTerminateJobPhase("pending_accept"), "not_started")
  assertEquals(resolveVendorTerminateJobPhase("accepted"), "not_started")
  assertEquals(resolveVendorTerminateJobPhase("in_progress"), "in_progress")
  assertEquals(resolveVendorTerminateJobPhase("completed"), "completed")
})

Deno.test("not-started cancellation shows scheduled window and never says stop work", () => {
  const body = buildVendorTerminateSms({
    vendorName: "flex plumbing",
    workOrderRef: "WO-13F4",
    propertyLabel: "120 Main St",
    unit: "1",
    reason: "Archived from the workflow pipeline",
    mode: "cancel",
    vendorWorkStatus: "accepted",
    scheduledWindowText: "Thu 2–4pm",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "Cancelled — WO-13F4 · Unit 1")
  assertStringIncludes(body!, "Flex Plumbing")
  assertStringIncludes(body!, "Your Thu 2–4pm visit is no longer needed — no need to come out.")
  assertStringIncludes(
    body!,
    "If you're already on site or started work, please stop and text us.",
  )
  assertEquals(body!.toLowerCase().includes("please stop work now"), false)
  assertEquals(body!.includes("Archived from the workflow pipeline"), false)
  assertStringIncludes(body!, "Reason: The property team closed this job.")
})

Deno.test("in-progress cancellation shows stop work", () => {
  const body = buildVendorTerminateSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-13F4",
    propertyLabel: "",
    unit: "1",
    reason: "Resident cancelled",
    mode: "cancel",
    vendorWorkStatus: "in_progress",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "Please stop work now — this job has been cancelled.")
  assertEquals(body!.includes("no need to come out"), false)
  assertStringIncludes(body!, "Reason: The resident cancelled this repair.")
})

Deno.test("completed-status cancellation builds no vendor SMS", () => {
  const body = buildVendorTerminateSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-13F4",
    propertyLabel: "",
    unit: "1",
    reason: "Archived from the workflow pipeline",
    mode: "cancel",
    vendorWorkStatus: "completed",
  })
  assertEquals(body, null)
  assertEquals(
    buildVendorTerminateEmail({
      vendorName: "Flex Plumbing",
      workOrderRef: "WO-13F4",
      propertyLabel: "",
      unit: "1",
      reason: "Archived from the workflow pipeline",
      mode: "cancel",
      vendorWorkStatus: "completed",
    }),
    null,
  )
})

Deno.test("mapped reason code renders mapped text only", () => {
  const mapped = mapVendorTerminateReason("Archived from the workflow pipeline")
  assertEquals(mapped.vendorText, "The property team closed this job.")
  assertEquals(mapped.unmapped, false)
  const body = buildVendorTerminateSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-AAAA",
    propertyLabel: "",
    unit: "",
    reason: "Archived from the workflow pipeline",
    mode: "archive",
    vendorWorkStatus: "pending_accept",
  })
  assertStringIncludes(body!, "Reason: The property team closed this job.")
  assertEquals(body!.includes("Archived from the workflow pipeline"), false)
  assertEquals(body!.includes("workflow"), false)
})

Deno.test("unmapped reason code omits reason line — raw string never appears", () => {
  const internal = "cleanup_duplicate_intake_v2"
  const mapped = mapVendorTerminateReason(internal)
  assertEquals(mapped.vendorText, null)
  assertEquals(mapped.unmapped, true)
  const body = buildVendorTerminateSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-AAAA",
    propertyLabel: "",
    unit: "2",
    reason: internal,
    mode: "cancel",
    vendorWorkStatus: "accepted",
    scheduledWindowText: "Mon 10am",
  })
  assertEquals(body != null, true)
  assertEquals(body!.includes(internal), false)
  assertEquals(body!.includes("Reason:"), false)
  assertEquals(body!.includes("cleanup_duplicate"), false)
})

Deno.test("buildVendorTerminateSms release mode says reassigned on line 1", () => {
  const body = buildVendorTerminateSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-1C50",
    propertyLabel: "",
    unit: "",
    reason: null,
    mode: "release",
    vendorWorkStatus: "in_progress",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "Reassigned — WO-1C50")
  assertStringIncludes(body!, "Please stop work now — this job has been reassigned.")
})

Deno.test("buildVendorTerminateEmail subject matches mode", () => {
  const cancel = buildVendorTerminateEmail({
    vendorName: "Flex",
    workOrderRef: "WO-ABCD",
    propertyLabel: "",
    unit: "",
    reason: null,
    mode: "cancel",
    vendorWorkStatus: "accepted",
  })
  assertEquals(cancel != null, true)
  assertStringIncludes(cancel!.subject, "cancelled")
  const release = buildVendorTerminateEmail({
    vendorName: "Flex",
    workOrderRef: "WO-ABCD",
    propertyLabel: "",
    unit: "",
    reason: null,
    mode: "release",
    vendorWorkStatus: "accepted",
  })
  assertEquals(release != null, true)
  assertStringIncludes(release!.subject, "reassigned")
})

Deno.test("shouldWarnLandlordPayment when estimate approved or work started", () => {
  assertEquals(
    shouldWarnLandlordPayment({
      previousStatus: "pending_accept",
      hadApprovedEstimate: true,
    }),
    true,
  )
  assertEquals(
    shouldWarnLandlordPayment({
      previousStatus: "accepted",
      hadApprovedEstimate: false,
    }),
    true,
  )
  assertEquals(
    shouldWarnLandlordPayment({
      previousStatus: "in_progress",
      hadApprovedEstimate: false,
    }),
    true,
  )
  assertEquals(
    shouldWarnLandlordPayment({
      previousStatus: "pending_accept",
      hadApprovedEstimate: false,
    }),
    false,
  )
})

Deno.test("MAX_TERMINATE_SMS_ATTEMPTS is 3", () => {
  assertEquals(MAX_TERMINATE_SMS_ATTEMPTS, 3)
})

type TermRow = Record<string, unknown>
type AttemptRow = Record<string, unknown>

type State = {
  ticket: {
    id: string
    landlord_id: string
    unit: string
    description: string
    issue_headline: string | null
    property_id: string | null
    assigned_vendor_id: string | null
    vendor_work_status: string
    cancelled_at: string | null
    previous_vendor_id: string | null
    cancellation_reason: string | null
    scheduled_window_text: string | null
    scheduled_at: string | null
  }
  terminations: TermRow[]
  attempts: AttemptRow[]
  estimates: Array<{ id: string; status: string }>
  vendor: { id: string; name: string; phone: string | null; email: string | null }
  hardDeleteBlocked: boolean
}

function newState(overrides?: Partial<State["ticket"]> & {
  estimates?: State["estimates"]
  vendorPhone?: string | null
}): State {
  return {
    ticket: {
      id: TICKET_ID,
      landlord_id: LANDLORD_ID,
      unit: "1",
      description: "Leak",
      issue_headline: "Leak",
      property_id: null,
      assigned_vendor_id: VENDOR_ID,
      vendor_work_status: "pending_accept",
      cancelled_at: null,
      previous_vendor_id: null,
      cancellation_reason: null,
      scheduled_window_text: null,
      scheduled_at: null,
      ...overrides,
    },
    terminations: [],
    attempts: [],
    estimates: overrides?.estimates ?? [],
    vendor: {
      id: VENDOR_ID,
      name: "Flex Plumbing",
      phone: overrides?.vendorPhone === undefined
        ? "+15551234567"
        : overrides.vendorPhone,
      email: "flex@example.com",
    },
    hardDeleteBlocked: false,
  }
}

function mockSupabase(state: State) {
  const from = (table: string) => {
    const filters: Array<{ col: string; val: unknown; op: string }> = []
    let pendingInsert: Record<string, unknown> | null = null
    let pendingUpdate: Record<string, unknown> | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ col, val, op: "eq" })
      return chain()
    }
    api.in = (col: string, val: unknown) => {
      filters.push({ col, val, op: "in" })
      return chain()
    }
    api.not = () => chain()
    api.is = () => chain()
    api.order = () => chain()
    api.limit = () => chain()
    api.insert = (row: Record<string, unknown>) => {
      pendingInsert = row
      return chain()
    }
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.delete = () => {
      // Simulate DB trigger for assigned WOs
      if (
        table === "maintenance_requests" &&
        (state.ticket.assigned_vendor_id || state.ticket.previous_vendor_id)
      ) {
        state.hardDeleteBlocked = true
        return {
          eq: () => ({
            eq: async () => ({
              error: {
                message:
                  "HARD_DELETE_FORBIDDEN: work order cannot be hard-deleted",
                code: "P0001",
              },
            }),
          }),
        }
      }
      return {
        eq: () => ({
          eq: async () => ({ error: null }),
          in: async () => ({ error: null }),
        }),
        in: async () => ({ error: null }),
      }
    }

    api.maybeSingle = async () => {
      if (table === "maintenance_requests") {
        return { data: state.ticket, error: null }
      }
      if (table === "maintenance_estimates") {
        const approved = state.estimates.find((e) => e.status === "approved")
        return { data: approved ?? null, error: null }
      }
      if (table === "vendors") {
        return { data: state.vendor, error: null }
      }
      if (table === "work_order_terminations") {
        const rows = state.terminations
        return { data: rows[0] ?? null, error: null }
      }
      if (table === "properties") {
        return { data: null, error: null }
      }
      if (table === "workflow_runs") {
        return { data: null, error: null }
      }
      if (table === "sms_numbers" || table === "sms_identities") {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    api.single = async () => {
      if (pendingInsert && table === "work_order_terminations") {
        // Idempotent unique: if terminal already exists, simulate conflict
        const existingTerminal = state.terminations.find(
          (t) =>
            t.ticket_id === pendingInsert!.ticket_id &&
            (t.mode === "cancel" || t.mode === "archive"),
        )
        if (
          existingTerminal &&
          (pendingInsert.mode === "cancel" || pendingInsert.mode === "archive")
        ) {
          pendingInsert = null
          return {
            data: null,
            error: { message: "duplicate", code: "23505" },
          }
        }
        const row = {
          id: `term-${state.terminations.length + 1}`,
          ...pendingInsert,
          sms_attempt_count: 0,
          email_attempt_count: 0,
          staff_alerted_at: null,
          last_sms_error: null,
          conversation_id: pendingInsert.conversation_id ?? null,
        }
        state.terminations.push(row)
        pendingInsert = null
        return { data: row, error: null }
      }
      return { data: null, error: null }
    }

    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (pendingInsert && table === "work_order_terminate_notify_attempts") {
          state.attempts.push({ ...pendingInsert })
          pendingInsert = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingInsert && table === "sms_messages") {
          pendingInsert = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingUpdate && table === "maintenance_requests") {
          Object.assign(state.ticket, pendingUpdate)
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (pendingUpdate && table === "work_order_terminations") {
          const id = String(
            filters.find((f) => f.col === "id")?.val ?? "",
          )
          const row = state.terminations.find((t) => t.id === id)
          if (row) Object.assign(row, pendingUpdate)
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }
        if (table === "workflow_runs") {
          resolve({ data: [], error: null })
          return
        }
        resolve({ data: [], error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }

  return { from } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test("terminateWorkOrder cancel persists state before delivery and notifies", async () => {
  const state = newState()
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "cancel",
    source: "resident_sms",
    actorType: "resident",
    reason: "Resident cancelled",
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(state.ticket.vendor_work_status, "cancelled")
  assertEquals(state.ticket.assigned_vendor_id, null)
  assertEquals(state.ticket.previous_vendor_id, VENDOR_ID)
  assertEquals(state.terminations.length, 1)
  assertEquals(state.terminations[0]!.mode, "cancel")
  // Delivery will skip/fail without SMS provider — but attempt rows must exist
  assertEquals(state.attempts.length >= 1, true)
})

Deno.test("terminateWorkOrder is idempotent — second cancel does not destroy details", async () => {
  const state = newState({
    vendor_work_status: "cancelled",
    assigned_vendor_id: null,
    previous_vendor_id: VENDOR_ID,
    cancelled_at: "2026-09-22T00:00:00.000Z",
    cancellation_reason: "Original reason",
  })
  state.terminations.push({
    id: "term-1",
    ticket_id: TICKET_ID,
    landlord_id: LANDLORD_ID,
    mode: "cancel",
    previous_vendor_id: VENDOR_ID,
    notify_status: "notified",
    sms_attempt_count: 1,
    email_attempt_count: 1,
    sms_body: "prior",
    staff_alerted_at: null,
    conversation_id: null,
    last_sms_error: null,
  })
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "cancel",
    source: "dashboard",
    reason: "Should not overwrite",
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.alreadyTerminated, true)
  assertEquals(state.ticket.cancellation_reason, "Original reason")
  assertEquals(state.terminations.length, 1)
})

Deno.test("terminateWorkOrder warns landlord when estimate was approved", async () => {
  const state = newState({
    vendor_work_status: "accepted",
    estimates: [{ id: "est-1", status: "approved" }],
  })
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "cancel",
    source: "emergency_decline",
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.landlordPaymentWarning, true)
})

Deno.test("terminateWorkOrder release keeps ticket open for reassignment", async () => {
  const state = newState({ vendor_work_status: "pending_accept" })
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "release",
    source: "reassignment",
    vendorId: VENDOR_ID,
    closeWorkflowRuns: false,
    clearAssignment: false,
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(state.ticket.vendor_work_status, "pending_accept")
  assertEquals(state.ticket.assigned_vendor_id, VENDOR_ID)
  assertEquals(state.terminations[0]!.mode, "release")
})

Deno.test("hard-delete mock blocks assigned work orders", async () => {
  const state = newState()
  const supabase = mockSupabase(state)
  const { error } = await supabase
    .from("maintenance_requests")
    .delete()
    .eq("landlord_id", LANDLORD_ID)
    .eq("id", TICKET_ID)
  assertEquals(state.hardDeleteBlocked, true)
  assertEquals(Boolean(error), true)
})

Deno.test("archive mode sets archived status", async () => {
  const state = newState()
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "archive",
    source: "admin_api",
  })
  assertEquals(result.ok, true)
  assertEquals(state.ticket.vendor_work_status, "archived")
})

Deno.test("terminateWorkOrder on completed job skips vendor SMS and alerts staff", async () => {
  const state = newState({ vendor_work_status: "completed" })
  const supabase = mockSupabase(state)
  const result = await terminateWorkOrder(supabase, {
    landlordId: LANDLORD_ID,
    ticketId: TICKET_ID,
    mode: "cancel",
    source: "dashboard",
    reason: "Archived from the workflow pipeline",
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.vendorNotify, "skipped")
  assertEquals(state.terminations[0]!.notify_status, "skipped")
  assertEquals(state.terminations[0]!.sms_body, null)
  // No vendor delivery attempts when completed
  assertEquals(state.attempts.length, 0)
})
