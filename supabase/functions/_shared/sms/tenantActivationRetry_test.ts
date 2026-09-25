/// <reference lib="deno.ns" />
import {
  ACTIVATION_RETRY_2_HOURS,
  ACTIVATION_RETRY_3_HOURS,
  ACTIVATION_SILENCE_NUDGE_HOURS,
  isAutomaticRetryDue,
  isRetryableDeliveryFailure,
  isSilenceNudgeDue,
  MAX_ACTIVATION_ATTEMPTS,
  MAX_SILENCE_NUDGE_ATTEMPTS,
  normalizeActivationPhone,
} from "./tenantActivationRetry.ts"

Deno.test("normalizeActivationPhone strips non-digits", () => {
  if (normalizeActivationPhone("(555) 123-4567") !== "5551234567") {
    throw new Error("expected digits only")
  }
})

Deno.test("isRetryableDeliveryFailure allows temporary provider errors only", () => {
  if (!isRetryableDeliveryFailure("carrier temporarily unavailable")) {
    throw new Error("carrier errors should retry")
  }
  if (!isRetryableDeliveryFailure("undelivered")) {
    throw new Error("temporary undelivered should retry")
  }
  // Permanent number issues escalate to Action Required — no auto-retry.
  if (isRetryableDeliveryFailure("invalid_phone")) {
    throw new Error("invalid phone must not auto-retry")
  }
  if (isRetryableDeliveryFailure("opted_out")) {
    throw new Error("opted_out must never auto-retry")
  }
  if (isRetryableDeliveryFailure("phone_changed")) {
    throw new Error("phone_changed must never auto-retry")
  }
})

Deno.test("isAutomaticRetryDue follows 24h / 72h from attempt 1", () => {
  const first = new Date("2026-07-01T12:00:00.000Z")

  const beforeRetry2 = new Date(first.getTime() + (ACTIVATION_RETRY_2_HOURS - 1) * 3600_000)
  if (
    isAutomaticRetryDue({
      activationStatus: "delivery_failed",
      attemptCount: 1,
      firstAttemptAt: first,
      now: beforeRetry2,
    })
  ) {
    throw new Error("retry 2 should not be due before 24h")
  }

  const atRetry2 = new Date(first.getTime() + ACTIVATION_RETRY_2_HOURS * 3600_000)
  if (
    !isAutomaticRetryDue({
      activationStatus: "delivery_failed",
      attemptCount: 1,
      firstAttemptAt: first,
      now: atRetry2,
    })
  ) {
    throw new Error("retry 2 should be due at 24h")
  }

  const beforeRetry3 = new Date(first.getTime() + (ACTIVATION_RETRY_3_HOURS - 1) * 3600_000)
  if (
    isAutomaticRetryDue({
      activationStatus: "delivery_failed",
      attemptCount: 2,
      firstAttemptAt: first,
      now: beforeRetry3,
    })
  ) {
    throw new Error("retry 3 should not be due before 72h")
  }

  const atRetry3 = new Date(first.getTime() + ACTIVATION_RETRY_3_HOURS * 3600_000)
  if (
    !isAutomaticRetryDue({
      activationStatus: "delivery_failed",
      attemptCount: 2,
      firstAttemptAt: first,
      now: atRetry3,
    })
  ) {
    throw new Error("retry 3 should be due at 72h")
  }

  if (
    isAutomaticRetryDue({
      activationStatus: "delivery_failed",
      attemptCount: MAX_ACTIVATION_ATTEMPTS,
      firstAttemptAt: first,
      now: atRetry3,
    })
  ) {
    throw new Error("no auto retry after 3 attempts")
  }

  if (
    isAutomaticRetryDue({
      activationStatus: "waiting",
      attemptCount: 1,
      firstAttemptAt: first,
      now: atRetry3,
    })
  ) {
    throw new Error("waiting (delivered) must not use delivery-failure retries")
  }
})

Deno.test("isSilenceNudgeDue follows up every 48h from the last send", () => {
  const first = new Date("2026-07-01T12:00:00.000Z")
  const last = new Date("2026-07-03T12:00:00.000Z")
  const before48 = new Date(last.getTime() + (ACTIVATION_SILENCE_NUDGE_HOURS - 1) * 3600_000)
  const at48 = new Date(last.getTime() + ACTIVATION_SILENCE_NUDGE_HOURS * 3600_000)

  if (
    isSilenceNudgeDue({
      activationStatus: "waiting",
      attemptCount: 1,
      firstAttemptAt: first,
      lastAttemptAt: last,
      now: before48,
    })
  ) {
    throw new Error("nudge should not be due before 48h from last send")
  }

  if (
    !isSilenceNudgeDue({
      activationStatus: "waiting",
      attemptCount: 1,
      firstAttemptAt: first,
      lastAttemptAt: last,
      now: at48,
    })
  ) {
    throw new Error("nudge should be due 48h after the last send")
  }

  if (
    !isSilenceNudgeDue({
      activationStatus: "waiting",
      attemptCount: 4,
      firstAttemptAt: first,
      lastAttemptAt: last,
      now: at48,
    })
  ) {
    throw new Error("later unanswered follow-ups should still send every 48h")
  }

  if (
    isSilenceNudgeDue({
      activationStatus: "waiting",
      attemptCount: MAX_SILENCE_NUDGE_ATTEMPTS,
      firstAttemptAt: first,
      lastAttemptAt: last,
      now: at48,
    })
  ) {
    throw new Error("silence nudges should stop at the cap")
  }

  if (
    isSilenceNudgeDue({
      activationStatus: "delivery_failed",
      attemptCount: 1,
      firstAttemptAt: first,
      lastAttemptAt: last,
      now: at48,
    })
  ) {
    throw new Error("delivery_failed must not use silence nudges")
  }
})

Deno.test("shouldSkipLimitedAlphaStaleActivationAutomation gates leftover imports", async () => {
  const { shouldSkipLimitedAlphaStaleActivationAutomation } = await import(
    "./tenantActivationRetry.ts"
  )

  if (
    !shouldSkipLimitedAlphaStaleActivationAutomation({
      isLimitedAlphaLandlord: true,
      firstAttemptAt: "2026-09-21T20:10:00.000Z",
      onboardingCompletedAt: null,
    })
  ) {
    throw new Error("limited alpha with no completed setup must skip")
  }

  if (
    !shouldSkipLimitedAlphaStaleActivationAutomation({
      isLimitedAlphaLandlord: true,
      firstAttemptAt: "2026-09-21T20:10:00.000Z",
      onboardingCompletedAt: "2026-09-25T20:50:00.000Z",
    })
  ) {
    throw new Error("first attempt before current completed_at must skip")
  }

  if (
    shouldSkipLimitedAlphaStaleActivationAutomation({
      isLimitedAlphaLandlord: true,
      firstAttemptAt: "2026-09-25T21:00:00.000Z",
      onboardingCompletedAt: "2026-09-25T20:50:00.000Z",
    })
  ) {
    throw new Error("welcome started after current setup must not skip")
  }

  if (
    shouldSkipLimitedAlphaStaleActivationAutomation({
      isLimitedAlphaLandlord: false,
      firstAttemptAt: "2026-09-21T20:10:00.000Z",
      onboardingCompletedAt: null,
    })
  ) {
    throw new Error("non-limited-alpha must not use this gate")
  }
})
