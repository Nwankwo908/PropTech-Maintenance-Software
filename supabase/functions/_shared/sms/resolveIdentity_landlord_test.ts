/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { pickStrongerConversationType } from "./inbound_db.ts"
import { phoneMatchesAnyCandidate } from "./landlordAccountPhone.ts"
import { resolvePhoneIdentity } from "./resolveIdentity.ts"

const LANDLORD_ID = "de300000-0000-4000-8000-000000000004"
const OPS_PHONE = "+14708880274"

Deno.test("pickStrongerConversationType keeps landlord_update over resident_intake", () => {
  assertEquals(
    pickStrongerConversationType("landlord_update", "resident_intake"),
    "landlord_update",
  )
  assertEquals(
    pickStrongerConversationType("resident_intake", "landlord_update"),
    "landlord_update",
  )
  assertEquals(
    pickStrongerConversationType("vendor_alert", "resident_intake"),
    "vendor_alert",
  )
})

Deno.test("phoneMatchesAnyCandidate matches landlord account variants", () => {
  assertEquals(phoneMatchesAnyCandidate(OPS_PHONE, [OPS_PHONE]), true)
  assertEquals(phoneMatchesAnyCandidate("4708880274", [OPS_PHONE]), true)
  assertEquals(phoneMatchesAnyCandidate("+15551234567", [OPS_PHONE]), false)
})

type IdentityRow = {
  id: string
  landlord_id: string
  resident_id: string | null
  vendor_id: string | null
  unit_id: string | null
  phone_number: string
  identity_type: string
  verified: boolean
}

/**
 * Minimal supabase stand-in: landlords.phone is the ops number, and the stored
 * sms_identities row starts corrupted (resident, no resident_id) — the live bug.
 */
function mockSupabaseForCorruptedLandlordIdentity(state: {
  identity: IdentityRow
}) {
  const from = (table: string) => {
    const api: Record<string, unknown> = {}
    const chain = (): typeof api => api

    api.select = () => chain()
    api.eq = () => chain()
    api.in = () => chain()
    api.not = () => chain()
    api.is = () => chain()
    api.limit = () => chain()
    api.order = () => chain()
    api.maybeSingle = async () => {
      if (table === "landlords") {
        return { data: { id: LANDLORD_ID, phone: OPS_PHONE }, error: null }
      }
      return { data: null, error: null }
    }
    api.single = async () => {
      if (table === "sms_identities") {
        return { data: state.identity, error: null }
      }
      return { data: null, error: null }
    }
    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (table === "sms_identities") {
          resolve({ data: [state.identity], error: null })
          return
        }
        if (table === "landlords") {
          resolve({
            data: [{ id: LANDLORD_ID, phone: OPS_PHONE }],
            error: null,
          })
          return
        }
        resolve({ data: [], error: null })
      },
    }
    Object.assign(api, thenable)
    api.update = (patch: Record<string, unknown>) => {
      if (table === "sms_identities") {
        state.identity = {
          ...state.identity,
          ...patch,
          identity_type: String(
            patch.identity_type ?? state.identity.identity_type,
          ),
          resident_id:
            patch.resident_id === undefined
              ? state.identity.resident_id
              : (patch.resident_id as string | null),
          vendor_id:
            patch.vendor_id === undefined
              ? state.identity.vendor_id
              : (patch.vendor_id as string | null),
          verified:
            typeof patch.verified === "boolean"
              ? patch.verified
              : state.identity.verified,
        }
      }
      return {
        eq: () => ({
          select: () => ({
            single: async () => ({ data: state.identity, error: null }),
          }),
        }),
      }
    }
    api.insert = () => ({
      select: () => ({
        single: async () => ({ data: state.identity, error: null }),
      }),
    })
    api.delete = () => ({
      in: async () => ({ error: null }),
    })
    return api
  }

  return {
    from,
  } as unknown as import("https://esm.sh/@supabase/supabase-js@2.49.1").SupabaseClient
}

Deno.test(
  "landlords.phone never enters resident_intake / unknown — even from corrupted sms_identities",
  async () => {
    const state = {
      identity: {
        id: "ident-corrupt",
        landlord_id: LANDLORD_ID,
        resident_id: null,
        vendor_id: null,
        unit_id: null,
        phone_number: OPS_PHONE,
        identity_type: "resident",
        verified: false,
      } satisfies IdentityRow,
    }
    const supabase = mockSupabaseForCorruptedLandlordIdentity(state)

    for (const body of ["yes", "YES", "hi", "1", "Approve", "what's up"]) {
      // Reset corruption each turn so we prove repair, not only first-message cache.
      state.identity.identity_type = "resident"
      state.identity.resident_id = null
      state.identity.verified = false

      const result = await resolvePhoneIdentity(supabase, {
        fromNumber: OPS_PHONE,
        landlordId: LANDLORD_ID,
        messageBody: body,
        conversationStatus: "awaiting_unit_number",
      })

      assertEquals(result.identity.identity_type, "landlord")
      assertEquals(result.source, "landlord")
      assertEquals(result.continueIntake, false)
      assertEquals(result.selfHealingPhase, "none")
      assertEquals(result.conversationStatus, "open")
      assertEquals(state.identity.identity_type, "landlord")
      assertEquals(state.identity.resident_id, null)
    }
  },
)
