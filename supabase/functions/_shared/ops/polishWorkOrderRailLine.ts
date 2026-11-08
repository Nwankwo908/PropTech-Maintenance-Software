/**
 * Model-backed recovery for Active Tasks work-order Overview / next-step lines.
 * Deterministic draft first; gpt-6-luna rewrites into plain landlord copy when
 * the draft still sounds robotic or grammatically awkward with vendor names.
 *
 * Prompting follows OpenAI Docs (GPT-6 family / Luna) via shared recovery prompts.
 */
import {
  needsWorkOrderRailLineRecovery,
  WORK_ORDER_RAIL_POLISH_FEW_SHOTS,
  WORK_ORDER_RAIL_POLISH_SYSTEM,
} from "../../../../shared/ops/workOrderRailLineRecovery.ts"

const LUNA_MODEL = "gpt-6-luna"

export type PolishWorkOrderRailLineInput = {
  draft: string
  mustKeep?: string[]
  skipLlm?: boolean
  fetchImpl?: typeof fetch
  openaiKey?: string | null
  timeoutMs?: number
}

export type PolishWorkOrderRailLineResult = {
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
  if (/^[-*•]\s|^\d+\.\s|\*\*|__/m.test(text)) return null
  return text.split("\n")[0]?.trim() ?? null
}

function preservesProtected(line: string, tokens: string[]): boolean {
  const lower = line.toLowerCase()
  for (const token of tokens) {
    if (!token) continue
    if (!lower.includes(token.toLowerCase())) return false
  }
  return true
}

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
  const user = `${WORK_ORDER_RAIL_POLISH_FEW_SHOTS}\n\nDraft:\n${draft}${keepBlock}\nRewritten:`

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
          { role: "system", content: WORK_ORDER_RAIL_POLISH_SYSTEM },
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

export { needsWorkOrderRailLineRecovery }

/**
 * Prefer a plain, landlord-friendly work-order rail line. Uses gpt-6-luna when
 * the draft still looks robotic; otherwise returns the draft unchanged.
 */
export async function polishWorkOrderRailLine(
  input: PolishWorkOrderRailLineInput,
): Promise<PolishWorkOrderRailLineResult> {
  const draft = input.draft.replace(/\s+/g, " ").trim()
  if (!draft) return { line: "", method: "deterministic" }

  const mustKeep = [...new Set((input.mustKeep ?? []).map((t) => t.trim()).filter(Boolean))]
  if (input.skipLlm || !needsWorkOrderRailLineRecovery(draft)) {
    return { line: draft, method: "deterministic" }
  }

  const apiKey = (input.openaiKey ?? envKey("OPENAI_API_KEY")).trim()
  if (!apiKey) return { line: draft, method: "deterministic" }

  const polished = await polishWithLuna(
    apiKey,
    draft,
    mustKeep,
    input.fetchImpl ?? fetch,
    input.timeoutMs ?? 3_500,
  )
  if (polished && preservesProtected(polished, mustKeep)) {
    return { line: polished, method: "llm_polish" }
  }
  return { line: draft, method: "deterministic" }
}
