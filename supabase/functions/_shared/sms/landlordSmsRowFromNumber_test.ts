import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { landlordSmsRowFromNumber } from "./landlordSmsOnboarding.ts"

Deno.test("landlordSmsRowFromNumber reads phone_number only", () => {
  assertEquals(
    landlordSmsRowFromNumber({ phone_number: " +18775803356 " }),
    "+18775803356",
  )
  assertEquals(landlordSmsRowFromNumber({ phone_number: "" }), "")
  assertEquals(landlordSmsRowFromNumber(null), "")
  assertEquals(landlordSmsRowFromNumber(undefined), "")
})

Deno.test("phantom e164 on sms_numbers row must not be treated as the from-number", () => {
  const row = { phone_number: "+18775803356" } as {
    phone_number: string
    e164?: string
  }
  // Regression: intake silence once used line?.e164 (always undefined).
  const wrongField = row.e164?.trim() || ""
  assertEquals(wrongField, "")
  assertEquals(landlordSmsRowFromNumber(row), "+18775803356")
})
