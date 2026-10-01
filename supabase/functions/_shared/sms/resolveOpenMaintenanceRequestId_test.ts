/**
 * P0: resolveOpenMaintenanceRequestId must fail closed — never unit_id alone.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

/**
 * Pure ownership gate mirroring resolveOpenMaintenanceRequestId after the P0 fix:
 * phone match or ticket.resident_id / resident_user_id match only.
 * unit_id / unit-label without resident fields → no ticket.
 */
export function ticketMatchesResidentIdentity(input: {
  ticket: {
    id: string
    resident_phone?: string | null
    resident_id?: string | null
    resident_user_id?: string | null
    unit_id?: string | null
  }
  fromPhoneE164?: string | null
  residentId?: string | null
  identityUnitId?: string | null
}): boolean {
  const phone = input.fromPhoneE164?.trim() || null
  if (phone) {
    const rowPhone = input.ticket.resident_phone?.trim() || ""
    if (rowPhone && rowPhone === phone) return true
  }
  const residentId = input.residentId?.trim() || null
  if (residentId) {
    const rid = input.ticket.resident_id?.trim() || ""
    const ruid = input.ticket.resident_user_id?.trim() || ""
    if (rid === residentId || ruid === residentId) return true
  }
  // Intentionally ignore identityUnitId / ticket.unit_id — fail closed.
  void input.identityUnitId
  return false
}

Deno.test("resolveOpen: phone match owns ticket", () => {
  assertEquals(
    ticketMatchesResidentIdentity({
      ticket: {
        id: "t1",
        resident_phone: "+14103718160",
        unit_id: "unit-bartlett",
      },
      fromPhoneE164: "+14103718160",
      residentId: "be896aae-8ca8-4fb6-b83c-b16625813f6a",
      identityUnitId: "unit-bartlett",
    }),
    true,
  )
})

Deno.test("resolveOpen: resident_id match owns ticket", () => {
  assertEquals(
    ticketMatchesResidentIdentity({
      ticket: {
        id: "t1",
        resident_id: "be896aae-8ca8-4fb6-b83c-b16625813f6a",
        unit_id: "unit-bartlett",
      },
      fromPhoneE164: null,
      residentId: "be896aae-8ca8-4fb6-b83c-b16625813f6a",
      identityUnitId: "unit-bartlett",
    }),
    true,
  )
})

Deno.test("resolveOpen: unit_id alone does NOT own ticket (fail closed)", () => {
  assertEquals(
    ticketMatchesResidentIdentity({
      ticket: {
        id: "hqs-1",
        resident_id: null,
        resident_phone: null,
        unit_id: "unit-bartlett",
      },
      fromPhoneE164: "+14103718160",
      residentId: "be896aae-8ca8-4fb6-b83c-b16625813f6a",
      identityUnitId: "unit-bartlett",
    }),
    false,
  )
})

Deno.test("resolveOpen: HQS null-resident on same unit → no ticket", () => {
  // Same shape as the 12 HQS tickets before resident_id retrofit.
  assertEquals(
    ticketMatchesResidentIdentity({
      ticket: {
        id: "d1548c67-21e9-45c4-95aa-9983689abef5",
        resident_id: null,
        resident_phone: null,
        unit_id: "2e7722df-3999-4d89-b158-3382f6471a85",
      },
      fromPhoneE164: "+14103718160",
      residentId: "be896aae-8ca8-4fb6-b83c-b16625813f6a",
      identityUnitId: "2e7722df-3999-4d89-b158-3382f6471a85",
    }),
    false,
  )
})
