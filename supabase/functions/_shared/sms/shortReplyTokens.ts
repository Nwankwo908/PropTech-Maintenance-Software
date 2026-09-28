/**
 * Short expected-token SMS replies (APPROVE/DECLINE, YES/NO, …).
 *
 * Exact + semantic allowlists stay primary. For a single short word/phrase,
 * also allow Levenshtein typos of the literal token (e.g. "Aprrove" → APPROVE).
 */

export function normalizeShortReply(body: string): string {
  return body
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!
  }
  return prev[b.length]!
}

/** True when the whole message is short enough to treat as a command token. */
export function isShortReplyCandidate(normalized: string): boolean {
  if (!normalized) return false
  if (normalized.length > 28) return false
  return normalized.split(" ").length <= 3
}

/**
 * Max edit distance for a token. Short tokens (YES/NO) stay tight so
 * unrelated 2–3 letter noise does not collide; longer tokens allow ≤ 2.
 */
export function maxEditDistanceForToken(token: string): number {
  return token.length <= 4 ? 1 : 2
}

/**
 * Match `body` against expected tokens: exact first, then fuzzy for short
 * candidates. Returns the matched token (uppercase) or null.
 * Ties at the same distance → null (ambiguous).
 */
export function matchShortReplyToken(
  body: string,
  tokens: readonly string[],
  opts?: { maxDistance?: number },
): string | null {
  const normalized = normalizeShortReply(body)
  if (!normalized) return null

  const upperTokens = tokens.map((t) => t.trim().toUpperCase()).filter(Boolean)
  for (const token of upperTokens) {
    if (normalized === token) return token
  }

  if (!isShortReplyCandidate(normalized)) return null

  let best: string | null = null
  let bestDist = Infinity
  let bestLenDelta = Infinity
  let tied = false

  for (const token of upperTokens) {
    const maxDist = opts?.maxDistance ?? maxEditDistanceForToken(token)
    const lenDelta = Math.abs(normalized.length - token.length)
    if (lenDelta > maxDist) continue
    const dist = levenshtein(normalized, token)
    if (dist === 0 || dist > maxDist) continue
    // Prefer closer edit distance, then smaller length delta, then longer token
    // (so "YE" → YES wins over Y when both are distance 1).
    const better =
      dist < bestDist ||
      (dist === bestDist && lenDelta < bestLenDelta) ||
      (dist === bestDist &&
        lenDelta === bestLenDelta &&
        best != null &&
        token.length > best.length)
    if (better) {
      bestDist = dist
      bestLenDelta = lenDelta
      best = token
      tied = false
    } else if (
      dist === bestDist &&
      lenDelta === bestLenDelta &&
      best &&
      best !== token &&
      token.length === best.length
    ) {
      tied = true
    }
  }

  if (tied) return null
  return best
}
