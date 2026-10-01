/**
 * Landlord access pure checks for Ask Ulo.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  DEMO_LANDLORD_ID,
  emailMayAccessLandlordId,
  seededLandlordIdForEmail,
} from "../../../../../../shared/admin/landlordAccess.ts"
import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
} from "../../../../../../shared/landlordCapabilities.ts"
import { decideAskUloLandlordAccess } from "../../auth/assertAskUloLandlordAccess.ts"

Deno.test("seeded email maps to fixed landlord", () => {
  assertEquals(
    seededLandlordIdForEmail("limitedalpha1@ulohome.io"),
    LIMITED_ALPHA_1_LANDLORD_ID,
  )
  assertEquals(
    seededLandlordIdForEmail("demo@ulohome.io"),
    DEMO_LANDLORD_ID,
  )
})

Deno.test("seeded landlord cannot access another landlord_id", () => {
  assertEquals(
    decideAskUloLandlordAccess({
      email: "limitedalpha1@ulohome.io",
      landlordId: LIMITED_ALPHA_2_LANDLORD_ID,
    }),
    false,
  )
  assertEquals(
    decideAskUloLandlordAccess({
      email: "limitedalpha1@ulohome.io",
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
    }),
    true,
  )
})

Deno.test("staff core email may use switcher landlords only", () => {
  assertEquals(
    emailMayAccessLandlordId({
      email: "emeka@ulohome.io",
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
    }),
    true,
  )
  assertEquals(
    emailMayAccessLandlordId({
      email: "osi@ulohome.io",
      landlordId: DEMO_LANDLORD_ID,
    }),
    true,
  )
  assertEquals(
    emailMayAccessLandlordId({
      email: "emeka@ulohome.io",
      landlordId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }),
    false,
  )
})

Deno.test("portal member only for their landlord_id", () => {
  assertEquals(
    emailMayAccessLandlordId({
      email: "teammate@example.com",
      landlordId: LIMITED_ALPHA_2_LANDLORD_ID,
      memberLandlordIds: [LIMITED_ALPHA_2_LANDLORD_ID],
    }),
    true,
  )
  assertEquals(
    emailMayAccessLandlordId({
      email: "teammate@example.com",
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      memberLandlordIds: [LIMITED_ALPHA_2_LANDLORD_ID],
    }),
    false,
  )
})
