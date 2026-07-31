import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildComplianceExpiryWarningSms,
  buildComplianceRestoredSms,
  buildComplianceSuspendedSms,
  __test,
} from "./vendorComplianceExpiry.ts"

Deno.test("daysUntil — 30 / 7 / expired", () => {
  const now = new Date("2026-07-22T12:00:00.000Z")
  assertEquals(__test.daysUntil("2026-08-21", now), 30)
  assertEquals(__test.daysUntil("2026-07-29", now), 7)
  assertEquals(__test.daysUntil("2026-07-22", now), 0)
  assertEquals(__test.daysUntil("2026-07-21", now), -1)
})

Deno.test("coi / license validity helpers", () => {
  const now = new Date("2026-07-22T12:00:00.000Z")
  assertEquals(
    __test.coiIsValid({
      coi_general_liability: 1_000_000,
      coi_expiration: "2026-08-01",
      coi_status: "verified",
      coi_additional_insured: true,
    }, now),
    true,
  )
  assertEquals(
    __test.coiIsValid({
      coi_general_liability: 1_000_000,
      coi_expiration: "2026-08-01",
      coi_status: "verified",
      coi_additional_insured: false,
    }, now),
    false,
  )
  assertEquals(
    __test.coiIsExpired({ coi_expiration: "2026-07-22" }, now),
    true,
  )
  assertEquals(
    __test.licenseIsExpired({ license_status: "expired" }, now),
    true,
  )
  assertEquals(
    __test.licenseIsValid({
      license_status: "active",
      license_number: "ABC",
      license_expiration: "2027-01-01",
    }, now),
    true,
  )
})

Deno.test("expiry SMS copy includes renewal link and second-notice tone", () => {
  const first = buildComplianceExpiryWarningSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
    kind: "coi",
    daysLeft: 30,
    expirationDate: "2026-08-21",
    renewalLink: "https://app.ulohome.io/v/token",
    isSecondNotice: false,
  })
  assertEquals(first.includes("Ulo Homes"), true)
  assertEquals(first.includes("/v/token"), true)
  assertEquals(first.toLowerCase().includes("second reminder"), false)

  const second = buildComplianceExpiryWarningSms({
    vendorLabel: "Flex Plumbing",
    companyName: null,
    kind: "license",
    daysLeft: 7,
    expirationDate: "2026-07-29",
    renewalLink: "https://app.ulohome.io/v/token",
    isSecondNotice: true,
  })
  assertEquals(second.toLowerCase().includes("second reminder"), true)

  const suspended = buildComplianceSuspendedSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
    kinds: ["coi"],
    renewalLink: "https://app.ulohome.io/v/token",
  })
  assertEquals(suspended.toLowerCase().includes("expired"), true)

  const restored = buildComplianceRestoredSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Ulo Homes",
  })
  assertEquals(restored.toLowerCase().includes("eligible"), true)
})
