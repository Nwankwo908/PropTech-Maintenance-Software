/// <reference lib="deno.ns" />

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  DEMO_LANDLORD_ID,
  landlordUsesLimitedAlphaSurface,
} from "../../../../shared/landlordCapabilities.ts"
import {
  landlordAllowedOnReceivingLine,
  resolveInboundAccount,
} from "./inboundAccountRouting.ts"

const LA1 = "de300000-0000-4000-8000-000000000003"
const LA2 = "de300000-0000-4000-8000-000000000004"
const DEMO = DEMO_LANDLORD_ID
const DISPOSABLE = "d15a0000-0000-4000-8000-000000000001"
const SHARED = [LA1, LA2, DEMO]

function allowed(id: string, sharedLine: boolean, owner: string): boolean {
  return landlordAllowedOnReceivingLine({
    sharedLine,
    lineOwnerLandlordId: owner,
    landlordId: id,
    usesSharedLine: landlordUsesLimitedAlphaSurface(id),
  })
}

Deno.test("current identity beats older outbound history", () => {
  const decision = resolveInboundAccount({
    permittedLandlordIds: SHARED,
    explicit: [{ landlordId: LA2 }],
    history: [
      { landlordId: DEMO, at: "2026-10-21T23:53:00.000Z" },
      { landlordId: LA2, at: "2026-10-21T23:50:00.000Z" },
    ],
  })
  assertEquals(decision.reason, "explicit")
  assertEquals(decision.landlordId, LA2)
})

Deno.test("closed conversations and disconnected accounts do not restore history", () => {
  const decision = resolveInboundAccount({
    permittedLandlordIds: SHARED,
    explicit: [],
    history: [
      { landlordId: DEMO, at: "2026-10-21T23:53:00.000Z", closed: true },
      { landlordId: DEMO, at: "2026-10-21T23:53:00.000Z" },
    ],
    disconnectedLandlordIds: [DEMO],
  })
  assertEquals(decision.reason, "unmatched")
  assertEquals(decision.landlordId, null)
})

Deno.test("two current accounts on one phone stay ambiguous", () => {
  const decision = resolveInboundAccount({
    permittedLandlordIds: SHARED,
    explicit: [{ landlordId: LA1 }, { landlordId: LA2 }],
    history: [{ landlordId: LA2, at: "2026-10-26T12:00:00.000Z" }],
  })
  assertEquals(decision.reason, "ambiguous")
  assertEquals(decision.landlordId, null)
})

Deno.test("a dedicated line cannot use another account's identity or history", () => {
  const permitted = [DEMO, LA2, DISPOSABLE].filter((id) => allowed(id, false, DEMO))
  assertEquals(permitted, [DEMO])
  const decision = resolveInboundAccount({
    permittedLandlordIds: permitted,
    explicit: [{ landlordId: DISPOSABLE }],
    history: [{ landlordId: LA2, at: "2026-10-26T12:00:00.000Z" }],
  })
  assertEquals(decision.reason, "assigned_elsewhere")
  assertEquals(decision.landlordId, null)
})

Deno.test("shared-line scope keeps Limited Alpha accounts and excludes other landlords", () => {
  const permitted = [LA1, LA2, DEMO, DISPOSABLE].filter((id) => allowed(id, true, LA1))
  assertEquals(permitted.includes(LA1), true)
  assertEquals(permitted.includes(LA2), true)
  assertEquals(permitted.includes(DEMO), true)
  assertEquals(permitted.includes(DISPOSABLE), false)
})

Deno.test("history fallback selects the one recent account when no identity exists", () => {
  const decision = resolveInboundAccount({
    permittedLandlordIds: SHARED,
    explicit: [],
    history: [
      { landlordId: LA2, at: "2026-10-21T23:50:42.000Z" },
      { landlordId: DEMO, at: "2026-10-21T20:00:00.000Z" },
    ],
  })
  assertEquals(decision.reason, "history")
  assertEquals(decision.landlordId, LA2)
})

Deno.test("tied history timestamps are ambiguous", () => {
  const decision = resolveInboundAccount({
    permittedLandlordIds: SHARED,
    explicit: [],
    history: [
      { landlordId: LA1, at: "2026-10-21T23:50:42.000Z" },
      { landlordId: LA2, at: "2026-10-21T23:50:42.000Z" },
    ],
  })
  assertEquals(decision.reason, "ambiguous")
  assertEquals(decision.landlordId, null)
})

Deno.test("an assignment outside the receiving line blocks old history without crossing accounts", () => {
  const permitted = [LA1, LA2, DEMO, DISPOSABLE].filter((id) => allowed(id, true, LA1))
  const decision = resolveInboundAccount({
    permittedLandlordIds: permitted,
    explicit: [{ landlordId: DISPOSABLE }],
    history: [{ landlordId: DEMO, at: "2026-10-21T23:53:00.000Z" }],
  })
  assertEquals(decision.reason, "assigned_elsewhere")
  assertEquals(decision.landlordId, null)
  assertEquals(decision.landlordId === DISPOSABLE, false)
  assertEquals(decision.landlordId === DEMO, false)
})
