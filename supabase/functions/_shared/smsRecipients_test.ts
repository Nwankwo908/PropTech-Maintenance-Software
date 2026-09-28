/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  assertStaffAlertBodySafe,
  staffAlertRecipients,
} from "./smsRecipients.ts"

Deno.test("staffAlertRecipients reads only shared env list", () => {
  const prev = Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")
  const prevOps = Deno.env.get("LANDLORD_OPS_PHONE")
  try {
    Deno.env.set("SMS_ADMIN_NOTIFY_PHONES", "+15551110001, +1 (555) 222-0002")
    Deno.env.delete("LANDLORD_OPS_PHONE")
    const phones = staffAlertRecipients()
    assertEquals(phones.length, 2)
    assertEquals(
      phones.every((p) => p.replace(/\D/g, "").endsWith("5551110001") ||
        p.replace(/\D/g, "").endsWith("5552220002")),
      true,
    )
  } finally {
    if (prev == null) Deno.env.delete("SMS_ADMIN_NOTIFY_PHONES")
    else Deno.env.set("SMS_ADMIN_NOTIFY_PHONES", prev)
    if (prevOps == null) Deno.env.delete("LANDLORD_OPS_PHONE")
    else Deno.env.set("LANDLORD_OPS_PHONE", prevOps)
  }
})

Deno.test("staff alert body rejects unit / dollar leaks", () => {
  assertEquals(
    assertStaffAlertBodySafe(
      "Ulo ops: Acme Plumbing — COI expires in 7d (2026-10-01). Renewal SMS sent.",
    ),
    true,
  )
  assertEquals(
    assertStaffAlertBodySafe("Vendor Acme — Unit 3A needs attention"),
    false,
  )
  assertEquals(
    assertStaffAlertBodySafe("Invoice $120.00 ready"),
    false,
  )
})
