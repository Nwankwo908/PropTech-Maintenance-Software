/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  chatCompletionFailureDetail,
  extractChatCompletionText,
} from "./openaiChatContent.ts"

Deno.test("extractChatCompletionText reads string content", () => {
  assertEquals(
    extractChatCompletionText({ content: ' {"ok":true} ' }),
    '{"ok":true}',
  )
})

Deno.test("extractChatCompletionText reads content parts array", () => {
  assertEquals(
    extractChatCompletionText({
      content: [{ type: "text", text: '{"a":1}' }],
    }),
    '{"a":1}',
  )
})

Deno.test("extractChatCompletionText falls back to refusal", () => {
  assertEquals(
    extractChatCompletionText({ content: null, refusal: "I can't analyze that." }),
    "I can't analyze that.",
  )
})

Deno.test("chatCompletionFailureDetail includes finish_reason", () => {
  assertEquals(
    chatCompletionFailureDetail({
      choices: [{ finish_reason: "content_filter", message: { content: "" } }],
    }),
    "finish_reason=content_filter",
  )
})
