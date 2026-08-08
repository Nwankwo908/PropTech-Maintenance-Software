/// <reference lib="deno.ns" />
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildMoveOutDateConfirmPrompt,
  initMoveOutChecklist,
  parseMoveOutResidentReply,
  patchMoveOutChecklist,
  readMoveOutChecklist,
} from "./moveOutChecklist.ts"

Deno.test("initMoveOutChecklist includes eight required items", () => {
  const checklist = initMoveOutChecklist()
  assertEquals(checklist.requiredCount, 8)
  assertEquals(checklist.allComplete, false)
})

Deno.test("initMoveOutChecklist after outreach marks notify items complete", () => {
  const checklist = initMoveOutChecklist(true)
  assertEquals(checklist.completeCount, 2)
})

Deno.test("parseMoveOutResidentReply recognizes confirm and vacated", () => {
  assertEquals(parseMoveOutResidentReply("YES"), "confirm_date")
  assertEquals(parseMoveOutResidentReply("moved out today"), "vacated")
  assertEquals(parseMoveOutResidentReply("what time is inspection?"), "question")
})

Deno.test("patchMoveOutChecklist marks keys returned", () => {
  const next = patchMoveOutChecklist(initMoveOutChecklist(), { keys_returned: true })
  const keys = next.items.find((item) => item.key === "keys_returned")
  assertEquals(keys?.complete, true)
})

Deno.test("readMoveOutChecklist restores flat metadata", () => {
  const state = readMoveOutChecklist({
    checklist: {
      resident_notified: true,
      instructions_delivered: true,
    },
  })
  assertEquals(state.completeCount, 2)
})

Deno.test("buildMoveOutDateConfirmPrompt includes formatted date", () => {
  const prompt = buildMoveOutDateConfirmPrompt("2026-08-15")
  assertEquals(prompt.includes("August"), true)
  assertEquals(prompt.includes("YES"), true)
})
