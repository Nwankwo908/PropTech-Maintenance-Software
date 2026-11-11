import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { chooseResidentForSubmit } from "./residentSubmitMatch.ts"

const residentA = {
  id: "a",
  email: "same@example.invalid",
  unit: "1",
  landlordId: "landlord-a",
  supabaseUserId: null,
}
const residentB = {
  ...residentA,
  id: "b",
  landlordId: "landlord-b",
}

Deno.test("one authorized resident is selected and a forged landlord is rejected", () => {
  assertEquals(
    chooseResidentForSubmit({
      linkedResidents: [],
      emailUnitMatches: [residentA],
      formLandlordId: null,
    }).ok,
    true,
  )
  const forged = chooseResidentForSubmit({
    linkedResidents: [],
    emailUnitMatches: [residentA],
    formLandlordId: "landlord-b",
  })
  assertEquals(forged.ok, false)
  if (!forged.ok) assertEquals(forged.status, 403)
})

Deno.test("the same email and unit on two accounts is not guessed", () => {
  const choice = chooseResidentForSubmit({
    linkedResidents: [],
    emailUnitMatches: [residentA, residentB],
    formLandlordId: "landlord-a",
  })
  assertEquals(choice.ok, false)
  if (!choice.ok) assertEquals(choice.status, 409)
})

Deno.test("an existing login is not moved to the other account", () => {
  const choice = chooseResidentForSubmit({
    linkedResidents: [{ ...residentA, supabaseUserId: "user-a" }],
    emailUnitMatches: [residentB],
    formLandlordId: "landlord-b",
  })
  assertEquals(choice.ok, false)
  if (!choice.ok) assertEquals(choice.status, 403)
})
