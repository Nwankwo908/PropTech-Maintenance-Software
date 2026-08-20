/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { runLinksCancelledTicket } from "./cancelResidentWorkOrderLink.ts"

Deno.test("SMS cancel links conversation intake via draft_ticket_id", () => {
  assertEquals(
    runLinksCancelledTicket(
      {
        entity_id: "convo-1",
        entity_type: "sms_conversation",
        metadata: { draft_ticket_id: "ticket-1" },
      },
      "ticket-1",
    ),
    true,
  )
})

Deno.test("SMS cancel does not close a different ticket on the same thread", () => {
  assertEquals(
    runLinksCancelledTicket(
      {
        entity_id: "convo-1",
        entity_type: "sms_conversation",
        metadata: { draft_ticket_id: "ticket-other" },
      },
      "ticket-1",
    ),
    false,
  )
})

Deno.test("SMS cancel links a maintenance_request run by entity id", () => {
  assertEquals(
    runLinksCancelledTicket(
      {
        entity_id: "ticket-1",
        entity_type: "maintenance_request",
        metadata: {},
      },
      "ticket-1",
    ),
    true,
  )
})
