/// <reference lib="deno.ns" />
/**
 * Lightweight parseRating tests — keep parse helpers inlined here so this file
 * does not pull the full vendor_feedback → finalize → invoice SMS graph.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"

const RATING_WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
}

function parseRating(body: string): number | null {
  const trimmed = body.trim()
  if (!trimmed) return null

  const exact = trimmed.match(/^([1-5])$/)
  if (exact) return Number(exact[1])

  const withScale = trimmed.match(/^([1-5])\s*[/／]\s*5$/)
  if (withScale) return Number(withScale[1])

  const stars = trimmed.match(/^([1-5])\s*(?:stars?|★|⭐️?)$/i)
  if (stars) return Number(stars[1])

  const starPrefix = trimmed.match(/^(?:★|⭐️?)\s*([1-5])$/i)
  if (starPrefix) return Number(starPrefix[1])

  const labeled = trimmed.match(/^(?:rate[d]?|rating)[:\s]+([1-5])(?:\s*[/／]\s*5)?$/i)
  if (labeled) return Number(labeled[1])

  const word = trimmed.toLowerCase().replace(/[^a-z]/g, "")
  if (word in RATING_WORD) return RATING_WORD[word]

  return null
}

function ratingQualityLabel(rating: number): string {
  switch (rating) {
    case 1:
      return "Poor"
    case 2:
      return "Fair"
    case 3:
      return "Good"
    case 4:
      return "Very Good"
    case 5:
      return "Excellent"
    default:
      return ""
  }
}

Deno.test("parseRating accepts plain 1–5", () => {
  assertEquals(parseRating("5"), 5)
  assertEquals(parseRating(" 3 "), 3)
  assertEquals(parseRating("1"), 1)
})

Deno.test("parseRating accepts common reply shapes", () => {
  assertEquals(parseRating("5/5"), 5)
  assertEquals(parseRating("4 stars"), 4)
  assertEquals(parseRating("rating: 2"), 2)
  assertEquals(parseRating("Rated 5"), 5)
  assertEquals(parseRating("five"), 5)
})

Deno.test("parseRating rejects unrelated text", () => {
  assertEquals(parseRating("Unit 5"), null)
  assertEquals(parseRating("Yes"), null)
  assertEquals(parseRating("51"), null)
  assertEquals(parseRating(""), null)
})

Deno.test("ratingQualityLabel maps 1–5", () => {
  assertEquals(ratingQualityLabel(5), "Excellent")
  assertEquals(ratingQualityLabel(1), "Poor")
})
