/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isUnlinkedResidentSmsIdentity,
  isUnresolvedSmsIdentity,
  smsIdentityAllowsTypePatch,
  smsIdentityIsFullyResolved,
} from "./smsIdentityUpgrade.ts"

Deno.test("blank resident identities are not fully resolved", () => {
  assertEquals(
    smsIdentityIsFullyResolved({ identity_type: "resident", resident_id: null }),
    false,
  )
  assertEquals(
    isUnlinkedResidentSmsIdentity({ identity_type: "resident", resident_id: null }),
    true,
  )
  assertEquals(
    isUnresolvedSmsIdentity({ identity_type: "resident", resident_id: null }),
    true,
  )
  assertEquals(
    smsIdentityIsFullyResolved({
      identity_type: "resident",
      resident_id: "user-1",
    }),
    true,
  )
})

Deno.test("unresolved blank resident may upgrade to landlord", () => {
  assertEquals(
    smsIdentityAllowsTypePatch(
      { identity_type: "resident", resident_id: null },
      "landlord",
    ),
    true,
  )
  assertEquals(
    smsIdentityAllowsTypePatch({ identity_type: "unknown" }, "landlord"),
    true,
  )
  assertEquals(
    smsIdentityAllowsTypePatch(
      { identity_type: "resident", resident_id: "user-1" },
      "landlord",
    ),
    false,
  )
})

Deno.test("vendor job SMS may upgrade a blank tenant identity", () => {
  assertEquals(
    smsIdentityAllowsTypePatch(
      { identity_type: "resident", resident_id: null },
      "vendor",
    ),
    true,
  )
  assertEquals(
    smsIdentityAllowsTypePatch(
      { identity_type: "resident", resident_id: "user-1" },
      "vendor",
    ),
    false,
  )
  assertEquals(
    smsIdentityAllowsTypePatch({ identity_type: "unknown" }, "vendor"),
    true,
  )
  assertEquals(
    smsIdentityAllowsTypePatch(
      { identity_type: "vendor", vendor_id: "v-old" },
      "vendor",
    ),
    true,
  )
})
