/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildRetrievalCacheKey,
  normalizeRetrievalQuestion,
  retrievalTopicBucket,
} from "./retrievalCache.ts"

Deno.test("normalizeRetrievalQuestion strips stopwords and punctuation", () => {
  const a = normalizeRetrievalQuestion("Can I increase rent at my property in Atlanta?")
  const b = normalizeRetrievalQuestion("increase rent Atlanta property")
  assertEquals(a.includes("increase"), true)
  assertEquals(a.includes("rent"), true)
  assertEquals(a.includes("atlanta"), true)
  assertEquals(a.includes("can"), false)
  // Same core tokens after normalize
  assertEquals(a.split(" ").includes("atlanta"), true)
  assertEquals(b.includes("atlanta"), true)
})

Deno.test("retrievalTopicBucket: rent increase", () => {
  assertEquals(
    retrievalTopicBucket("Can I increase rent at my property in Atlanta?"),
    "rent_increase",
  )
})

Deno.test("retrievalTopicBucket: deposit vs rent", () => {
  assertEquals(retrievalTopicBucket("When is the security deposit due back?"), "deposit")
  assertEquals(
    retrievalTopicBucket("Can I increase rent at my property in Atlanta?"),
    "rent_increase",
  )
})

Deno.test("buildRetrievalCacheKey stable for same inputs", async () => {
  const input = {
    intent: "legal",
    stateCode: "GA",
    citySlug: "atlanta",
    countySlug: "fulton",
    housingProgram: null as string | null,
    question: "Can I increase rent at my property in Atlanta?",
    sourceFreshnessToken: "abc123",
  }
  const a = await buildRetrievalCacheKey(input)
  const b = await buildRetrievalCacheKey({
    ...input,
    question: "can I increase the rent at my property in Atlanta???",
  })
  assertEquals(a.cacheKey, b.cacheKey)
  assertEquals(a.topicBucket, "rent_increase")
})

Deno.test("buildRetrievalCacheKey changes when freshness changes", async () => {
  const base = {
    intent: "legal",
    stateCode: "GA",
    citySlug: "atlanta",
    countySlug: null as string | null,
    housingProgram: null as string | null,
    question: "Can I increase rent in Atlanta?",
  }
  const a = await buildRetrievalCacheKey({ ...base, sourceFreshnessToken: "v1" })
  const b = await buildRetrievalCacheKey({ ...base, sourceFreshnessToken: "v2" })
  assertEquals(a.cacheKey === b.cacheKey, false)
})

Deno.test("buildRetrievalCacheKey changes across states", async () => {
  const q = "Can I increase rent?"
  const ga = await buildRetrievalCacheKey({
    intent: "legal",
    stateCode: "GA",
    citySlug: "atlanta",
    countySlug: null,
    housingProgram: null,
    question: q,
    sourceFreshnessToken: "same",
  })
  const or = await buildRetrievalCacheKey({
    intent: "legal",
    stateCode: "OR",
    citySlug: "portland",
    countySlug: null,
    housingProgram: null,
    question: q,
    sourceFreshnessToken: "same",
  })
  assertEquals(ga.cacheKey === or.cacheKey, false)
})
