import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { DEMO_LANDLORD_ID } from "../../../../shared/landlordCapabilities.ts"
import {
  pickLandlordIdFromRecentConversationRows,
  pickLandlordIdFromRecentOutboundRows,
  preferNonDemoWhenChoosingUnique,
  rowsIncludeNonDemoLandlord,
  uniqueLandlordIdFromRows,
} from "./inbound_db.ts"

const ALPHA_1 = "de300000-0000-4000-8000-000000000003"
const ALPHA_2 = "de300000-0000-4000-8000-000000000004"
const DEMO = DEMO_LANDLORD_ID

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

Deno.test("recent outbound after LA2 tenant message prefers LA2 over Demo", () => {
  // Failure case: LA2 journey outbound, then tenant reply — Demo must not win.
  const landlordId = pickLandlordIdFromRecentOutboundRows([
    {
      landlord_id: ALPHA_2,
      created_at: "2026-10-21T23:50:42.000Z",
    },
    {
      landlord_id: DEMO,
      created_at: "2026-10-21T20:00:00.000Z",
    },
  ])
  assertEquals(landlordId, ALPHA_2)
})

Deno.test("vendor YES / scheduling replies follow most recent outbound landlord", () => {
  assertEquals(
    pickLandlordIdFromRecentOutboundRows([
      { landlord_id: ALPHA_2, created_at: "2026-10-21T23:51:00.000Z" },
    ]),
    ALPHA_2,
  )
})

Deno.test("recent open conversation prefers newest updated thread landlord", () => {
  assertEquals(
    pickLandlordIdFromRecentConversationRows([
      { landlord_id: ALPHA_2, updated_at: "2026-10-21T23:50:42.000Z" },
      { landlord_id: DEMO, updated_at: "2026-10-21T23:00:00.000Z" },
    ]),
    ALPHA_2,
  )
})

Deno.test("shared phone Demo + LA2: preferNonDemoWhenChoosingUnique picks LA2", () => {
  assertEquals(
    preferNonDemoWhenChoosingUnique([DEMO, ALPHA_2]),
    ALPHA_2,
  )
  assertEquals(
    preferNonDemoWhenChoosingUnique([DEMO, ALPHA_1, ALPHA_2]),
    null,
  )
  assertEquals(preferNonDemoWhenChoosingUnique([DEMO]), DEMO)
})

Deno.test("stale/demo identities: rowsIncludeNonDemoLandlord detects portfolio binding", () => {
  assertEquals(
    rowsIncludeNonDemoLandlord([
      { landlord_id: DEMO },
      { landlord_id: ALPHA_2 },
    ]),
    true,
  )
  assertEquals(
    rowsIncludeNonDemoLandlord([{ landlord_id: DEMO }]),
    false,
  )
})

Deno.test("ambiguous match without unique non-demo stays unresolved", () => {
  // Phone on LA1 + LA2 + Demo → no unique pick; caller must clarify, not Try Demo.
  assertEquals(
    preferNonDemoWhenChoosingUnique([ALPHA_1, ALPHA_2, DEMO]),
    null,
  )
  assertEquals(
    uniqueLandlordIdFromRows([
      { landlord_id: ALPHA_1 },
      { landlord_id: ALPHA_2 },
      { landlord_id: DEMO },
    ]),
    null,
  )
})

Deno.test("duplicate inbound SID: first-seen outbound context is stable", () => {
  // Same newest outbound row twice (idempotent read) still yields one landlord.
  const rows = [
    { landlord_id: ALPHA_2, created_at: "2026-10-21T23:50:42.000Z" },
    { landlord_id: ALPHA_2, created_at: "2026-10-21T23:50:42.000Z" },
  ]
  assertEquals(pickLandlordIdFromRecentOutboundRows(rows), ALPHA_2)
  assertEquals(pickLandlordIdFromRecentOutboundRows(rows), ALPHA_2)
})
