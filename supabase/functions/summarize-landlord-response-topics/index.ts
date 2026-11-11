/**
 * POST summarize-landlord-response-topics
 * One sentence per text on the landlord thread that is still waiting for a reply.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"

const corsHeaders = adminEdgeCorsHeaders
const MODEL = "gpt-4o"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  // session-scoped: caller-supplied content
  const auth = await requireAdminReassignAuth(req, "[summarize-landlord-response-topics]")
  if (!auth.ok) return auth.response

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey) return jsonResponse({ error: "Missing OPENAI_API_KEY" }, 500)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const topics = Array.isArray(body.topics)
    ? body.topics.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : []
  if (topics.length === 0) return jsonResponse({ summaries: [] })
  if (topics.length > 80) return jsonResponse({ error: "Too many topics" }, 400)

  const prompt = [
    "Rewrite each property text as one short sentence a landlord can act on.",
    "Keep the same order and the same number of items.",
    "Merge nothing. Drop nothing.",
    "Plain English. No greeting. Do not say AI, workflow, or system.",
    'Return JSON: {"summaries":["..."]}',
    "",
    JSON.stringify(topics),
  ].join("\n")

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  })
  const data = (await aiResponse.json()) as Record<string, unknown>
  if (!aiResponse.ok) {
    const errObj = data.error as { message?: string } | undefined
    console.error("[summarize-landlord-response-topics]", aiResponse.status, errObj?.message)
    return jsonResponse({ error: "Could not summarize those texts" }, 502)
  }
  const choices = data.choices
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined
  const message = first?.message as Record<string, unknown> | undefined
  const content = typeof message?.content === "string" ? message.content : ""
  let summaries: string[] = []
  try {
    const parsed = JSON.parse(stripJsonFence(content)) as { summaries?: unknown }
    if (Array.isArray(parsed.summaries)) {
      summaries = parsed.summaries.map((line) => (typeof line === "string" ? line.trim() : ""))
    }
  } catch (err) {
    console.error("[summarize-landlord-response-topics] parse", err)
    return jsonResponse({ error: "Could not read the summaries" }, 502)
  }
  if (summaries.length !== topics.length || summaries.some((line) => !line)) {
    return jsonResponse({ error: "Summary count did not match" }, 502)
  }
  return jsonResponse({ summaries })
})
