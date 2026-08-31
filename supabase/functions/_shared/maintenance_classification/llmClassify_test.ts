/// <reference lib="deno.ns" />

import {
  llmClassifyMaintenance,
  parseLlmClassificationDraft,
} from "./llmClassify.ts"
import { fetchLlmClassificationJson } from "./llmClassifyProvider.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const DRAFT_JSON = JSON.stringify({
  vendor_trade: "plumbing",
  issue_type: "leak",
  severity: "normal",
  confidence: 0.91,
  reasoning: "named faucet",
})

Deno.test("parseLlmClassificationDraft maps vendor_trade, not landlord STRUCTURAL", () => {
  const plumbing = parseLlmClassificationDraft(DRAFT_JSON)
  assertEqual(plumbing?.vendorTrade, "plumbing", "trade")
  assertEqual(plumbing?.issueType, "leak", "issue")
  assertEqual(plumbing?.confidence, 0.91, "confidence")

  const structural = parseLlmClassificationDraft(
    JSON.stringify({
      vendor_trade: "structural",
      issue_type: "general",
      severity: "normal",
      confidence: 0.8,
      reasoning: "wall",
    }),
  )
  assertEqual(structural?.vendorTrade, null, "structural is not a vendor trade")

  const landlordShaped = parseLlmClassificationDraft(
    JSON.stringify({
      trade: "STRUCTURAL",
      urgency: "MEDIUM",
      confidence: "HIGH",
    }),
  )
  assertEqual(landlordShaped?.vendorTrade, null, "envelope trade is ignored")
})

Deno.test("llmClassifyMaintenance returns null without OpenAI key", async () => {
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "",
    anthropicKey: "sk-ant-test",
  })
  assertEqual(draft, null, "no openai → skip, even if Anthropic is set")
})

Deno.test("OpenAI JSON mode success is interpretation-only", async () => {
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "sk-test",
    fetchImpl: async () =>
      jsonResponse({
        choices: [{ message: { content: DRAFT_JSON } }],
      }),
  })
  assertEqual(draft?.vendorTrade, "plumbing", "draft trade")
  assertEqual(draft?.provider, "gpt-4o-mini", "provider")
})

Deno.test("invalid OpenAI JSON retries then falls back to Anthropic", async () => {
  let openaiCalls = 0
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "sk-test",
    anthropicKey: "sk-ant-test",
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes("openai.com")) {
        openaiCalls += 1
        return jsonResponse({
          choices: [{ message: { content: "not-json" } }],
        })
      }
      return jsonResponse({
        content: [{ type: "text", text: DRAFT_JSON }],
      })
    },
  })
  assertEqual(openaiCalls, 2, "retried OpenAI")
  assertEqual(draft?.provider, "claude-haiku", "fallback")
  assertEqual(draft?.vendorTrade, "plumbing", "parsed fallback")
})

Deno.test("OpenAI failure without Anthropic returns null so rules still run", async () => {
  const raw = await fetchLlmClassificationJson({
    systemPrompt: "sys",
    userPrompt: "user",
    openaiKey: "sk-test",
    anthropicKey: "",
    fetchImpl: async () => jsonResponse({ error: "down" }, 500),
  })
  assertEqual(raw, null, "null draft")
})
