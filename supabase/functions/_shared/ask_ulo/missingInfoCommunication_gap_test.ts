/**
 * Gap-answer copy must match capability (not always late rent).
 */
/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  incompleteResidentSubjectAnswer,
  incompleteSubjectGapAnswer,
} from "./missingInfoCommunication.ts"

Deno.test("resident gap: message non-response does not mention late rent", () => {
  const text = incompleteResidentSubjectAnswer({
    residentFilter: "message_nonresponse",
  })
  assertStringIncludes(text.toLowerCase(), "replied")
  assertEquals(/\blate on rent\b/i.test(text), false)
})

Deno.test("resident gap: move-in does not mention late rent", () => {
  const text = incompleteSubjectGapAnswer({
    subject: "resident",
    residentFilter: "move_in",
  })
  assertStringIncludes(text.toLowerCase(), "move-in")
  assertEquals(/\blate on rent\b/i.test(text), false)
})

Deno.test("resident gap: default still late rent", () => {
  const text = incompleteResidentSubjectAnswer()
  assertStringIncludes(text.toLowerCase(), "late on rent")
})

Deno.test("honest gap: weather alerts name weather, not vendor progress", () => {
  const text = incompleteSubjectGapAnswer({
    subject: "other",
    question: "Are there any weather alerts that could affect my properties?",
  })
  assertStringIncludes(text.toLowerCase(), "weather")
  assertEquals(/\bspecifically about other\b/i.test(text), false)
  assertEquals(/\bvendor progress\b/i.test(text), false)
})

Deno.test("honest gap: grants fallback names incentives, not vendor progress", () => {
  const text = incompleteSubjectGapAnswer({
    subject: "incentives",
    question: "What grants or tax incentives are available for landlords?",
  })
  assertStringIncludes(text.toLowerCase(), "grant")
  assertEquals(/\bspecifically about\b/i.test(text), false)
  assertEquals(/\bvendor progress\b/i.test(text), false)
})
