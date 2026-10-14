import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  landlordPickRecipientAllowed,
  landlordPickReplyMayExecute,
} from "./batchAccess.ts"

const ops = ["+15550000205"]

Deno.test("a pick batch is not sent to a number outside the landlord ops list", () => {
  assertEquals(landlordPickRecipientAllowed("+15550000999", ops), false)
  assertEquals(landlordPickRecipientAllowed("5550000205", ops), true)
})

Deno.test("a resident who was not sent the batch cannot decide it", () => {
  assertEquals(
    landlordPickReplyMayExecute({
      identityType: "resident",
      fromPhone: "+15550001111",
      recipientPhone: "+15550000205",
    }),
    false,
  )
})

Deno.test("a vendor who was not sent the batch cannot decide it", () => {
  assertEquals(
    landlordPickReplyMayExecute({
      identityType: "vendor",
      fromPhone: "+15550003333",
      recipientPhone: "+15550000205",
    }),
    false,
  )
})

Deno.test("a resident label on the ops phone may still answer the batch", () => {
  assertEquals(
    landlordPickReplyMayExecute({
      identityType: "resident",
      fromPhone: "555-000-0205",
      recipientPhone: "+1 555 000 0205",
    }),
    true,
  )
})
