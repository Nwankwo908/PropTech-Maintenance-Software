import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  addScheduleQuestion,
  estimateRefBounds,
  estimateReplyRef,
  parseQuestionReplyRef,
  removeScheduleQuestion,
  selectScheduleQuestion,
} from "./questionReplyRef.ts"
import { shouldClarifyAmbiguousYesPendingAsks } from "./shortReplyArbitration.ts"
import { buildTenantScheduleAskSms } from "./tenantScheduleConfirm.ts"
import { buildLandlordEstimateApprovalSms } from "./estimateApprovalSms.ts"

const NOW = Date.parse("2026-10-25T12:00:00Z")
const first = {
  reply_ref: "S-111111111111",
  ticket_id: "job-a",
  vendor_id: "vendor-a",
  window_text: "Monday 9am",
  expires_at: "2026-10-26T12:00:00Z",
}
const second = {
  ...first,
  reply_ref: "S-222222222222",
  ticket_id: "job-b",
  window_text: "Tuesday 2pm",
}

Deno.test("older still-open visit is selected by reference instead of newest ask", () => {
  const state = addScheduleQuestion(addScheduleQuestion({}, first), second)
  const picked = selectScheduleQuestion(state, "s-111111111111 YES", NOW)
  assertEquals(picked.kind, "selected")
  if (picked.kind === "selected") {
    assertEquals(picked.question.ticket_id, "job-a")
    assertEquals(picked.body, "YES")
  }
  assertEquals(selectScheduleQuestion(state, "YES", NOW).kind, "clarify")
  assertEquals(selectScheduleQuestion(state, "NO", NOW).kind, "clarify")
})

Deno.test("answering older visit preserves newer question; repeats cannot act", () => {
  const state = addScheduleQuestion(addScheduleQuestion({}, first), second)
  const after = removeScheduleQuestion(state, first)
  assertEquals(
    selectScheduleQuestion(after, "S-111111111111 YES", NOW).kind,
    "clarify",
  )
  const picked = selectScheduleQuestion(after, "YES", NOW)
  assertEquals(picked.kind, "selected")
  if (picked.kind === "selected") {
    assertEquals(picked.question.ticket_id, "job-b")
  }
})

Deno.test("new proposal supersedes only same job's question", () => {
  const state = addScheduleQuestion(
    addScheduleQuestion(addScheduleQuestion({}, first), second),
    { ...first, reply_ref: "S-333333333333", window_text: "Wednesday 3pm" },
  )
  assertEquals(
    selectScheduleQuestion(state, "S-111111111111 YES", NOW).kind,
    "clarify",
  )
  assertEquals(
    selectScheduleQuestion(state, "S-222222222222 YES", NOW).kind,
    "selected",
  )
  assertEquals(
    selectScheduleQuestion(state, "S-333333333333 YES", NOW).kind,
    "selected",
  )
})

Deno.test("expired, unknown, malformed and multi-reference replies fail closed", () => {
  const state = addScheduleQuestion({}, first)
  assertEquals(
    selectScheduleQuestion(
      state,
      "S-111111111111 YES",
      Date.parse(first.expires_at),
    ).kind,
    "clarify",
  )
  for (
    const body of [
      "S-999999999999 YES",
      "S-111111111111 S-222222222222 YES",
      "S-wrong YES",
    ]
  ) assertEquals(selectScheduleQuestion(state, body, NOW).kind, "clarify")
  assertEquals(
    selectScheduleQuestion({}, "S-111111111111 YES", NOW).kind,
    "clarify",
  )
})

Deno.test("legacy invalidation never resurrects stale schedule references", () => {
  const state = addScheduleQuestion({}, first)
  delete state.awaiting_schedule_confirmation
  assertEquals(
    selectScheduleQuestion(state, "S-111111111111 YES", NOW).kind,
    "clarify",
  )
  const replaced = {
    ...addScheduleQuestion({}, first),
    awaiting_schedule_confirmation: {
      ...first,
      reply_ref: undefined,
      window_text: "New legacy slot",
    },
  }
  assertEquals(
    selectScheduleQuestion(replaced, "S-111111111111 YES", NOW).kind,
    "clarify",
  )
})

Deno.test("single legacy visit still accepts ordinary natural-language reply", () => {
  const state = {
    awaiting_schedule_confirmation: {
      ticket_id: "job-a",
      vendor_id: "vendor-a",
      window_text: "Monday",
    },
  }
  assertEquals(
    selectScheduleQuestion(state, "that works", NOW).kind,
    "selected",
  )
})

Deno.test("estimate references pin exact UUID version range and strip only the code", () => {
  const id = "abcdef12-3456-4789-8123-123456789012"
  const ref = estimateReplyRef(id)
  assertEquals(ref, "E-ABCDEF123456")
  assertEquals(parseQuestionReplyRef(`${ref} APPROVE`), {
    kind: "estimate",
    ref,
    body: "APPROVE",
  })
  const bounds = estimateRefBounds(ref)
  assertEquals(id >= bounds.lower && id <= bounds.upper, true)
  assertEquals("abcdef12-3457-0000-0000-000000000000" <= bounds.upper, false)
})

Deno.test("NO as well as YES clarifies across several decision types", () => {
  const intakeState = {
    awaiting_schedule_confirmation: true,
    awaiting_estimate_decision: { estimate_id: "sim-estimate" },
  }
  for (const body of ["YES", "NO", "nope"]) {
    assertEquals(
      shouldClarifyAmbiguousYesPendingAsks({ intakeState, body }),
      true,
    )
  }
})

Deno.test("outbound visit and estimate questions advertise their exact answer references", () => {
  const visit = buildTenantScheduleAskSms({
    residentName: "Test",
    vendorName: "Test Vendor",
    windowText: "Monday",
    replyRef: first.reply_ref,
    workOrderRef: "WO-1111",
  })
  assertEquals(visit.includes(`${first.reply_ref} YES`), true)
  const estimate = buildLandlordEstimateApprovalSms({
    estimateId: "abcdef12-3456-4789-8123-123456789012",
    vendorName: "Test Vendor",
    workOrderRef: "WO-ABCD",
    totalCost: 100,
    partsCost: 40,
    laborCost: 60,
  })
  assertEquals(estimate.includes("E-ABCDEF123456 APPROVE"), true)
  assertEquals(estimate.includes("E-ABCDEF123456 DECLINE"), true)
})
