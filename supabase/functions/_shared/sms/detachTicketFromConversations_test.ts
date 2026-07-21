/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

// Pure helper coverage via a tiny local copy of the touch logic used in detach.
function conversationTouchesTicket(
  row: {
    maintenance_request_id: string | null
    intake_state: Record<string, unknown> | null
  },
  ticketId: string,
): boolean {
  if (row.maintenance_request_id === ticketId) return true
  const intake = row.intake_state ?? {}
  const schedule = intake.vendor_schedule as { ticketId?: string } | undefined
  const estimate = intake.awaiting_estimate_decision as
    | { ticket_id?: string }
    | undefined
  const draft =
    typeof intake.draft_ticket_id === "string" ? intake.draft_ticket_id : ""
  return (
    schedule?.ticketId === ticketId ||
    estimate?.ticket_id === ticketId ||
    draft === ticketId
  )
}

Deno.test("detach candidates match linked and intake-only ticket refs", () => {
  const ticket = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  assertEquals(
    conversationTouchesTicket(
      { maintenance_request_id: ticket, intake_state: null },
      ticket,
    ),
    true,
  )
  assertEquals(
    conversationTouchesTicket(
      {
        maintenance_request_id: "other",
        intake_state: {
          vendor_schedule: { step: "awaiting_availability", ticketId: ticket },
        },
      },
      ticket,
    ),
    true,
  )
  assertEquals(
    conversationTouchesTicket(
      {
        maintenance_request_id: null,
        intake_state: {
          awaiting_estimate_decision: { ticket_id: ticket, estimate_id: "e1" },
        },
      },
      ticket,
    ),
    true,
  )
  assertEquals(
    conversationTouchesTicket(
      {
        maintenance_request_id: null,
        intake_state: { draft_ticket_id: ticket, step: "urgency" },
      },
      ticket,
    ),
    true,
  )
  assertEquals(
    conversationTouchesTicket(
      {
        maintenance_request_id: "other",
        intake_state: {
          vendor_schedule: { ticketId: "other-ticket" },
        },
      },
      ticket,
    ),
    false,
  )
})
