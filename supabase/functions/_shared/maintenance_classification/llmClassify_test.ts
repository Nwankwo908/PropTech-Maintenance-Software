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

Deno.test("llmClassifyMaintenance returns null without an OpenAI key", async () => {
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "",
  })
  assertEqual(draft, null, "no keys → skip")
})

Deno.test("GPT-6 Luna success is interpretation-only and does not call Anthropic", async () => {
  let model = ""
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "sk-test",
    fetchImpl: async (url, init) => {
      const href = String(url)
      if (href.includes("anthropic.com")) throw new Error("anthropic called")
      model = JSON.parse(String(init?.body)).model
      return jsonResponse({
        choices: [{ message: { content: DRAFT_JSON } }],
      })
    },
  })
  assertEqual(model, "gpt-6-luna", "model")
  assertEqual(draft?.vendorTrade, "plumbing", "draft trade")
  assertEqual(draft?.provider, "gpt-6-luna", "provider")
})

Deno.test("invalid Luna JSON retries twice then returns null so rules still run", async () => {
  let calls = 0
  const draft = await llmClassifyMaintenance("Leaky faucet", "{}", null, {
    openaiKey: "sk-test",
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({
        choices: [{ message: { content: "not-json" } }],
      })
    },
  })
  assertEqual(calls, 2, "retried Luna")
  assertEqual(draft, null, "rules still run")
})

Deno.test("Luna HTTP failure returns null so rules still run", async () => {
  const raw = await fetchLlmClassificationJson({
    systemPrompt: "sys",
    userPrompt: "user",
    openaiKey: "sk-test",
    fetchImpl: async () => jsonResponse({ error: "down" }, 500),
  })
  assertEqual(raw, null, "null draft")
})
