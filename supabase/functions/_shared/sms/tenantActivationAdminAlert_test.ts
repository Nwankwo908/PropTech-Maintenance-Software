/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  activationAdminAlertDedupKey,
  filterVendorPhonesFromOpsRecipients,
  isPermanentDeliveryFailure,
  normalizeOpsAlertChannelPreference,
  opsAlertChannelsEnabled,
} from "./tenantActivationFailure.ts"
import { isRetryableDeliveryFailure } from "./tenantActivationRetry.ts"

Deno.test("ops alert channel preference defaults to both", () => {
  assertEquals(normalizeOpsAlertChannelPreference(null), "both")
  assertEquals(normalizeOpsAlertChannelPreference("weird"), "both")
  assertEquals(normalizeOpsAlertChannelPreference("SMS"), "sms")
  assertEquals(normalizeOpsAlertChannelPreference("email"), "email")
  assertEquals(normalizeOpsAlertChannelPreference("activity_feed"), "activity_feed")
  assertEquals(normalizeOpsAlertChannelPreference("both"), "both")
})

Deno.test("ops alert channels respect onboarding preference", () => {
  assertEquals(opsAlertChannelsEnabled("sms"), {
    sms: true,
    email: false,
    activityFeed: false,
  })
  assertEquals(opsAlertChannelsEnabled("email"), {
    sms: false,
    email: true,
    activityFeed: false,
  })
  assertEquals(opsAlertChannelsEnabled("activity_feed"), {
    sms: false,
    email: false,
    activityFeed: true,
  })
  assertEquals(opsAlertChannelsEnabled("both"), {
    sms: true,
    email: true,
    activityFeed: true,
  })
})

Deno.test("vendor phones are excluded from landlord ops recipients", () => {
  const { allowed, blocked } = filterVendorPhonesFromOpsRecipients(
    ["+15551110001", "(555) 111-0002", "5551110001", "+15553334444"],
    ["5551110002", "+1 (555) 333-4444"],
  )
  assertEquals(allowed, ["+15551110001"])
  assertEquals(blocked.includes("+15551110002"), true)
  assertEquals(blocked.includes("+15553334444"), true)
})

Deno.test("dedup key uniqueness prevents repeated attempt alerts", () => {
  const a = activationAdminAlertDedupKey("res-1", "attempt-1")
  const b = activationAdminAlertDedupKey("res-1", "attempt-1")
  const c = activationAdminAlertDedupKey("res-1", "attempt-2")
  assertEquals(a, b)
  assertEquals(a === c, false)
})

Deno.test("temporary failure does not escalate before retries finish", () => {
  assertEquals(isPermanentDeliveryFailure("undelivered"), false)
  assertEquals(isRetryableDeliveryFailure("undelivered"), true)
  assertEquals(isPermanentDeliveryFailure("30003"), false)
  assertEquals(isRetryableDeliveryFailure("carrier temporarily unavailable"), true)
})

Deno.test("STOP / opted_out is not treated as undeliverable alert trigger", () => {
  // Handler short-circuits on opted_out; retry helper also blocks auto-retry.
  assertEquals(isRetryableDeliveryFailure("opted_out"), false)
  assertEquals(isPermanentDeliveryFailure("opted_out"), false)
})

Deno.test("permanent carrier rejection escalates immediately", () => {
  assertEquals(isPermanentDeliveryFailure("30007"), true)
  assertEquals(isRetryableDeliveryFailure("30007"), false)
  assertEquals(isPermanentDeliveryFailure("landline"), true)
})
