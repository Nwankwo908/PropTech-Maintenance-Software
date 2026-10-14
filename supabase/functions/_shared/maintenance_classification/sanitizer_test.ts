/// <reference lib="deno.ns" />

import { sanitizeMaintenanceDescription } from "./sanitizer.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test("sanitizer polish calls gpt-6-luna and keeps deterministic text when Luna fails", async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; model: string }> = []
  Deno.env.set("OPENAI_API_KEY", "test-key")
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes("anthropic.com")) throw new Error("anthropic called")
      const model = JSON.parse(String(init?.body)).model as string
      calls.push({ url: href, model })
      return new Response(JSON.stringify({ choices: [{ message: { content: "The faucet has been leaking." } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    const polished = await sanitizeMaintenanceDescription("faucet leakin")
    assertEqual(calls.length, 1, "one call")
    assertEqual(calls[0].url.includes("api.openai.com/v1/chat/completions"), true, "openai url")
    assertEqual(calls[0].model, "gpt-6-luna", "model")
    assertEqual(polished.method, "llm_polish", "polished")

    globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch
    const failed = await sanitizeMaintenanceDescription("faucet leakin")
    assertEqual(failed.method, "deterministic", "rules remain")
    assertEqual(failed.sanitized.toLowerCase().includes("faucet"), true, "kept the fixture")
  } finally {
    globalThis.fetch = original
    Deno.env.delete("OPENAI_API_KEY")
  }
})
