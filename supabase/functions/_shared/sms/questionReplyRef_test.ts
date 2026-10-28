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

Deno.test("one open visit accepts YES or NO; several visits need a number or short ref", () => {
  const only = addScheduleQuestion({}, {
    ...first,
    request_ref: "EB1D7CFC",
    ticket_id: "eb1d7cfc-3d70-4f57-bd59-680bdb997120",
  })
  const yes = selectScheduleQuestion(only, "YES", NOW)
  assertEquals(yes.kind, "selected")
  if (yes.kind === "selected") assertEquals(yes.body, "YES")
  const no = selectScheduleQuestion(only, "NO", NOW)
  assertEquals(no.kind, "selected")

  const state = addScheduleQuestion(addScheduleQuestion({}, {
    ...first,
    request_ref: "EB1D7CFC",
    ticket_id: "eb1d7cfc-3d70-4f57-bd59-680bdb997120",
    window_text: "Wednesday, Oct 28 between 9:00 AM and 12:00 PM",
  }), {
    ...second,
    request_ref: "30A0B8CC",
    ticket_id: "30a0b8cc-1111-2222-3333-444444444444",
  })
  const clarify = selectScheduleQuestion(state, "YES", NOW)
  assertEquals(clarify.kind, "clarify")
  if (clarify.kind === "clarify") {
    assertEquals(clarify.body.includes("S-"), false)
    assertEquals(clarify.body.includes("1. Wednesday, Oct 28 between 9:00 AM and 12:00 PM. Ref: EB1D7CFC"), true)
    assertEquals(clarify.body.includes("Reply with the number and YES or NO."), true)
  }
  const numbered = selectScheduleQuestion(state, "1 YES", NOW)
  assertEquals(numbered.kind, "selected")
  if (numbered.kind === "selected") {
    assertEquals(numbered.question.ticket_id, "eb1d7cfc-3d70-4f57-bd59-680bdb997120")
    assertEquals(numbered.body, "YES")
  }
  const byRef = selectScheduleQuestion(state, "30A0B8CC NO", NOW)
  assertEquals(byRef.kind, "selected")
  if (byRef.kind === "selected") {
    assertEquals(byRef.question.ticket_id, "30a0b8cc-1111-2222-3333-444444444444")
    assertEquals(byRef.body, "NO")
  }
  const byWorkOrder = selectScheduleQuestion(state, "WO-EB1D YES", NOW)
  assertEquals(byWorkOrder.kind, "selected")
  if (byWorkOrder.kind === "selected") {
    assertEquals(byWorkOrder.body, "YES")
  }
})

Deno.test("outbound visit and estimate questions advertise their exact answer references", () => {
  const visit = buildTenantScheduleAskSms({
    residentName: "Test",
    vendorName: "Test Vendor",
    windowText: "Monday",
    workOrderRef: "Ref: EB1D7CFC",
  })
  assertEquals(visit.includes("Reply YES to confirm"), true)
  assertEquals(visit.includes("S-"), false)
  const several = buildTenantScheduleAskSms({
    residentName: "Test",
    vendorName: "Test Vendor",
    windowText: "Monday",
    choiceRef: "EB1D7CFC",
    workOrderRef: "Ref: EB1D7CFC",
  })
  assertEquals(several.includes("EB1D7CFC YES"), true)
  assertEquals(several.includes("S-"), false)
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
