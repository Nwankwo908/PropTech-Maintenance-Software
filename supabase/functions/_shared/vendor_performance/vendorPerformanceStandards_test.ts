import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildAcceptanceProfileReviewSms,
  buildMisconductSuspendedSms,
  buildNoShowWarningSms,
  buildPerformanceCoachingSms,
  evaluateAcceptanceStandards,
  evaluateNoShowStandards,
  evaluateRatingStandards,
  __test,
} from "./vendorPerformanceStandards.ts"

Deno.test("rating: coaching under 3.5 with 5+ reviews", () => {
  const r = evaluateRatingStandards({
    reviewCount: 5,
    avgRating: 3.4,
    notices: {},
  })
  assertEquals(r.coaching, true)
  assertEquals(r.suspensionReview, false)
})

Deno.test("rating: no action under 5 reviews", () => {
  const r = evaluateRatingStandards({
    reviewCount: 4,
    avgRating: 2.0,
    notices: {},
  })
  assertEquals(r.coaching, false)
  assertEquals(r.suspensionReview, false)
})

Deno.test("rating: persistent < 3.0 after coaching → suspension review", () => {
  const r = evaluateRatingStandards({
    reviewCount: 8,
    avgRating: 2.9,
    notices: { rating_coaching: "2026-07-01T00:00:00.000Z" },
  })
  assertEquals(r.coaching, false)
  assertEquals(r.suspensionReview, true)
})

Deno.test("rating: already reviewed — no repeat suspension review", () => {
  const r = evaluateRatingStandards({
    reviewCount: 8,
    avgRating: 2.5,
    notices: {
      rating_coaching: "2026-07-01T00:00:00.000Z",
      rating_suspension_review: "2026-07-10T00:00:00.000Z",
    },
  })
  assertEquals(r.suspensionReview, false)
})

Deno.test("no-show: warning >2 in 30d", () => {
  const r = evaluateNoShowStandards({
    count30: 3,
    count60: 3,
    notices: {},
  })
  assertEquals(r.warning, true)
  assertEquals(r.suspensionReview, false)
})

Deno.test("no-show: suspension review >3 in 60d takes precedence", () => {
  const r = evaluateNoShowStandards({
    count30: 4,
    count60: 4,
    notices: {},
  })
  assertEquals(r.warning, false)
  assertEquals(r.suspensionReview, true)
})

Deno.test("acceptance: profile review under 40% with 20+ offers", () => {
  const r = evaluateAcceptanceStandards({
    offered: 20,
    accepted: 7,
    notices: {},
  })
  assertEquals(r.profileReview, true)
  assertEquals(r.rate, 0.35)
})

Deno.test("acceptance: no review under 20 offers", () => {
  const r = evaluateAcceptanceStandards({
    offered: 19,
    accepted: 1,
    notices: {},
  })
  assertEquals(r.profileReview, false)
})

Deno.test("escalateReview prefers suspension_review", () => {
  assertEquals(__test.escalateReview("coaching", "profile_review"), "profile_review")
  assertEquals(
    __test.escalateReview("profile_review", "suspension_review"),
    "suspension_review",
  )
  assertEquals(
    __test.escalateReview("suspension_review", "coaching"),
    "suspension_review",
  )
})

Deno.test("SMS copy follows Ulo writing standard", () => {
  const coaching = buildPerformanceCoachingSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
    avgRating: 3.2,
  })
  assertEquals(coaching.includes("Ulo Homes"), true)
  assertEquals(coaching.toLowerCase().includes("coaching"), true)

  const noshow = buildNoShowWarningSms({
    vendorLabel: "Flex Plumbing",
    companyName: null,
    count30: 3,
  })
  assertEquals(noshow.includes("missed appointments"), true)

  const accept = buildAcceptanceProfileReviewSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
    ratePct: 35,
  })
  assertEquals(accept.includes("35%"), true)

  const misconduct = buildMisconductSuspendedSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
  })
  assertEquals(misconduct.toLowerCase().includes("hold"), true)
})
