/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isUnlinkedResidentSmsIdentity,
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
    smsIdentityIsFullyResolved({
      identity_type: "resident",
      resident_id: "user-1",
    }),
    true,
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
