/**
 * Text sanitizer — normalize resident wording without inventing facts.
 * Prefer deterministic cleanup; optional LLM polish when OPENAI_API_KEY is set.
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
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey || !normalized) return null

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the resident maintenance description into clear, standard English. " +
              "Fix typos and expand obvious abbreviations. Preserve meaning exactly. " +
              "Do not invent rooms, fixtures, or facts not present. Return only the rewritten sentence(s).",
          },
          {
            role: "user",
            content: `Raw: ${raw}\nDraft: ${normalized}`,
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content || content.length < 3) return null
    return content.replace(/^["']|["']$/g, "").trim()
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
