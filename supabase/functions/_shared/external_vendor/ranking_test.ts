/// <reference lib="deno.ns" />

import {
  compactVendorNameKey,
  mergeAndRankExternalHits,
  rosterNameKeys,
  scoreExternalVendorSuggestion,
} from "./ranking.ts"
import type { ExternalVendorHit } from "./types.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

Deno.test("compactVendorNameKey normalizes punctuation", () => {
  assertEqual(compactVendorNameKey("Rapid Plumb Co."), "rapidplumbco", "key")
})

Deno.test("scoreExternalVendorSuggestion prefers higher rating and reviews", () => {
  const high = scoreExternalVendorSuggestion({
    rating: 4.9,
    reviewCount: 200,
    sourceCount: 1,
  })
  const low = scoreExternalVendorSuggestion({
    rating: 3.5,
    reviewCount: 10,
    sourceCount: 1,
  })
  if (!(high > low)) {
    throw new Error(`expected high score > low score (${high} vs ${low})`)
  }
})

Deno.test("mergeAndRankExternalHits dedupes cross-provider names", () => {
  const hits: ExternalVendorHit[] = [
    {
      name: "Metro Plumbing",
      rating: 4.5,
      reviewCount: 80,
      priceLabel: "$$ · Moderate",
      source: "google",
    },
    {
      name: "metro plumbing",
      rating: 4.7,
      reviewCount: 120,
      priceLabel: "$$ on Yelp",
      source: "yelp",
    },
    {
      name: "Other Co",
      rating: 4.0,
      reviewCount: 20,
      priceLabel: null,
      source: "mock",
    },
  ]

  const ranked = mergeAndRankExternalHits(hits, { limit: 5 })
  if (ranked.length !== 2) {
    throw new Error(`expected 2 merged suggestions, got ${ranked.length}`)
  }
  if (ranked[0].name !== "metro plumbing" && ranked[0].name !== "Metro Plumbing") {
    throw new Error("expected merged metro plumbing first")
  }
  if (!ranked[0].sources.includes("google") || !ranked[0].sources.includes("yelp")) {
    throw new Error("expected both sources on merged row")
  }
})

Deno.test("rosterNameKeys excludes in-network vendors from suggestions", () => {
  const exclude = rosterNameKeys(["Metro Plumbing", "Apex Pipe"])
  const hits: ExternalVendorHit[] = [
    {
      name: "Metro Plumbing",
      rating: 5,
      reviewCount: 999,
      priceLabel: null,
      source: "mock",
    },
    {
      name: "Rapid Plumb Co.",
      rating: 4.9,
      reviewCount: 100,
      priceLabel: null,
      source: "mock",
    },
  ]
  const ranked = mergeAndRankExternalHits(hits, { excludeNameKeys: exclude })
  if (ranked.length !== 1 || ranked[0].name !== "Rapid Plumb Co.") {
    throw new Error("expected roster vendor excluded")
  }
})
