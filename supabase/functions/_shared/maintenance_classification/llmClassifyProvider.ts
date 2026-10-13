/**
 * Interpretation-only LLM transport for maintenance classification.
 * Returns raw JSON text. Never decides trade, urgency, photo, or matching.
 */
export type LlmDraftProvider = "claude-haiku-5-5" | "gpt-6-luna"

export type LlmClassifyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

const HAIKU_MODEL = "claude-haiku-5-5"
const LUNA_MODEL = "gpt-6-luna"
const MAX_TOKENS = 1024
const PRIMARY_ATTEMPTS = 2

export type FetchLlmClassificationJsonInput = {
  systemPrompt: string
  userPrompt: string
  fetchImpl?: LlmClassifyFetch
  openaiKey?: string | null
  anthropicKey?: string | null
  timeoutMs?: number
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
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LUNA_MODEL,
      reasoning_effort: "none",
      max_completion_tokens: MAX_TOKENS,
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
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: MAX_TOKENS,
      // Haiku 5.5 rejects temperature other than 1. Low effort keeps this
      // classification call from spending the token budget on thinking.
      output_config: { effort: "low" },
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
  const block = data.content?.find((part) => part.type === "text")
  const content = stripJsonFences((block?.text ?? "").trim())
  if (!content || !looksLikeJsonObject(content)) {
    throw new Error("anthropic_invalid_json")
  }
  return content
}

/**
 * Claude Haiku 5.5 first (retry on parse/HTTP failure), then GPT-6 Luna.
 * Returns null when every configured attempt fails — caller uses rules.
 */
export async function fetchLlmClassificationJson(
  input: FetchLlmClassificationJsonInput,
): Promise<{ content: string; provider: LlmDraftProvider } | null> {
  const anthropicKey = input.anthropicKey?.trim() ?? ""
  const openaiKey = input.openaiKey?.trim() ?? ""
  if (!anthropicKey && !openaiKey) return null

  const fetcher = doFetch(input.fetchImpl)
  const signal = input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined
  let lastError: unknown = null

  if (anthropicKey) {
    for (let attempt = 1; attempt <= PRIMARY_ATTEMPTS; attempt++) {
      try {
        const content = await completeAnthropic(
          fetcher,
          anthropicKey,
          input.systemPrompt,
          input.userPrompt,
          signal,
        )
        return { content, provider: "claude-haiku-5-5" }
      } catch (err) {
        lastError = err
        console.error("[maintenance-classify] Haiku draft attempt failed", {
          attempt,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  if (!openaiKey) {
    console.error("[maintenance-classify] Haiku draft failed; no GPT-6 Luna fallback", lastError)
    return null
  }

  for (let attempt = 1; attempt <= PRIMARY_ATTEMPTS; attempt++) {
    try {
      const content = await completeOpenAI(
        fetcher,
        openaiKey,
        input.systemPrompt,
        input.userPrompt,
        signal,
      )
      if (anthropicKey) {
        console.error("[maintenance-classify] Haiku triage failed, falling back to GPT-6 Luna")
      }
      return { content, provider: "gpt-6-luna" }
    } catch (err) {
      lastError = err
      console.error("[maintenance-classify] GPT-6 Luna draft attempt failed", {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.error("[maintenance-classify] classification draft failed", lastError)
  return null
}
