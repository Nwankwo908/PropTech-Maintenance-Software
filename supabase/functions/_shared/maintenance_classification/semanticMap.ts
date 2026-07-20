/**
 * Semantic phrase library + similarity scoring.
 * Offline: token Jaccard. Online (optional): OpenAI embeddings cosine.
 */
import type { IssueType, SemanticMatch, VendorTrade } from "./types.ts"

type PhraseExample = {
  phrase: string
  trade: VendorTrade
  issueType: IssueType
}

export const SEMANTIC_PHRASE_LIBRARY: PhraseExample[] = [
  { phrase: "leaky faucet", trade: "plumbing", issueType: "leak" },
  { phrase: "tap keeps dripping", trade: "plumbing", issueType: "leak" },
  { phrase: "water under kitchen sink", trade: "plumbing", issueType: "leak" },
  { phrase: "toilet overflowing", trade: "plumbing", issueType: "leak" },
  { phrase: "water dripping under the basin", trade: "plumbing", issueType: "leak" },
  { phrase: "clogged drain", trade: "plumbing", issueType: "plumbing" },
  { phrase: "outlet sparks when I plug something in", trade: "electrical", issueType: "electrical" },
  { phrase: "no power in the living room", trade: "electrical", issueType: "electrical" },
  { phrase: "breaker keeps tripping", trade: "electrical", issueType: "electrical" },
  { phrase: "the room won't cool down", trade: "hvac", issueType: "hvac" },
  { phrase: "ac blowing warm air", trade: "hvac", issueType: "hvac" },
  { phrase: "no heat during freezing weather", trade: "hvac", issueType: "hvac" },
  { phrase: "fridge is warm inside", trade: "appliance_repair", issueType: "appliance" },
  { phrase: "refrigerator not cooling", trade: "appliance_repair", issueType: "appliance" },
  { phrase: "dishwasher not draining", trade: "appliance_repair", issueType: "appliance" },
  { phrase: "I can't get into my apartment", trade: "locksmith", issueType: "lock" },
  { phrase: "locked out of unit", trade: "locksmith", issueType: "lock" },
  { phrase: "roach infestation in kitchen", trade: "pest_control", issueType: "pest" },
  { phrase: "water pouring through the ceiling", trade: "roofing", issueType: "roofing" },
  { phrase: "ceiling leak after rain", trade: "roofing", issueType: "roofing" },
]

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey || texts.length === 0) return null
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>
    }
    const rows = data.data ?? []
    rows.sort((x, y) => (x.index ?? 0) - (y.index ?? 0))
    const out = rows.map((r) => r.embedding ?? [])
    if (out.some((e) => !e.length)) return null
    return out
  } catch {
    return null
  }
}

/** Rank phrase library against sanitized description. */
export async function semanticMatchDescription(
  sanitized: string,
  opts?: { skipEmbeddings?: boolean },
): Promise<SemanticMatch[]> {
  const queryTokens = tokenize(sanitized)
  const lexical: SemanticMatch[] = SEMANTIC_PHRASE_LIBRARY.map((ex) => ({
    label: ex.phrase,
    trade: ex.trade,
    issueType: ex.issueType,
    score: jaccard(queryTokens, tokenize(ex.phrase)),
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  if (opts?.skipEmbeddings) return lexical

  const phrases = SEMANTIC_PHRASE_LIBRARY.map((p) => p.phrase)
  const vectors = await embedTexts([sanitized, ...phrases])
  if (!vectors || vectors.length < 2) return lexical

  const [q, ...rest] = vectors
  if (!q) return lexical

  const embedded: SemanticMatch[] = SEMANTIC_PHRASE_LIBRARY.map((ex, i) => ({
    label: ex.phrase,
    trade: ex.trade,
    issueType: ex.issueType,
    score: cosine(q, rest[i] ?? []),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  // Blend: take max score per phrase label
  const byLabel = new Map<string, SemanticMatch>()
  for (const m of [...lexical, ...embedded]) {
    const prev = byLabel.get(m.label)
    if (!prev || m.score > prev.score) byLabel.set(m.label, m)
  }
  return [...byLabel.values()].sort((a, b) => b.score - a.score).slice(0, 8)
}
