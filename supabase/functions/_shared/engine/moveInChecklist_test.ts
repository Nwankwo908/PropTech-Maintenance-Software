/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildMoveInChecklistSms,
  initMoveInChecklist,
  markMoveInChecklistComplete,
  parseMoveInResidentReply,
  readMoveInChecklist,
} from "./moveInChecklist.ts"

Deno.test("initMoveInChecklist includes three required items", () => {
  const checklist = initMoveInChecklist()
  assertEquals(checklist.requiredCount, 3)
  assertEquals(checklist.allComplete, false)
})

Deno.test("parseMoveInResidentReply recognizes DONE", () => {
  assertEquals(parseMoveInResidentReply("DONE"), "complete_all")
  assertEquals(parseMoveInResidentReply("all set, thanks"), "complete_all")
  assertEquals(parseMoveInResidentReply("what time is move-in?"), "question")
})

Deno.test("markMoveInChecklistComplete completes all items", () => {
  const done = markMoveInChecklistComplete(initMoveInChecklist())
  assertEquals(done.allComplete, true)
  assertEquals(done.completeCount, 3)
})

Deno.test("readMoveInChecklist restores persisted metadata", () => {
  const state = readMoveInChecklist({
    checklist: {
      items: [
        { key: "keys", label: "Keys", complete: true },
        { key: "utilities", label: "Utilities", complete: false },
        { key: "inspection_prep", label: "Inspection", complete: false },
      ],
    },
  })
  assertEquals(state.completeCount, 1)
})

Deno.test("checklist SMS includes items and DONE instruction", () => {
  const body = buildMoveInChecklistSms({
    residentName: "Alex",
    companyName: "Harbor Properties",
    unitLabel: "4B",
    moveInDate: "2026-08-01",
  })
  assertStringIncludes(body, "Harbor Properties")
  assertStringIncludes(body, "checklist")
  assertStringIncludes(body, "Reply DONE")
})
