import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { uniqueLandlordIdFromRows } from "./inbound_db.ts"

const ALPHA_1 = "de300000-0000-4000-8000-000000000003"
const ALPHA_2 = "de300000-0000-4000-8000-000000000004"

Deno.test("uniqueLandlordIdFromRows returns the sole landlord", () => {
  assertEquals(
    uniqueLandlordIdFromRows([{ landlord_id: ALPHA_2 }, { landlord_id: ALPHA_2 }]),
    ALPHA_2,
  )
})

Deno.test("uniqueLandlordIdFromRows returns null when ambiguous or empty", () => {
  assertEquals(uniqueLandlordIdFromRows([]), null)
  assertEquals(
    uniqueLandlordIdFromRows([{ landlord_id: ALPHA_1 }, { landlord_id: ALPHA_2 }]),
    null,
  )
  assertEquals(uniqueLandlordIdFromRows([{ landlord_id: null }, { landlord_id: "" }]), null)
})

Deno.test("vendor-only Flex phone resolves to Alpha 2 — never DID-owner Alpha 1", () => {
  // Shared DID sms_numbers.landlord_id is Alpha 1; Flex Plumbing roster is Alpha 2.
  // Unmatched / ambiguous must NOT fall back to Alpha 1.
  const vendorMatch = uniqueLandlordIdFromRows([{ landlord_id: ALPHA_2 }])
  assertEquals(vendorMatch, ALPHA_2)
  assertEquals(uniqueLandlordIdFromRows([]), null)
})

Deno.test("same phone on both Alphas is ambiguous — no DID-owner fallback", () => {
  assertEquals(
    uniqueLandlordIdFromRows([
      { landlord_id: ALPHA_1 },
      { landlord_id: ALPHA_2 },
    ]),
    null,
  )
})
