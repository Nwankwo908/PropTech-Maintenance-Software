/**
 * Pure lifecycle policy tests (no I/O).
 *
 * Run: deno test --config ask-ulo/deno.json --no-check \
 *   supabase/functions/_shared/engine/lifecyclePolicy_test.ts
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildInspectionNoticeSms,
  buildMoveInReminderSms,
  buildMoveInWelcomeSms,
  lifecycleActionDue,
  lifecycleTimingDefaults,
  LIFECYCLE_TERMINAL_STEPS,
  readLifecycleStepState,
} from "./lifecyclePolicy.ts"
import type { WorkflowRunRow } from "./types.ts"
import { getWorkflowTemplate } from "./registry.ts"

function makeRun(
  overrides: Partial<WorkflowRunRow> & {
    template_id: WorkflowRunRow["template_id"]
  },
): WorkflowRunRow {
  const now = new Date().toISOString()
  return {
    id: "run-1",
    template_id: overrides.template_id,
    workflow_type: "lifecycle",
    landlord_id: "ll-1",
    status: "active",
    current_step: overrides.current_step ?? "awaiting_confirm",
    current_stage: "act",
    started_at: overrides.started_at ?? now,
    created_at: overrides.started_at ?? now,
    updated_at: now,
    completed_at: null,
    trigger_type: "dashboard",
    entity_type: "unit",
    entity_id: "unit-1",
    property_id: null,
    resident_id: null,
    unit_id: "unit-1",
    metadata: overrides.metadata ?? {},
    ...overrides,
  }
}

Deno.test("registry includes move_in, move_out, inspection", () => {
  assertEquals(getWorkflowTemplate("move_in")?.id, "move_in")
  assertEquals(getWorkflowTemplate("move_out")?.id, "move_out")
  assertEquals(getWorkflowTemplate("inspection")?.id, "inspection")
})

Deno.test("lifecycleTimingDefaults match product thresholds", () => {
  assertEquals(lifecycleTimingDefaults("move_in"), {
    reminderDays: 2,
    noResponseDays: 5,
  })
  assertEquals(lifecycleTimingDefaults("move_out"), {
    reminderDays: 3,
    noResponseDays: 7,
  })
  assertEquals(lifecycleTimingDefaults("inspection"), {
    reminderDays: 1,
    noResponseDays: 3,
  })
})

Deno.test("lifecycleActionDue: reminder before escalate", () => {
  const started = new Date(Date.now() - 3 * 86400000).toISOString()
  const run = makeRun({
    template_id: "move_in",
    current_step: "awaiting_confirm",
    started_at: started,
    metadata: {
      step_state: {
        step: "awaiting_confirm",
        last_activity_at: started,
      },
    },
  })

  const due = lifecycleActionDue(run, { reminder_days: 2, no_response_days: 5 })
  assertEquals(due.due, true)
  assertEquals(due.reason, "reminder_due")
})

Deno.test("lifecycleActionDue: escalate after no_response_days", () => {
  const started = new Date(Date.now() - 6 * 86400000).toISOString()
  const reminded = new Date(Date.now() - 4 * 86400000).toISOString()
  const run = makeRun({
    template_id: "move_in",
    current_step: "awaiting_confirm",
    started_at: started,
    metadata: {
      step_state: {
        step: "awaiting_confirm",
        last_activity_at: started,
        reminder_sent_at: reminded,
        reminder_count: 1,
      },
    },
  })

  const due = lifecycleActionDue(run, { reminder_days: 2, no_response_days: 5 })
  assertEquals(due.due, true)
  assertEquals(due.reason, "no_response_by_no_response_days")
})

Deno.test("lifecycleActionDue: terminal steps are not due", () => {
  const run = makeRun({
    template_id: "move_out",
    current_step: "completed",
    metadata: { step_state: { step: "completed" } },
  })
  assertEquals(LIFECYCLE_TERMINAL_STEPS.has("completed"), true)
  const due = lifecycleActionDue(run, {})
  assertEquals(due.due, false)
  assertEquals(due.reason, "terminal")
})

Deno.test("readLifecycleStepState prefers current_step", () => {
  const run = makeRun({
    template_id: "inspection",
    current_step: "awaiting_resident",
    metadata: { step_state: { step: "scheduled" } },
  })
  assertEquals(readLifecycleStepState(run).step, "awaiting_resident")
})

Deno.test("welcome / reminder SMS follow communication standard", () => {
  const welcome = buildMoveInWelcomeSms({
    residentName: "Alex",
    companyName: "Harbor Properties",
    unitLabel: "4B",
    moveInDate: "2026-08-01",
  })
  assertStringIncludes(welcome, "Harbor Properties")
  assertStringIncludes(welcome, "Alex")
  assertStringIncludes(welcome, "4B")

  const reminder = buildMoveInReminderSms({
    residentName: "Alex",
    companyName: "Harbor Properties",
  })
  assertStringIncludes(reminder, "checklist")
  assertStringIncludes(reminder, "Harbor Properties")

  const notice = buildInspectionNoticeSms({
    residentName: "Alex",
    companyName: "Harbor Properties",
    inspectionType: "move_out",
    scheduledAt: "2026-08-15T14:00:00.000Z",
  })
  assertStringIncludes(notice, "Harbor Properties")
  assertStringIncludes(notice, "move out")
})
