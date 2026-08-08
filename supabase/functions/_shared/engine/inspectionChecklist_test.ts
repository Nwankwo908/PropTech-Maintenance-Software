/// <reference lib="deno.ns" />
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildInspectionStartGuideSms,
  initInspectionChecklist,
  normalizeInspectionOutcome,
  parseInspectionResidentReply,
  patchInspectionChecklist,
  readInspectionChecklist,
} from "./inspectionChecklist.ts"

Deno.test("initInspectionChecklist includes five required items", () => {
  const checklist = initInspectionChecklist()
  assertEquals(checklist.requiredCount, 5)
  assertEquals(checklist.allComplete, false)
})

Deno.test("parseInspectionResidentReply recognizes start, done, reschedule", () => {
  assertEquals(parseInspectionResidentReply("START"), "start")
  assertEquals(parseInspectionResidentReply("done walking through"), "complete")
  assertEquals(parseInspectionResidentReply("need to reschedule"), "reschedule")
  assertEquals(parseInspectionResidentReply("what time?"), "question")
})

Deno.test("normalizeInspectionOutcome accepts valid outcomes", () => {
  assertEquals(normalizeInspectionOutcome("passed"), "passed")
  assertEquals(normalizeInspectionOutcome("no_show"), "no_show")
  assertEquals(normalizeInspectionOutcome("invalid"), null)
})

Deno.test("patchInspectionChecklist marks notice sent", () => {
  const next = patchInspectionChecklist(initInspectionChecklist(), { notice_sent: true })
  assertEquals(next.completeCount, 1)
})

Deno.test("buildInspectionStartGuideSms mentions DONE", () => {
  const body = buildInspectionStartGuideSms({ residentName: "Alex", unitLabel: "4B" })
  assertEquals(body.includes("DONE"), true)
  assertEquals(body.includes("Unit 4B"), true)
})

Deno.test("readInspectionChecklist restores flat metadata", () => {
  const state = readInspectionChecklist({
    checklist: { notice_sent: true, access_confirmed: true },
  })
  assertEquals(state.completeCount, 2)
})
