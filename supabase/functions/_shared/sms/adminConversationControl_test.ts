/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { setAdminConversationTakeover } from "./adminConversationControl.ts"

function fakeDb(intake: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from() {
      const chain: Record<string, unknown> = {}
      for (const method of ["select", "eq", "insert", "order", "limit"]) chain[method] = () => chain
      chain.update = (row: Record<string, unknown>) => {
        updates.push(row)
        return chain
      }
      chain.single = async () => ({ data: { id: "evt-1" }, error: null })
      chain.maybeSingle = async () => ({
        data: {
          id: "conv-1",
          landlord_id: "landlord-1",
          external_phone_number: "+15550000000",
          sms_number_id: "num-1",
          intake_state: intake,
          resident_id: "res-1",
          vendor_id: null,
          maintenance_request_id: null,
          conversation_type: "resident_intake",
          status: "open",
        },
        error: null,
      })
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null }))
      return chain
    },
  }
  return { db, updates }
}

Deno.test("Return to Ulo clears the pause and a pending staff question", async () => {
  const { db, updates } = fakeDb({
    admin_takeover: { active: true, at: "2026-11-03T12:00:00Z", by: "dashboard" },
    awaiting_staff_reply: { messageId: "m1", sentAt: new Date().toISOString(), ticketId: null },
    other: "kept",
  })
  const result = await setAdminConversationTakeover(db as never, {
    conversationId: "conv-1",
    landlordId: "landlord-1",
    active: false,
  })
  assertEquals(result.ok, true)
  const intake = updates.find((row) => "intake_state" in row)?.intake_state as Record<string, unknown>
  assertEquals(intake, { other: "kept" })
})

Deno.test("Take over keeps a pending staff question", async () => {
  const pending = { messageId: "m1", sentAt: new Date().toISOString(), ticketId: null }
  const { db, updates } = fakeDb({ awaiting_staff_reply: pending })
  await setAdminConversationTakeover(db as never, {
    conversationId: "conv-1",
    landlordId: "landlord-1",
    active: true,
  })
  const intake = updates.find((row) => "intake_state" in row)?.intake_state as Record<string, unknown>
  assertEquals(intake.awaiting_staff_reply, pending)
  assertEquals((intake.admin_takeover as { active: boolean }).active, true)
})
