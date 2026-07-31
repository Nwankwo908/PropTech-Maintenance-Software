/// <reference lib="deno.ns" />
import {
  ACTIVATION_RETRY_2_HOURS,
  ACTIVATION_RETRY_3_HOURS,
  isAutomaticRetryDue,
  isRetryableDeliveryFailure,
  MAX_ACTIVATION_ATTEMPTS,
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
    throw new Error("waiting (delivered) must not auto-retry")
  }
})
