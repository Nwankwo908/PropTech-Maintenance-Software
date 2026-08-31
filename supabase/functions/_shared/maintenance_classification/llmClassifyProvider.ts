/**
 * Interpretation-only LLM transport for maintenance classification.
 * Returns raw JSON text. Never decides trade, urgency, photo, or matching.
 */
export type LlmDraftProvider = "gpt-4o-mini" | "claude-haiku"

export type LlmClassifyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

const OPENAI_MODEL = "gpt-4o-mini"
const ANTHROPIC_MODEL = "claude-3-5-haiku-20241022"
const MAX_TOKENS = 300
const OPENAI_ATTEMPTS = 2

export type FetchLlmClassificationJsonInput = {
  systemPrompt: string
  userPrompt: string
  fetchImpl?: LlmClassifyFetch
  openaiKey?: string | null
  anthropicKey?: string | null
}

function doFetch(
  fetchImpl: LlmClassifyFetch | undefined,
): LlmClassifyFetch {
  return fetchImpl ?? fetch
}

function stripJsonFences(raw: string): string {
  return raw.replace(/```json|```/g, "").trim()
}

function looksLikeJsonObject(raw: string): boolean {
  const t = stripJsonFences(raw)
  return t.startsWith("{") && t.endsWith("}")
}

async function completeOpenAI(
  fetcher: LlmClassifyFetch,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`openai_http_${res.status} ${errText.slice(0, 180)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = stripJsonFences(data.choices?.[0]?.message?.content?.trim() ?? "")
  if (!content || !looksLikeJsonObject(content)) {
    throw new Error("openai_invalid_json")
  }
  return content
}

async function completeAnthropic(
  fetcher: LlmClassifyFetch,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`anthropic_http_${res.status} ${errText.slice(0, 180)}`)
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const block = data.content?.[0]
  const content = stripJsonFences(
    block?.type === "text" ? (block.text ?? "").trim() : "",
  )
  if (!content || !looksLikeJsonObject(content)) {
    throw new Error("anthropic_invalid_json")
  }
  return content
}

/**
 * OpenAI JSON mode first (retry on parse/HTTP failure), then optional Anthropic.
 * Returns null when OpenAI is unset or every attempt fails — caller uses rules.
 */
export async function fetchLlmClassificationJson(
  input: FetchLlmClassificationJsonInput,
): Promise<{ content: string; provider: LlmDraftProvider } | null> {
  const openaiKey = input.openaiKey?.trim() ?? ""
  if (!openaiKey) return null

  const fetcher = doFetch(input.fetchImpl)
  let lastError: unknown = null

  for (let attempt = 1; attempt <= OPENAI_ATTEMPTS; attempt++) {
    try {
      const content = await completeOpenAI(
        fetcher,
        openaiKey,
        input.systemPrompt,
        input.userPrompt,
      )
      return { content, provider: "gpt-4o-mini" }
    } catch (err) {
      lastError = err
      console.error("[maintenance-classify] OpenAI draft attempt failed", {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const anthropicKey = input.anthropicKey?.trim() ?? ""
  if (!anthropicKey) {
    console.error("[maintenance-classify] OpenAI draft failed; no Anthropic fallback", lastError)
    return null
  }

  try {
    const content = await completeAnthropic(
      fetcher,
      anthropicKey,
      input.systemPrompt,
      input.userPrompt,
    )
    console.error("[maintenance-classify] OpenAI triage failed, falling back to Anthropic")
    return { content, provider: "claude-haiku" }
  } catch (err) {
    console.error("[maintenance-classify] Anthropic draft failed", err)
    return null
  }
}
