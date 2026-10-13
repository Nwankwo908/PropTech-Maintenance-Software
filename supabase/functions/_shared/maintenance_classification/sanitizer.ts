/**
 * Text sanitizer — normalize resident wording without inventing facts.
 * Prefer deterministic cleanup; optional Haiku 5.5 polish, then GPT-6 Luna.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\b(u)\b/gi, "you"],
  [/\b(ur)\b/gi, "your"],
  [/\b(pls|plz)\b/gi, "please"],
  [/\b(thx|ty)\b/gi, "thank you"],
  [/\b(nite)\b/gi, "night"],
  [/\b(tmrw|tmr|tomm?orrow)\b/gi, "tomorrow"],
  [/\b(bc|cuz|cause)\b/gi, "because"],
  [/\b(w\/)\b/gi, "with "],
  [/\b(wont)\b/gi, "won't"],
  [/\b(cant)\b/gi, "can't"],
  [/\b(dont)\b/gi, "don't"],
  [/\b(im)\b/gi, "I'm"],
  [/\b(ive)\b/gi, "I've"],
  [/\b(idk)\b/gi, "I don't know"],
  [/\b(ac)\b/gi, "AC"],
  [/\b(hvac)\b/gi, "HVAC"],
  [/\b(appt)\b/gi, "apartment"],
  [/\b(apt)\b/gi, "apartment"],
  [/\b(bath)\b/gi, "bathroom"],
  [/\b(kit)\b/gi, "kitchen"],
]

const SLANG: Array<[RegExp, string]> = [
  [/\bdrippin'?g?\b/gi, "dripping"],
  [/\bleakin'?g?\b/gi, "leaking"],
  [/\bbusted\b/gi, "broken"],
  [/\bbroke\b/gi, "broken"],
  [/\bain'?t\b/gi, "is not"],
  [/\bgonna\b/gi, "going to"],
  [/\bwanna\b/gi, "want to"],
  [/\bkinda\b/gi, "kind of"],
  [/\blot of water\b/gi, "a lot of water"],
  [/\btap\b/gi, "faucet"],
]

function titleSentence(s: string): string {
  const t = s.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Deterministic sanitize — always available, never invents facts. */
export function sanitizeDescriptionDeterministic(raw: string): string {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""

  for (const [re, to] of ABBREVIATIONS) text = text.replace(re, to)
  for (const [re, to] of SLANG) text = text.replace(re, to)

  // Common typo fragments (conservative)
  text = text
    .replace(/\blst\b/gi, "last")
    .replace(/\bbecn\b/gi, "been")
    .replace(/\bwatr\b/gi, "water")
    .replace(/\bfawcet\b/gi, "faucet")
    .replace(/\bfaucett?\b/gi, "faucet")
    .replace(/\bsinc\b/gi, "since")
    .replace(/\beverywere\b/gi, "everywhere")

  text = text.replace(/\s+/g, " ").trim()
  // Ensure ending punctuation for downstream readability
  if (text && !/[.!?]$/.test(text)) text = `${text}.`
  return titleSentence(text)
}

async function polishWithLlm(normalized: string, raw: string): Promise<string | null> {
  const anthropicKey = envKey("ANTHROPIC_API_KEY")
  const openaiKey = envKey("OPENAI_API_KEY")
  if ((!anthropicKey && !openaiKey) || !normalized) return null

  const system =
    "Rewrite the resident maintenance description into clear, standard English. " +
    "Fix typos and expand obvious abbreviations. Preserve meaning exactly. " +
    "Do not invent rooms, fixtures, or facts not present. Return only the rewritten sentence(s)."
  const user = `Raw: ${raw}\nDraft: ${normalized}`

  if (anthropicKey) {
    const polished = await polishWithHaiku(anthropicKey, system, user)
    if (polished) return polished
  }
  if (openaiKey) return polishWithLuna(openaiKey, system, user)
  return null
}

function envKey(name: string): string {
  try {
    return Deno.env.get(name)?.trim() ?? ""
  } catch {
    return ""
  }
}

function cleanPolish(content: string | undefined): string | null {
  const text = content?.trim().replace(/^["']|["']$/g, "").trim() ?? ""
  if (text.length < 3) return null
  return text
}

async function polishWithHaiku(
  apiKey: string,
  system: string,
  user: string,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 400,
        output_config: { effort: "low" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const block = data.content?.find((part) => part.type === "text")
    return cleanPolish(block?.text)
  } catch {
    return null
  }
}

async function polishWithLuna(
  apiKey: string,
  system: string,
  user: string,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning_effort: "none",
        max_completion_tokens: 400,
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
    return cleanPolish(data.choices?.[0]?.message?.content)
  } catch {
    return null
  }
}

export async function sanitizeMaintenanceDescription(
  raw: string,
  opts?: { skipLlm?: boolean },
): Promise<{ sanitized: string; method: "deterministic" | "llm_polish" }> {
  const deterministic = sanitizeDescriptionDeterministic(raw)
  if (opts?.skipLlm) {
    return { sanitized: deterministic, method: "deterministic" }
  }
  const polished = await polishWithLlm(deterministic, raw)
  if (polished) {
    return { sanitized: polished, method: "llm_polish" }
  }
  return { sanitized: deterministic, method: "deterministic" }
}
