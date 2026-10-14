/**
 * Interpretation-only LLM transport for maintenance classification.
 * Returns raw JSON text. Never decides trade, urgency, photo, or matching.
 */
/** `claude-haiku-5-5` remains for drafts stored before this path moved to Luna. */
export type LlmDraftProvider = "claude-haiku-5-5" | "gpt-6-luna"

export type LlmClassifyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

const LUNA_MODEL = "gpt-6-luna"
const MAX_TOKENS = 1024
const PRIMARY_ATTEMPTS = 2

export type FetchLlmClassificationJsonInput = {
  systemPrompt: string
  userPrompt: string
  fetchImpl?: LlmClassifyFetch
  openaiKey?: string | null
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

/**
 * GPT-6 Luna only. Returns null when both attempts fail — caller uses rules.
 */
export async function fetchLlmClassificationJson(
  input: FetchLlmClassificationJsonInput,
): Promise<{ content: string; provider: LlmDraftProvider } | null> {
  const openaiKey = input.openaiKey?.trim() ?? ""
  if (!openaiKey) return null

  const fetcher = doFetch(input.fetchImpl)
  const signal = input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined
  let lastError: unknown = null

  for (let attempt = 1; attempt <= PRIMARY_ATTEMPTS; attempt++) {
    try {
      const content = await completeOpenAI(
        fetcher,
        openaiKey,
        input.systemPrompt,
        input.userPrompt,
        signal,
      )
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
