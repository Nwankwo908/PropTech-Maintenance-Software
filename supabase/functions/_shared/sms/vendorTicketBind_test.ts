import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  extractWorkOrderRefFromSms,
  formatWorkOrderRef,
  stripWorkOrderRefFromSms,
  workOrderRefMatchesTicket,
} from "../vendor_outreach_copy.ts"
import { resolveVendorTicketForInbound } from "./vendorSmsRouting.ts"
import {
  buildVendorWorkOrderClarifySms,
  createVendorWorkOrderClarification,
  isVendorWorkOrderClarificationExpired,
  matchActiveJobsFromReply,
  readVendorWorkOrderClarification,
  resolveClarificationSelection,
  type VendorActiveJob,
  withVendorWorkOrderClarification,
} from "./vendorWorkOrderClarification.ts"

const JOB_A: VendorActiveJob = {
  ticketId: "3b0047aa-1111-2222-3333-444444444444",
  workOrderRef: "WO-3B00",
  unit: "101",
  building: "Oakwood Apartments",
  issueCategory: "plumbing",
  description: "Leaking faucet in kitchen",
}

const JOB_B: VendorActiveJob = {
  ticketId: "9f3c0000-1111-2222-3333-444444444444",
  workOrderRef: "WO-9F3C",
  unit: "205",
  building: "Pine Ridge",
  issueCategory: "plumbing",
  description: "Water heater not heating",
}

const JOB_C: VendorActiveJob = {
  ticketId: "d5520000-1111-2222-3333-444444444444",
  workOrderRef: "WO-D552",
  unit: "310",
  building: "Cedar Court",
  issueCategory: "plumbing",
  description: "Clogged drain in bathroom",
}

Deno.test("extractWorkOrderRefFromSms finds WO tokens", () => {
  assertEquals(extractWorkOrderRefFromSms("YES WO-3B00"), "WO-3B00")
  assertEquals(extractWorkOrderRefFromSms("no wo-a1b2 please"), "WO-A1B2")
  assertEquals(extractWorkOrderRefFromSms("WO 9f3c Wed 9am"), "WO-9F3C")
  assertEquals(extractWorkOrderRefFromSms("YES"), null)
})

Deno.test("stripWorkOrderRefFromSms leaves availability text", () => {
  assertEquals(stripWorkOrderRefFromSms("WO-3B00 Wed 9am–12pm"), "Wed 9am–12pm")
  assertEquals(stripWorkOrderRefFromSms("YES WO-3B00"), "YES")
})

Deno.test("workOrderRefMatchesTicket uses formatWorkOrderRef", () => {
  assertEquals(formatWorkOrderRef(JOB_A.ticketId), "WO-3B00")
  assertEquals(workOrderRefMatchesTicket("WO-3B00", JOB_A.ticketId), true)
})

Deno.test("buildVendorWorkOrderClarifySms uses numbered options", () => {
  const body = buildVendorWorkOrderClarifySms([JOB_A, JOB_B, JOB_C])
  assertEquals(body.includes("multiple active work orders"), true)
  assertEquals(body.includes("1. WO-3B00 — Unit 101 — Leaking faucet in kitchen"), true)
  assertEquals(body.includes("2. WO-9F3C — Unit 205 — Water heater not heating"), true)
  assertEquals(body.includes("Reply with the number or work-order ID."), true)
})

Deno.test("matchActiveJobsFromReply — WO / unit / issue", () => {
  const jobs = [JOB_A, JOB_B, JOB_C]
  const byWo = matchActiveJobsFromReply("YES WO-9F3C", jobs)
  assertEquals(byWo.kind, "unique")
  if (byWo.kind === "unique") assertEquals(byWo.job.ticketId, JOB_B.ticketId)

  const byUnit = matchActiveJobsFromReply("I can visit Unit 205 tomorrow.", jobs)
  assertEquals(byUnit.kind, "unique")
  if (byUnit.kind === "unique") assertEquals(byUnit.job.ticketId, JOB_B.ticketId)

  const byIssue = matchActiveJobsFromReply("The water heater job is complete.", jobs)
  assertEquals(byIssue.kind, "unique")
  if (byIssue.kind === "unique") assertEquals(byIssue.job.ticketId, JOB_B.ticketId)

  const byFaucet = matchActiveJobsFromReply(
    "I need approval for the faucet repair.",
    jobs,
  )
  assertEquals(byFaucet.kind, "unique")
  if (byFaucet.kind === "unique") assertEquals(byFaucet.job.ticketId, JOB_A.ticketId)

  const ambiguous = matchActiveJobsFromReply("YES", jobs)
  assertEquals(ambiguous.kind, "none")
})

Deno.test("resolveClarificationSelection — number / WO / unit / issue", () => {
  const jobs = [JOB_A, JOB_B, JOB_C]
  const pending = createVendorWorkOrderClarification({
    vendorId: "v1",
    conversationId: "c1",
    landlordId: "l1",
    originalMessage: "I'll be there tomorrow at 10.",
    candidateWorkOrderIds: jobs.map((j) => j.ticketId),
  })

  assertEquals(resolveClarificationSelection("2", pending, jobs), JOB_B.ticketId)
  assertEquals(
    resolveClarificationSelection("WO-3B00", pending, jobs),
    JOB_A.ticketId,
  )
  assertEquals(
    resolveClarificationSelection("Unit 101", pending, jobs),
    JOB_A.ticketId,
  )
  assertEquals(
    resolveClarificationSelection("Leaking faucet", pending, jobs),
    JOB_A.ticketId,
  )
  assertEquals(resolveClarificationSelection("maybe", pending, jobs), null)
})

Deno.test("clarification state round-trip + expiry", () => {
  const pending = createVendorWorkOrderClarification({
    vendorId: "v1",
    conversationId: "c1",
    landlordId: "l1",
    originalMessage: "Tomorrow at 10",
    candidateWorkOrderIds: [JOB_A.ticketId, JOB_B.ticketId],
    now: Date.parse("2026-07-25T12:00:00.000Z"),
  })
  const intake = withVendorWorkOrderClarification({}, pending)
  const read = readVendorWorkOrderClarification(intake)
  assertEquals(read?.originalMessage, "Tomorrow at 10")
  assertEquals(read?.candidateWorkOrderIds.length, 2)
  assertEquals(
    isVendorWorkOrderClarificationExpired(
      pending,
      Date.parse("2026-07-25T12:10:00.000Z"),
    ),
    false,
  )
  assertEquals(
    isVendorWorkOrderClarificationExpired(
      pending,
      Date.parse("2026-07-25T13:00:00.000Z"),
    ),
    true,
  )
})

function mockOpenJobsSupabase(jobs: VendorActiveJob[]) {
  const rows = jobs.map((j) => ({
    id: j.ticketId,
    unit: j.unit,
    building: j.building,
    issue_category: j.issueCategory,
    description: j.description,
  }))
  return {
    from(table: string) {
      if (table !== "maintenance_requests") {
        throw new Error(`unexpected table ${table}`)
      }
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        order() {
          return api
        },
        limit() {
          return api
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null })
        },
        then(resolve: (value: { data: typeof rows; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

Deno.test("resolveVendorTicketForInbound binds unit context among multiple jobs", async () => {
  const supabase = mockOpenJobsSupabase([JOB_A, JOB_B, JOB_C]) as never
  const resolved = await resolveVendorTicketForInbound(supabase, {
    vendorId: "vendor-1",
    inboundBody: "I can visit Unit 205 tomorrow.",
  })
  assertEquals(resolved.ok, true)
  if (resolved.ok) {
    assertEquals(resolved.ticketId, JOB_B.ticketId)
    assertEquals(resolved.boundBy, "unit")
  }
})

Deno.test("resolveVendorTicketForInbound requires clarify for bare YES", async () => {
  const supabase = mockOpenJobsSupabase([JOB_A, JOB_B]) as never
  const resolved = await resolveVendorTicketForInbound(supabase, {
    vendorId: "vendor-1",
    inboundBody: "YES",
  })
  assertEquals(resolved.ok, false)
  if (!resolved.ok) assertEquals(resolved.reason, "need_work_order")
})

Deno.test("resolveVendorTicketForInbound uses schedule FSM without WO", async () => {
  const supabase = mockOpenJobsSupabase([JOB_A, JOB_B]) as never
  const resolved = await resolveVendorTicketForInbound(supabase, {
    vendorId: "vendor-1",
    inboundBody: "Wed 9am",
    scheduleTicketId: JOB_A.ticketId,
  })
  assertEquals(resolved.ok, true)
  if (resolved.ok) {
    assertEquals(resolved.ticketId, JOB_A.ticketId)
    assertEquals(resolved.boundBy, "schedule_fsm")
  }
})

Deno.test("resolveVendorTicketForInbound allows single open job without WO", async () => {
  const supabase = mockOpenJobsSupabase([JOB_A]) as never
  const resolved = await resolveVendorTicketForInbound(supabase, {
    vendorId: "vendor-1",
    inboundBody: "YES",
  })
  assertEquals(resolved.ok, true)
  if (resolved.ok) {
    assertEquals(resolved.ticketId, JOB_A.ticketId)
    assertEquals(resolved.boundBy, "single_open_job")
  }
})
