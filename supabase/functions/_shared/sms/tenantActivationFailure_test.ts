import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  activationAdminAlertDedupKey,
  buildActivationAdminEmail,
  buildActivationAdminSms,
  buildActivationInAppCopy,
  classifyActivationFailure,
  friendlyActivationFailureReason,
  isPermanentDeliveryFailure,
  maskPhoneLast4,
} from "./tenantActivationFailure.ts"
import { isRetryableDeliveryFailure } from "./tenantActivationRetry.ts"

Deno.test("permanent invalid phone is not retryable and alerts immediately", () => {
  assertEquals(isPermanentDeliveryFailure("invalid_phone"), true)
  assertEquals(isRetryableDeliveryFailure("invalid_phone"), false)
  assertEquals(friendlyActivationFailureReason("invalid_phone"), "Invalid phone number")
  assertEquals(classifyActivationFailure("21211"), "invalid_phone")
})

Deno.test("temporary undelivered remains retryable", () => {
  assertEquals(isPermanentDeliveryFailure("undelivered"), false)
  assertEquals(isRetryableDeliveryFailure("undelivered"), true)
  assertEquals(
    friendlyActivationFailureReason("undelivered"),
    "Number is unreachable",
  )
})

Deno.test("STOP / opt-out is not a retryable delivery failure", () => {
  assertEquals(isRetryableDeliveryFailure("opted_out"), false)
})

Deno.test("maskPhoneLast4 hides full number", () => {
  assertEquals(maskPhoneLast4("+15551234567"), "4567")
  assertEquals(maskPhoneLast4("123"), null)
})

Deno.test("dedup key is stable per resident attempt", () => {
  assertEquals(
    activationAdminAlertDedupKey("res-1", "attempt-9"),
    "resident_activation_undeliverable:res-1:attempt-9",
  )
})

Deno.test("SMS copy prefers resident name when present", () => {
  const withName = buildActivationAdminSms({
    residentName: "Alex Rivera",
    unitLabel: "3A",
    propertyName: "Oakwood Apartments",
    last4: "4567",
  })
  assertStringIncludes(withName, "Alex Rivera in Unit 3A")
  assertStringIncludes(withName, "Oakwood Apartments")
  assertStringIncludes(withName, "Phone ending in 4567")
  assertEquals(withName.includes("555"), false)

  const withoutName = buildActivationAdminSms({
    unitLabel: "3A",
    propertyName: "Oakwood Apartments",
  })
  assertStringIncludes(withoutName, "the resident in Unit 3A")
})

Deno.test("email copy uses friendly reason and deep link", () => {
  const email = buildActivationAdminEmail({
    residentName: "Alex Rivera",
    unitLabel: "3A",
    propertyName: "Oakwood Apartments",
    maskedPhone: "•••-•••-4567",
    friendlyReason: "Invalid phone number",
    residentDetailsUrl:
      "https://www.ulohome.io/admin/properties/Oakwood%20Apartments/residents/res-1",
  })
  assertEquals(email.subject, "Resident phone needs attention — Unit 3A")
  assertStringIncludes(email.text, "Invalid phone number")
  assertStringIncludes(email.text, "•••-•••-4567")
  assertStringIncludes(email.html, "Open resident details")
  assertEquals(email.text.includes("21211"), false)
})

Deno.test("in-app copy matches product wording", () => {
  const copy = buildActivationInAppCopy({ unitLabel: "3A" })
  assertEquals(copy.title, "Resident phone needs attention")
  assertStringIncludes(copy.summary, "Unit 3A")
  assertStringIncludes(copy.summary, "Verify or update")
})
