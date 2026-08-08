/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  INBOUND_SMS_HANDLER_PENDING_GATES,
  INBOUND_SMS_HANDLERS,
} from "./inboundHandlerRegistry.ts"

Deno.test("INBOUND_SMS_HANDLERS are sorted by ascending priority", () => {
  for (let i = 1; i < INBOUND_SMS_HANDLERS.length; i++) {
    assertEquals(
      INBOUND_SMS_HANDLERS[i].priority >= INBOUND_SMS_HANDLERS[i - 1].priority,
      true,
    )
  }
})

Deno.test("INBOUND_SMS_HANDLERS preserve canonical order (STOP is global. YES is contextual.)", () => {
  assertEquals(
    INBOUND_SMS_HANDLERS.map((h) => h.id),
    Object.keys(INBOUND_SMS_HANDLER_PENDING_GATES),
  )
})

function priority(id: string): number {
  return INBOUND_SMS_HANDLERS.find((h) => h.id === id)!.priority
}

Deno.test("STOP/HELP compliance runs before active conversations", () => {
  assertEquals(priority("compliance_stop_help") < priority("schedule_confirm"), true)
  assertEquals(priority("compliance_stop_help") < priority("estimate_decision"), true)
})

Deno.test("schedule_confirm runs before tenant_activation_reply (YES disambiguation)", () => {
  assertEquals(priority("schedule_confirm") < priority("tenant_activation_reply"), true)
})

Deno.test("active conversations run before tenant_activation_reply", () => {
  assertEquals(priority("estimate_decision") < priority("tenant_activation_reply"), true)
  assertEquals(priority("invoice_payment") < priority("tenant_activation_reply"), true)
})

Deno.test("tenant_activation_reply runs before vendor operations", () => {
  assertEquals(priority("tenant_activation_reply") < priority("vendor_reschedule"), true)
})

Deno.test("vendor_reschedule runs before vendor_capacity", () => {
  assertEquals(priority("vendor_reschedule") < priority("vendor_capacity"), true)
})

Deno.test("vendor_tenant_proxy is last specialist before workflow fallback", () => {
  const last = INBOUND_SMS_HANDLERS[INBOUND_SMS_HANDLERS.length - 1]
  assertEquals(last.id, "vendor_tenant_proxy")
})
