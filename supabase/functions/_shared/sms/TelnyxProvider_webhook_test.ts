/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isTelnyxInboundEventType,
  isTelnyxStatusEventType,
  peekTelnyxEventType,
} from "./TelnyxProvider.ts"

Deno.test("peekTelnyxEventType reads message.received", () => {
  assertEquals(
    peekTelnyxEventType(
      JSON.stringify({ data: { event_type: "message.received" } }),
    ),
    "message.received",
  )
})

Deno.test("Telnyx inbound vs status event gates", () => {
  assertEquals(isTelnyxInboundEventType("message.received"), true)
  assertEquals(isTelnyxInboundEventType("message.finalized"), false)
  assertEquals(isTelnyxStatusEventType("message.finalized"), true)
  assertEquals(isTelnyxStatusEventType("message.sent"), true)
  assertEquals(isTelnyxStatusEventType("message.received"), false)
})
