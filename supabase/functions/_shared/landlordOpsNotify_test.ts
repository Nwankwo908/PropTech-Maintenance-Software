/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  filterVendorEmailsFromOpsRecipients,
  normalizeOpsEmail,
  parseOpsEmailList,
} from "./landlordOpsNotify.ts"

Deno.test("normalizeOpsEmail lowercases and rejects junk", () => {
  assertEquals(normalizeOpsEmail("  Ops@Example.com "), "ops@example.com")
  assertEquals(normalizeOpsEmail("not-an-email"), null)
  assertEquals(normalizeOpsEmail(""), null)
})

Deno.test("parseOpsEmailList splits mixed separators", () => {
  assertEquals(
    parseOpsEmailList("a@ulo.io, b@ulo.io;c@ulo.io  d@ulo.io"),
    ["a@ulo.io", "b@ulo.io", "c@ulo.io", "d@ulo.io"],
  )
})

Deno.test("filterVendorEmailsFromOpsRecipients drops vendor addresses", () => {
  const { allowed, blocked } = filterVendorEmailsFromOpsRecipients(
    [
      "ops@ulohome.io",
      "Vendor@Acme.com",
      "landlord@property.com",
      "vendor@acme.com", // dup after normalize
    ],
    ["vendor@acme.com", "other@vendor.com"],
  )
  assertEquals(allowed, ["ops@ulohome.io", "landlord@property.com"])
  assertEquals(blocked, ["vendor@acme.com"])
})

Deno.test("filter never leaves a vendor on landlord approve list", () => {
  const { allowed } = filterVendorEmailsFromOpsRecipients(
    ["plumber@flex.com", "emeka@ulohome.io"],
    ["plumber@flex.com"],
  )
  assertEquals(allowed.includes("plumber@flex.com"), false)
  assertEquals(allowed, ["emeka@ulohome.io"])
})
