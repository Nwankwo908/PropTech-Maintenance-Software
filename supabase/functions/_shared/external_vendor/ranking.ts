import type {
  ExternalVendorHit,
  ExternalVendorSource,
  ExternalVendorSuggestion,
} from "./types.ts"

/** Normalize vendor name for deduplication across providers. */
export function compactVendorNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48)
}

/** Higher is better: rating × log(reviews) with multi-source boost. */
export function scoreExternalVendorSuggestion(input: {
  rating: number | null
  reviewCount: number | null
  sourceCount: number
}): number {
  const r = input.rating ?? 0
  const c = input.reviewCount ?? 0
  const base = r * Math.log10(c + 10)
  const sourceBoost = 1 + Math.max(0, input.sourceCount - 1) * 0.08
  return base * sourceBoost
}

type MutableAgg = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: Set<ExternalVendorSource>
  etaMinutes: number | null
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return a >= b ? a : b
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return a <= b ? a : b
}

/** Merge hits from multiple providers, dedupe by normalized name, rank, cap. */
export function mergeAndRankExternalHits(
  hits: ExternalVendorHit[],
  opts?: { limit?: number; excludeNameKeys?: Set<string> },
): ExternalVendorSuggestion[] {
  const byKey = new Map<string, MutableAgg>()
  const limit = opts?.limit ?? 8
  const exclude = opts?.excludeNameKeys ?? new Set<string>()

  for (const hit of hits) {
    const name = hit.name.trim()
    if (!name) continue
    const key = compactVendorNameKey(name)
    if (!key || exclude.has(key)) continue

    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, {
        name,
        rating: hit.rating,
        reviewCount: hit.reviewCount,
        priceLabel: hit.priceLabel,
        sources: new Set([hit.source]),
        etaMinutes: hit.etaMinutes ?? null,
      })
      continue
    }

    prev.sources.add(hit.source)
    prev.reviewCount = maxNullable(prev.reviewCount, hit.reviewCount)
    prev.rating = maxNullable(prev.rating, hit.rating)
    prev.etaMinutes = minNullable(prev.etaMinutes, hit.etaMinutes ?? null)
    if (!prev.priceLabel && hit.priceLabel) prev.priceLabel = hit.priceLabel
    else if (
      prev.priceLabel &&
      hit.priceLabel &&
      !prev.priceLabel.includes("Yelp") &&
      hit.priceLabel.includes("Yelp")
    ) {
      prev.priceLabel = `${prev.priceLabel}; ${hit.priceLabel}`
    }
  }

  const list: ExternalVendorSuggestion[] = [...byKey.values()].map((m) => {
    const sources = [...m.sources]
    const rankScore = scoreExternalVendorSuggestion({
      rating: m.rating,
      reviewCount: m.reviewCount,
      sourceCount: sources.length,
    })
    return {
      name: m.name,
      rating: m.rating,
      reviewCount: m.reviewCount,
      priceLabel: m.priceLabel,
      sources,
      rankScore,
      etaMinutes: m.etaMinutes,
    }
  })

  list.sort((a, b) => b.rankScore - a.rankScore)
  return list.slice(0, limit)
}

/** Build exclusion keys from in-network roster vendor names. */
export function rosterNameKeys(names: string[]): Set<string> {
  const out = new Set<string>()
  for (const n of names) {
    const key = compactVendorNameKey(n)
    if (key) out.add(key)
  }
  return out
}
