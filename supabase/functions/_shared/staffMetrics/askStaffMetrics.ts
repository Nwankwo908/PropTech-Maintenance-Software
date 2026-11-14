/**
 * Ask Ulo staff mode: answer a staff question using only public.get_staff_metrics.
 *
 * Access is enforced by the database. We call the RPC with the caller's own
 * access token, so is_platform_staff() runs against their JWT and refuses
 * landlord accounts. No service-role key is used and no landlord rows are read.
 *
 * The AI only rewords numbers it is given. Any number in its answer that is not
 * in the metrics (or the question) sends the response back to the rules answer.
 */
import {
  fallbackStaffMetricsAnswer,
  matchStaffMetrics,
  staffMetricFacts,
} from "../../../../shared/staffMetrics/catalog.ts"
import { withAiDeadline } from "../ai/deadline.ts"
import { observeAiJson, type AiTelemetrySink } from "../ai/telemetry.ts"

export const STAFF_METRICS_ANSWER_MODEL = "gpt-6-luna"
export const STAFF_QUESTION_MAX_LENGTH = 500
const ALLOWED_WINDOWS = new Set([7, 30, 90])

type Runtime = {
  env: (name: string) => string | undefined
  fetch: typeof fetch
  telemetry?: AiTelemetrySink
}

export type StaffMetricsRequest = {
  question: string
  days: number
  includeDemo: boolean
}

export type StaffMetricsResult =
  | { status: 200; body: { answer: string; source: "ai" | "rules"; metricPaths: string[] } }
  | { status: 400 | 401 | 403 | 503; body: { error: string } }

export function parseStaffMetricsRequest(value: unknown): StaffMetricsRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const question = typeof raw.question === "string" ? raw.question.trim() : ""
  if (!question || question.length > STAFF_QUESTION_MAX_LENGTH) return null
  const days = typeof raw.days === "number" && ALLOWED_WINDOWS.has(raw.days) ? raw.days : 30
  return { question, days, includeDemo: raw.includeDemo === true }
}

export function callerAccessToken(request: Request): string | null {
  const explicit = request.headers.get("x-ulo-access-token")?.trim()
  if (explicit) return explicit
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization")?.trim() ?? "")?.[1]
  return bearer ?? null
}

/** Load metrics as the caller. 401/403 from PostgREST means "not staff". */
export async function loadStaffMetricsAsCaller(
  token: string,
  input: Pick<StaffMetricsRequest, "days" | "includeDemo">,
  runtime: Runtime,
): Promise<{ ok: true; metrics: Record<string, unknown> } | { ok: false; status: 403 | 503 }> {
  const base = runtime.env("SUPABASE_URL")?.trim().replace(/\/$/, "")
  const anon = runtime.env("SUPABASE_ANON_KEY")?.trim()
  if (!base || !anon) return { ok: false, status: 503 }
  try {
    const response = await runtime.fetch(`${base}/rest/v1/rpc/get_staff_metrics`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_days: input.days, p_include_demo: input.includeDemo }),
    })
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      return { ok: false, status: 403 }
    }
    if (!response.ok) {
      await response.body?.cancel()
      return { ok: false, status: 503 }
    }
    const data: unknown = await response.json()
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, status: 503 }
    return { ok: true, metrics: data as Record<string, unknown> }
  } catch {
    return { ok: false, status: 503 }
  }
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => {
    const plain = n.replace(/,/g, "")
    return String(Number(plain))
  })
}

/** True when every number in the answer appears in the metrics or the question. */
export function answerUsesOnlyKnownNumbers(answer: string, allowedSources: string[]): boolean {
  const allowed = new Set(allowedSources.flatMap(numbersIn))
  return numbersIn(answer).every((n) => allowed.has(n))
}

export function buildStaffMetricsPrompt(
  question: string,
  metrics: Record<string, unknown>,
  days: number,
): { system: string; user: string; factLines: string[] } {
  const focus = new Set(matchStaffMetrics(question, 8).map((metric) => metric.path))
  const facts = staffMetricFacts(metrics)
  const ordered = [...facts.filter((f) => focus.has(f.path)), ...facts.filter((f) => !focus.has(f.path))]
  const factLines = ordered.map((fact) =>
    `- ${fact.label} [${fact.snapshot ? "right now" : `last ${days} days`}] = ${fact.value} — ${fact.definition}`
  )
  const maintenance = metrics.maintenance as Record<string, unknown> | undefined
  const extras = JSON.stringify({
    by_trade: maintenance?.by_trade ?? [],
    weekly_created_completed: maintenance?.weekly ?? [],
  })
  const system = [
    "You answer questions from Ulo staff about company-wide operating metrics.",
    "Use ONLY the metrics provided. Never estimate, extrapolate or invent a number.",
    "Copy numbers exactly as written in the metrics. Do not add, subtract or compute new numbers.",
    "Name each metric you use in bold and say whether it is 'right now' or for the time window.",
    "If the metrics cannot answer the question, say so in one sentence and name the closest metrics.",
    "Keep answers under 120 words. Use short bullets when giving more than one number.",
  ].join(" ")
  const user = [
    `Question: ${question}`,
    "",
    `Metrics (most relevant first; window = last ${days} days):`,
    ...factLines,
    "",
    `Work orders by trade and per week (JSON): ${extras}`,
  ].join("\n")
  return { system, user, factLines: [...factLines, extras] }
}

export async function answerStaffMetricsQuestion(
  request: Request,
  body: unknown,
  runtime: Runtime = { env: (name) => Deno.env.get(name), fetch },
): Promise<StaffMetricsResult> {
  const input = parseStaffMetricsRequest(body)
  if (!input) {
    return { status: 400, body: { error: `Ask a question up to ${STAFF_QUESTION_MAX_LENGTH} characters.` } }
  }
  const token = callerAccessToken(request)
  if (!token) return { status: 401, body: { error: "Sign in required" } }

  const loaded = await loadStaffMetricsAsCaller(token, input, runtime)
  if (!loaded.ok) {
    return loaded.status === 403
      ? { status: 403, body: { error: "Platform staff access required" } }
      : { status: 503, body: { error: "Staff metrics are temporarily unavailable" } }
  }

  const metricPaths = matchStaffMetrics(input.question).map((metric) => metric.path)
  const rules = () => ({
    status: 200 as const,
    body: {
      answer: fallbackStaffMetricsAnswer(input.question, loaded.metrics, input.days),
      source: "rules" as const,
      metricPaths,
    },
  })

  const apiKey = runtime.env("OPENAI_API_KEY")?.trim()
  if (!apiKey) return rules()

  const prompt = buildStaffMetricsPrompt(input.question, loaded.metrics, input.days)
  try {
    const { response, data } = await withAiDeadline(10_000, (signal) =>
      observeAiJson<{ choices?: Array<{ message?: { content?: string } }> }>(
        {
          traceId: crypto.randomUUID(),
          operation: "ask_ulo.staff_metrics",
          model: STAFF_METRICS_ANSWER_MODEL,
          attempt: 1,
        },
        () =>
          runtime.fetch("https://api.openai.com/v1/chat/completions", {
            signal,
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: STAFF_METRICS_ANSWER_MODEL,
              reasoning_effort: "none",
              max_completion_tokens: 500,
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
            }),
          }),
        (value) => Boolean(value?.choices?.[0]?.message?.content?.trim()),
        runtime.telemetry,
      )
    )
    const text = data?.choices?.[0]?.message?.content?.trim()
    if (!response.ok || !text) return rules()
    if (!answerUsesOnlyKnownNumbers(text, [...prompt.factLines, input.question, String(input.days)])) {
      return rules()
    }
    return { status: 200, body: { answer: text, source: "ai", metricPaths } }
  } catch {
    return rules()
  }
}
