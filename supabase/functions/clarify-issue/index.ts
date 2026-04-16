import { serve } from "https://deno.land/std/http/server.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const { description } = await req.json()

    if (!description || typeof description !== "string") {
      return jsonResponse({ error: "Missing description" }, 400)
    }

    const prompt = `
You are a property maintenance assistant.

Categorize and structure this issue.

Possible categories:
- Plumbing
- Appliances
- Household
- Electrical
- Pest Control
- Outside/Exterior House
- Other

Also set SLA fields (for routing only — do NOT return time estimates or minutes):
- "issue_category": one of "plumbing", "electrical", "appliance", "other" (infer from the issue; map Appliances→appliance, Electrical→electrical, Plumbing→plumbing, else→other)
- "severity": one of "low", "normal", "urgent" (independent of resident-stated urgency when needed)

Return ONLY JSON:

{
  "issueType": "",
  "issue_category": "",
  "severity": "",
  "room": "",
  "appliance": "",
  "urgency": "low | normal | urgent",
  "normalizedSummary": "",
  "questions": []
}

Issue: "${description}"
`

    const apiKey = Deno.env.get("OPENAI_API_KEY")
    if (!apiKey?.trim()) {
      return jsonResponse(
        { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
        500,
      )
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    })

    const data = (await aiResponse.json()) as Record<string, unknown>

    if (!aiResponse.ok) {
      const errObj = data?.error as { message?: string } | undefined
      const msg =
        typeof errObj?.message === "string"
          ? errObj.message
          : `OpenAI request failed (${aiResponse.status})`
      return jsonResponse({ error: msg }, 502)
    }

    const choices = data?.choices as unknown
    const first =
      Array.isArray(choices) && choices.length > 0
        ? (choices[0] as Record<string, unknown>)
        : null
    const message = first?.message as Record<string, unknown> | undefined
    const content = message?.content

    if (typeof content !== "string" || !content.trim()) {
      return jsonResponse({ error: "Invalid model response" }, 502)
    }

    const text = stripJsonFence(content)

    let parsed: Record<string, unknown>

    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      parsed = {
        issueType: "Other",
        issue_category: "other",
        severity: "normal",
        room: null,
        appliance: null,
        urgency: "normal",
        normalizedSummary: description,
        questions: [],
      }
    }

    return jsonResponse({
      parsed,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      aiSummary: null,
    })
  } catch {
    return jsonResponse({ error: "Server error" }, 500)
  }
})
