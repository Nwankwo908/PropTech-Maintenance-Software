import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider } from "./providerFactory.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { LIMITED_ALPHA_1_TWILIO_SMS_NUMBER, landlordMayUseSharedSmsLine } from "../../../../shared/landlordCapabilities.ts"

export type LandlordSmsNumberRow = {
  id: string
  landlord_id: string | null
  phone_number: string
  provider: string
  provider_number_sid: string | null
  provider_messaging_service_sid: string | null
  status: string
  purpose: string
  release_auto_reply?: string | null
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function resolveLandlordId(explicit?: string | null): string {
  const id = explicit?.trim() || Deno.env.get("DEFAULT_LANDLORD_ID")?.trim()
  if (!id || !uuidRe.test(id)) {
    throw new Error("landlordId is required (uuid) or set DEFAULT_LANDLORD_ID")
  }
  return id
}

export type ProvisionSmsNumberResult = {
  smsNumberId: string
  phoneNumber: string
  provider: string
  providerNumberSid: string | null
  source: "existing" | "pool" | "provider"
  created: boolean
}

export type ReleaseSmsNumberResult = {
  smsNumberId: string
  phoneNumber: string
  status: "released_pending" | "released"
  returnedToPool: boolean
  providerReleased: boolean
}

const SMS_NUMBER_FIELDS =
  "id, landlord_id, phone_number, provider, provider_number_sid, provider_messaging_service_sid, status, purpose, release_auto_reply"

/** Compatibility API: lookup only, with no account ownership transfer. */
export async function findActiveLandlordMain(supabase: SupabaseClient, landlordId: string): Promise<LandlordSmsNumberRow | null> {
  const { findActiveLandlordMainNumber } = await import("./landlordSmsOnboarding.ts")
  return await findActiveLandlordMainNumber(supabase, landlordId)
}

/** Retired: pool resources cannot be assigned to individual landlords. */
export function claimAvailablePoolNumber(_db: SupabaseClient, _landlordId: string): Promise<LandlordSmsNumberRow | null> {
  return Promise.reject(new Error("Per-landlord SMS number allocation is retired"))
}
export function claimPoolNumberByPhone(_db: SupabaseClient, _params: { phoneNumber: string; landlordId: string }): Promise<LandlordSmsNumberRow | null> {
  return Promise.reject(new Error("Per-landlord SMS number allocation is retired"))
}

/** @deprecated Returns the canonical shared line only; never allocates or writes. */
export async function provisionLandlordMainNumber(supabase: SupabaseClient, params: {
  landlordId?: string | null; phoneNumber?: string | null; providerNumberSid?: string | null; areaCode?: string | null;
}): Promise<ProvisionSmsNumberResult> {
  const landlordId = params.landlordId?.trim()
  if (!landlordId || !landlordMayUseSharedSmsLine(landlordId)) throw new Error("A current landlord account is required")
  if (params.phoneNumber != null || params.providerNumberSid != null || params.areaCode != null) throw new Error("SMS number overrides are no longer supported")
  const number = await findActiveLandlordMain(supabase, landlordId)
  if (!number) throw new Error("Shared Ulo SMS line is unavailable")
  return { smsNumberId: number.id, phoneNumber: LIMITED_ALPHA_1_TWILIO_SMS_NUMBER, provider: "twilio", providerNumberSid: number.provider_number_sid, source: "existing", created: false }
}

async function recordNumberGraphEvent(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    eventType: string
    smsNumberId: string
    metadata: Record<string, unknown>
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: params.eventType,
    source: "edge_function",
    actor_type: "system",
    metadata: {
      sms_number_id: params.smsNumberId,
      ...params.metadata,
    },
  })
}

async function resolveLandlordMainToRelease(
  supabase: SupabaseClient,
  params: { landlordId?: string | null; smsNumberId?: string | null },
): Promise<LandlordSmsNumberRow & { release_auto_reply?: string | null }> {
  if (params.smsNumberId?.trim()) {
    const { data, error } = await supabase
      .from("sms_numbers")
      .select(SMS_NUMBER_FIELDS)
      .eq("id", params.smsNumberId.trim())
      .maybeSingle()

    if (error) {
      console.error("[smsNumberPool] load number by id", error.message)
      throw new Error("Failed to load SMS number")
    }
    if (!data) throw new Error("SMS number not found")
    return data as LandlordSmsNumberRow & { release_auto_reply?: string | null }
  }

  const landlordId = resolveLandlordId(params.landlordId)
  const { data, error } = await supabase
    .from("sms_numbers")
    .select(SMS_NUMBER_FIELDS)
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .in("status", ["active", "released_pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[smsNumberPool] load landlord_main", error.message)
    throw new Error("Failed to load landlord SMS number")
  }
  if (!data) throw new Error("No landlord_main SMS number found to release")

  return data as LandlordSmsNumberRow & { release_auto_reply?: string | null }
}

async function archiveOpenConversationsForNumber(
  supabase: SupabaseClient,
  smsNumberId: string,
): Promise<number> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("sms_conversations")
    .update({ status: "archived", updated_at: now })
    .eq("sms_number_id", smsNumberId)
    .eq("status", "open")
    .select("id")

  if (error) {
    console.error("[smsNumberPool] archive conversations", error.message)
    return 0
  }

  return data?.length ?? 0
}

/**
 * Release a landlord_main number.
 * - Default: mark released_pending (stops active inbound routing; optional auto-reply)
 * - completeRelease=true: call provider releaseNumber, set released_at, return to pool
 */
export async function releaseLandlordMainNumber(
  supabase: SupabaseClient,
  params: {
    landlordId?: string | null
    smsNumberId?: string | null
    finalAutoReply?: string | null
    completeRelease?: boolean
  },
): Promise<ReleaseSmsNumberResult> {
  const row = await resolveLandlordMainToRelease(supabase, params)
  const landlordId = row.landlord_id ?? resolveLandlordId(params.landlordId)

  if (row.status === "released") {
    throw new Error("SMS number is already released")
  }

  const autoReply =
    params.finalAutoReply?.trim() ||
    Deno.env.get("SMS_RELEASE_AUTO_REPLY")?.trim() ||
    "This Ulo SMS line is no longer active. Please contact your property manager directly."

  if (row.status === "released_pending" && !params.completeRelease) {
    return {
      smsNumberId: row.id,
      phoneNumber: row.phone_number,
      status: "released_pending",
      returnedToPool: false,
      providerReleased: false,
    }
  }

  if (row.status !== "released_pending") {
    const conversationsArchived = await archiveOpenConversationsForNumber(
      supabase,
      row.id,
    )

    const { error: pendingErr } = await supabase
      .from("sms_numbers")
      .update({
        status: "released_pending",
        release_auto_reply: autoReply,
      })
      .eq("id", row.id)

    if (pendingErr) {
      console.error("[smsNumberPool] mark released_pending", pendingErr.message)
      throw new Error("Failed to mark number released_pending")
    }

    await recordNumberGraphEvent(supabase, {
      landlordId,
      eventType: "sms.number_released",
      smsNumberId: row.id,
      metadata: {
        phone_number: row.phone_number,
        provider: row.provider,
        provider_number_sid: row.provider_number_sid,
        phase: "released_pending",
        conversations_archived: conversationsArchived,
        final_auto_reply: autoReply,
      },
    })

    if (!params.completeRelease) {
      return {
        smsNumberId: row.id,
        phoneNumber: row.phone_number,
        status: "released_pending",
        returnedToPool: false,
        providerReleased: false,
      }
    }
  }

  let providerReleased = false
  if (row.provider_number_sid?.trim()) {
    try {
      const provider = getSMSProvider()
      await provider.releaseNumber({
        providerNumberSid: row.provider_number_sid.trim(),
      })
      providerReleased = true
    } catch (e) {
      console.error("[smsNumberPool] provider releaseNumber", e)
      throw new Error(
        e instanceof Error ? e.message : "Provider releaseNumber failed",
      )
    }
  }

  const now = new Date().toISOString()
  const { error: finalErr } = await supabase
    .from("sms_numbers")
    .update({
      landlord_id: null,
      vendor_id: null,
      purpose: "pool",
      status: "available",
      released_at: now,
      release_auto_reply: null,
      provider_messaging_service_sid: null,
    })
    .eq("id", row.id)

  if (finalErr) {
    console.error("[smsNumberPool] finalize release", finalErr.message)
    throw new Error("Failed to finalize SMS number release")
  }

  await recordNumberGraphEvent(supabase, {
    landlordId,
    eventType: "sms.number_released",
    smsNumberId: row.id,
    metadata: {
      phone_number: row.phone_number,
      provider: row.provider,
      provider_number_sid: row.provider_number_sid,
      phase: "released",
      released_at: now,
      provider_released: providerReleased,
      returned_to_pool: true,
    },
  })

  return {
    smsNumberId: row.id,
    phoneNumber: row.phone_number,
    status: "released",
    returnedToPool: true,
    providerReleased,
  }
}
