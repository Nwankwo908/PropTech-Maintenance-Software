/**
 * AI-backed maintenance request summary (gpt-6-luna) with fact validation.
 * Falls back to shared deterministic summarization when the model fails or
 * invents unsupported details.
 */
import {
  extractMaintenanceRequestFacts,
  formatPersistedDescription,
  summarizeMaintenanceRequestDeterministic,
  validateSummaryAgainstFacts,
  type MaintenanceRequestSummary,
} from "../../../shared/maintenance/maintenanceRequestFacts.ts"

const LUNA_MODEL = "gpt-6-luna"

function envKey(name: string): string {
  try {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any
    return (g.Deno?.env?.get?.(name) ?? g.process?.env?.[name] ?? "").trim()
  } catch {
    return ""
  }
}

export type SummarizeMaintenanceRequestOptions = {
  category?: string | null
  /** Injected for tests. */
  fetchImpl?: typeof fetch
  openaiKey?: string | null
  skipLlm?: boolean
  timeoutMs?: number
}

async function polishWithLuna(
  apiKey: string,
  factsJson: string,
  authoredText: string,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<{ title: string; location: string | null; description: string } | null> {
  const system =
    "You summarize residential maintenance requests for property managers and vendors. " +
    "Use ONLY the provided confirmed facts and resident-authored text. " +
    "Return JSON with keys title, location, description. " +
    "title: short specific noun phrase (never a trade label like Plumbing issue). " +
    "location: physical place only (e.g. Basement) — do not include the floor served. " +
    "description: 1–2 natural sentences. Attribute suspected causes and replacement needs to the tenant (The tenant reports…). " +
    "If equipment serves a different floor than its physical location, say so (e.g. basement heater serving the first floor). " +
    "Remove greetings and repetition. Do not invent rooms, equipment, or symptoms."

  const user =
    `Confirmed facts (JSON):\n${factsJson}\n\nResident-authored text:\n${authoredText}\n\n` +
    `Return JSON only.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LUNA_MODEL,
        reasoning_effort: "none",
        max_completion_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content?.trim() ?? ""
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    const parsed = JSON.parse(json) as Record<string, unknown>
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      location: typeof parsed.location === "string" ? parsed.location : null,
      description: typeof parsed.description === "string" ? parsed.description : "",
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Summarize a maintenance request. Prefer Luna polish validated against
 * extracted facts; otherwise deterministic fallback.
 */
export async function summarizeMaintenanceRequest(
  rawDescription: string,
  opts: SummarizeMaintenanceRequestOptions = {},
): Promise<MaintenanceRequestSummary> {
  const fallback = summarizeMaintenanceRequestDeterministic(rawDescription, {
    category: opts.category,
  })
  if (opts.skipLlm) return fallback

  const apiKey = (opts.openaiKey ?? envKey("OPENAI_API_KEY")).trim()
  if (!apiKey) return { ...fallback, source: "fallback" }

  const facts = extractMaintenanceRequestFacts(rawDescription, {
    category: opts.category,
  })
  const factsJson = JSON.stringify({
    equipment: facts.equipment,
    physicalLocation: facts.physicalLocation,
    servesFloor: facts.servesFloor,
    symptoms: facts.symptoms,
    reportedCondition: facts.reportedCondition,
    needsClarification: facts.needsClarification,
  })

  const polished = await polishWithLuna(
    apiKey,
    factsJson,
    facts.authoredText || rawDescription.slice(0, 2000),
    opts.fetchImpl ?? fetch,
    opts.timeoutMs ?? 8000,
  )
  if (!polished) return { ...fallback, source: "fallback" }

  const validated = validateSummaryAgainstFacts(polished, facts)
  if (!validated.ok) {
    console.warn(
      "[maintenanceRequestSummary] llm rejected:",
      validated.reason,
      "— using deterministic fallback",
    )
    return { ...fallback, source: "fallback" }
  }

  return {
    title: validated.title,
    location: validated.location,
    description: validated.description,
    facts,
    source: "llm",
  }
}

export { formatPersistedDescription, summarizeMaintenanceRequestDeterministic }
