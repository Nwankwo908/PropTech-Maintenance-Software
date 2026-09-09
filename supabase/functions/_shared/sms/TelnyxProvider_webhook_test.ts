/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isTelnyxInboundEventType,
  isTelnyxStatusEventType,
  peekTelnyxEventType,
  pickTelnyxSendFromNumber,
} from "./TelnyxProvider.ts"

Deno.test("peekTelnyxEventType reads message.received", () => {
  assertEquals(
    peekTelnyxEventType(
      JSON.stringify({ data: { event_type: "message.received" } }),
    ),
    "message.received",
  )
})

Deno.test("pickTelnyxSendFromNumber prefers the landlord From number", () => {
  assertEquals(
    pickTelnyxSendFromNumber("+19734005760", "+15551212"),
    "+15551212",
  )
  assertEquals(pickTelnyxSendFromNumber("+19734005760", "  "), "+19734005760")
  assertEquals(pickTelnyxSendFromNumber("+19734005760"), "+19734005760")
})

Deno.test("Telnyx inbound vs status event gates", () => {
  assertEquals(isTelnyxInboundEventType("message.received"), true)
  assertEquals(isTelnyxInboundEventType("message.finalized"), false)
  assertEquals(isTelnyxStatusEventType("message.finalized"), true)
  assertEquals(isTelnyxStatusEventType("message.sent"), true)
  assertEquals(isTelnyxStatusEventType("message.received"), false)
})
