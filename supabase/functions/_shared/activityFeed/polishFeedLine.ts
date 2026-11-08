/**
 * Model-backed recovery for landlord activity-feed lines.
 * Deterministic draft first; gpt-6-luna rewrites into plain, concise copy when
 * available. Falls back to the draft if the model fails or drops protected facts.
 *
 * Prompting follows OpenAI Docs (GPT-6 family / Luna):
 * - Specify writing style explicitly (plain language, active voice, no lists)
 * - State the main point early; keep the task focused for Luna
 * - Put few-shot examples in the user message
 * https://developers.openai.com/api/docs/guides/latest-model
 */

const LUNA_MODEL = "gpt-6-luna"

const PROTECTED_TOKEN =
  /(\$[\d,]+(?:\.\d+)?|\bWO-[A-Z0-9]{4,}\b|\bREQ-[A-Z0-9]{4,}\b)/gi

export type PolishFeedLineInput = {
  draft: string
  /** Must remain in the rewrite (WO refs, amounts, street snippets). */
  mustKeep?: string[]
  skipLlm?: boolean
  fetchImpl?: typeof fetch
  openaiKey?: string | null
  timeoutMs?: number
}

export type PolishFeedLineResult = {
  line: string
  method: "deterministic" | "llm_polish"
}

function envKey(name: string): string {
  try {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any
    return (g.Deno?.env?.get?.(name) ?? g.process?.env?.[name] ?? "").trim()
  } catch {
    return ""
  }
}

function cleanLine(content: string | undefined): string | null {
  const text =
    content
      ?.trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  if (text.length < 8) return null
  // Reject markdown / lists — feed rows are one plain sentence.
  if (/^[-*•]\s|^\d+\.\s|\*\*|__/m.test(text)) return null
  return text.split("\n")[0]?.trim() ?? null
}

function protectedTokens(draft: string, mustKeep: string[]): string[] {
  const fromDraft = draft.match(PROTECTED_TOKEN) ?? []
  return [...new Set([...fromDraft, ...mustKeep.map((t) => t.trim()).filter(Boolean)])]
}

function preservesProtected(line: string, tokens: string[]): boolean {
  const lower = line.toLowerCase()
  for (const token of tokens) {
    if (!token) continue
    if (!lower.includes(token.toLowerCase())) return false
  }
  return true
}

/**
 * True when the deterministic draft still reads like internal/status copy and
 * should get a Luna rewrite when possible.
 */
export function needsFeedLineRecovery(draft: string): boolean {
  const text = draft.trim()
  if (!text) return false
  if (
    /\b(noted|logged|recorded|flagged|escalated this to you|attention alert|needs your attention)\b/i.test(
      text,
    )
  ) {
    return true
  }
  // Stiff “Told you …” / “Asked you to …:” stubs that still need a human rewrite.
  if (/^told you\b/i.test(text)) return true
  if (/^asked you to (pick|choose) a vendor:/i.test(text)) return true
  // Vendor names ending in By/And/Of before “never accepted”, or bare “never accepted”.
  if (/\b(by|and|of)\s+never accepted\b/i.test(text)) return true
  if (/\bnever accepted\b/i.test(text)) return true
  if (/^no acceptance from\b/i.test(text)) return true
  if (/ · /.test(text) && text.length > 70) return true
  return false
}

/** OpenAI Docs — style in system; few-shots + draft in user (prompt-engineering). */
const SYSTEM_PROMPT =
  "You rewrite one landlord activity-feed line for Ulo, a property management app. " +
  "Use plain, simple language: familiar words, concrete details, and precise verbs. " +
  "Prefer active voice and direct statements. State the main point early. " +
  "One short sentence only — no lists, no markdown, no bullet points, no quotes around the whole line. " +
  "Sound like a quick note from a property manager, not a system log. " +
  "Lead with what happened or what Ulo asked the landlord to do; keep work-order codes (WO-…), dollar amounts, and street names from the draft exactly. " +
  "Do not invent people, places, amounts, or outcomes. " +
  "Never use: Noted, Logged, Recorded, Flagged, escalated this to you, Needs Your Attention, attention alert. " +
  "Avoid stiff openers like “Told you …” or middle-dot stacks (·). " +
  "Return only the rewritten line."

const FEW_SHOTS = `Examples (rewrite the draft into a short, friendly line):
Draft: Told you No preferred vendor matched this request · The leaking kitchen faucet at 14 Maple Ave (WO-A1B2)
Rewritten: Asked you to pick a vendor for the leaking kitchen faucet at 14 Maple Ave (WO-A1B2) — no preferred match
Draft: Told you Handyman Services by Michael can't take the job at this property at 100 Disposable Test Lane (WO-C2C7)
Rewritten: Asked you to pick another vendor — Handyman Services by Michael can't take the job at 100 Disposable Test Lane (WO-C2C7)
Draft: Noted Ecosafe accepted WO-074B at 14 Maple Ave
Rewritten: Ecosafe accepted WO-074B at 14 Maple Ave
Draft: Asked you to choose a vendor: No preferred vendor matched · leaking faucet (WO-A1B2)
Rewritten: Asked you to pick a vendor for the leaking faucet (WO-A1B2) — no preferred match
Draft: Handyman Services By Michael never accepted — needs reassignment
Rewritten: Handyman Services By Michael still hasn't accepted — needs reassignment
Draft: No acceptance from Handyman Services By Michael. Choose a new vendor.
Rewritten: Still no acceptance from Handyman Services By Michael — choose a new vendor.`

async function polishWithLuna(
  apiKey: string,
  draft: string,
  mustKeep: string[],
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const keepBlock =
    mustKeep.length > 0
      ? `\nKeep these tokens exactly (do not drop or alter): ${mustKeep.join(", ")}`
      : ""
  const user = `${FEW_SHOTS}\n\nDraft:\n${draft}${keepBlock}\nRewritten:`

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
        max_completion_tokens: 120,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return cleanLine(data.choices?.[0]?.message?.content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Prefer a plain, concise landlord line. Uses gpt-6-luna when the draft still
 * looks robotic; otherwise returns the draft unchanged.
 */
export async function polishActivityFeedLine(
  input: PolishFeedLineInput,
): Promise<PolishFeedLineResult> {
  const draft = input.draft.replace(/\s+/g, " ").trim()
  if (!draft) return { line: "", method: "deterministic" }

  const mustKeep = protectedTokens(draft, input.mustKeep ?? [])
  if (input.skipLlm || !needsFeedLineRecovery(draft)) {
    return { line: draft, method: "deterministic" }
  }

  const apiKey = (input.openaiKey ?? envKey("OPENAI_API_KEY")).trim()
  if (!apiKey) return { line: draft, method: "deterministic" }

  const polished = await polishWithLuna(
    apiKey,
    draft,
    mustKeep,
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 4_000,
  )
  if (polished && preservesProtected(polished, mustKeep)) {
    return { line: polished, method: "llm_polish" }
  }
  return { line: draft, method: "deterministic" }
}
