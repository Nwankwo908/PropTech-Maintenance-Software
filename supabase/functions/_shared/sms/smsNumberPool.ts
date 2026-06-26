import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider } from "./providerFactory.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"

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

function phoneLookupVariants(input: string): string[] {
  const trimmed = input.trim()
  const e164 = normalizePhoneFlexible(trimmed)
  const digits = trimmed.replace(/\D/g, "")
  const set = new Set<string>()
  if (trimmed) set.add(trimmed)
  if (e164) set.add(e164)
  if (digits) {
    set.add(digits)
    if (digits.length === 11 && digits.startsWith("1")) set.add(`+${digits}`)
    if (digits.length === 10) set.add(`+1${digits}`)
  }
  return [...set]
}

function resolveAutoProvisionInput(params: {
  phoneNumber?: string | null
  providerNumberSid?: string | null
  areaCode?: string | null
}) {
  const phoneNumber =
    params.phoneNumber?.trim() ||
    Deno.env.get("SMS_AUTO_PROVISION_PHONE_NUMBER")?.trim() ||
    Deno.env.get("TELNYX_FROM_NUMBER")?.trim() ||
    Deno.env.get("TWILIO_FROM_NUMBER")?.trim() ||
    null

  const providerNumberSid =
    params.providerNumberSid?.trim() ||
    Deno.env.get("SMS_AUTO_PROVISION_NUMBER_SID")?.trim() ||
    null

  const areaCode =
    params.areaCode?.trim() ||
    Deno.env.get("SMS_AUTO_PROVISION_AREA_CODE")?.trim() ||
    undefined

  return { phoneNumber, providerNumberSid, areaCode }
}

export async function findActiveLandlordMain(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordSmsNumberRow | null> {
  const { data, error } = await supabase
    .from("sms_numbers")
    .select(SMS_NUMBER_FIELDS)
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[smsNumberPool] find landlord_main", error.message)
    throw new Error("Failed to look up landlord SMS number")
  }

  return (data as LandlordSmsNumberRow | null) ?? null
}

/** Claim oldest pool number with status=available (legacy: active + unassigned). */
export async function claimAvailablePoolNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordSmsNumberRow | null> {
  const { data: availableRows, error: availErr } = await supabase
    .from("sms_numbers")
    .select(SMS_NUMBER_FIELDS)
    .eq("purpose", "pool")
    .eq("status", "available")
    .is("landlord_id", null)
    .order("created_at", { ascending: true })
    .limit(1)

  if (availErr) {
    console.error("[smsNumberPool] pool lookup", availErr.message)
    throw new Error("Failed to look up SMS pool numbers")
  }

  let candidate = (availableRows?.[0] as LandlordSmsNumberRow | undefined) ?? null

  if (!candidate) {
    const { data: legacyRows, error: legacyErr } = await supabase
      .from("sms_numbers")
      .select(SMS_NUMBER_FIELDS)
      .eq("purpose", "pool")
      .eq("status", "active")
      .is("landlord_id", null)
      .order("created_at", { ascending: true })
      .limit(1)

    if (legacyErr) {
      console.error("[smsNumberPool] legacy pool lookup", legacyErr.message)
      throw new Error("Failed to look up SMS pool numbers")
    }

    candidate = (legacyRows?.[0] as LandlordSmsNumberRow | undefined) ?? null
  }

  if (!candidate) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .update({
      landlord_id: landlordId,
      purpose: "landlord_main",
      status: "active",
      release_auto_reply: null,
    })
    .eq("id", candidate.id)
    .eq("purpose", "pool")
    .is("landlord_id", null)
    .in("status", ["available", "active"])
    .select(SMS_NUMBER_FIELDS)
    .maybeSingle()

  if (error) {
    console.error("[smsNumberPool] pool claim", error.message)
    throw new Error("Failed to claim pool SMS number")
  }

  return (data as LandlordSmsNumberRow | null) ?? null
}

/** Claim a specific pool row by dialed number (inbound auto-assign). */
export async function claimPoolNumberByPhone(
  supabase: SupabaseClient,
  params: { phoneNumber: string; landlordId: string },
): Promise<LandlordSmsNumberRow | null> {
  const variants = phoneLookupVariants(params.phoneNumber)
  if (variants.length === 0) return null

  const { data: candidate, error: lookupErr } = await supabase
    .from("sms_numbers")
    .select(SMS_NUMBER_FIELDS)
    .in("phone_number", variants)
    .eq("purpose", "pool")
    .is("landlord_id", null)
    .in("status", ["available", "active"])
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error("[smsNumberPool] pool lookup by phone", lookupErr.message)
    throw new Error("Failed to look up SMS pool number")
  }

  if (!candidate?.id) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .update({
      landlord_id: params.landlordId,
      purpose: "landlord_main",
      status: "active",
      release_auto_reply: null,
    })
    .eq("id", candidate.id)
    .eq("purpose", "pool")
    .is("landlord_id", null)
    .in("status", ["available", "active"])
    .select(SMS_NUMBER_FIELDS)
    .maybeSingle()

  if (error) {
    console.error("[smsNumberPool] pool claim by phone", error.message)
    throw new Error("Failed to claim pool SMS number")
  }

  return (data as LandlordSmsNumberRow | null) ?? null
}

async function insertProvisionedLandlordMain(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phoneNumber: string
    provider: string
    providerNumberSid: string | null
    messagingServiceSid?: string | null
  },
): Promise<LandlordSmsNumberRow> {
  const { data, error } = await supabase
    .from("sms_numbers")
    .insert({
      landlord_id: params.landlordId,
      phone_number: params.phoneNumber,
      provider: params.provider,
      provider_number_sid: params.providerNumberSid,
      provider_messaging_service_sid: params.messagingServiceSid ?? null,
      purpose: "landlord_main",
      status: "active",
    })
    .select(SMS_NUMBER_FIELDS)
    .single()

  if (error || !data?.id) {
    console.error("[smsNumberPool] insert provisioned number", error?.message)
    throw new Error("Failed to save provisioned SMS number")
  }

  return data as LandlordSmsNumberRow
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

/**
 * Provision a landlord_main SMS number:
 * 1. Return existing active landlord_main
 * 2. Claim pool number (status=available)
 * 3. Call SMSProvider.provisionNumber and persist
 */
export async function provisionLandlordMainNumber(
  supabase: SupabaseClient,
  params: {
    landlordId?: string | null
    phoneNumber?: string | null
    providerNumberSid?: string | null
    areaCode?: string | null
  },
): Promise<ProvisionSmsNumberResult> {
  const landlordId = resolveLandlordId(params.landlordId)

  const existing = await findActiveLandlordMain(supabase, landlordId)
  if (existing) {
    return {
      smsNumberId: existing.id,
      phoneNumber: existing.phone_number,
      provider: existing.provider,
      providerNumberSid: existing.provider_number_sid,
      source: "existing",
      created: false,
    }
  }

  const fromPool = await claimAvailablePoolNumber(supabase, landlordId)
  if (fromPool) {
    await recordNumberGraphEvent(supabase, {
      landlordId,
      eventType: "sms.number_provisioned",
      smsNumberId: fromPool.id,
      metadata: {
        phone_number: fromPool.phone_number,
        provider: fromPool.provider,
        provider_number_sid: fromPool.provider_number_sid,
        source: "pool",
      },
    })

    return {
      smsNumberId: fromPool.id,
      phoneNumber: fromPool.phone_number,
      provider: fromPool.provider,
      providerNumberSid: fromPool.provider_number_sid,
      source: "pool",
      created: true,
    }
  }

  const autoInput = resolveAutoProvisionInput(params)
  const provider = getSMSProvider()

  const provisioned = await provider.provisionNumber({
    phoneNumber: autoInput.phoneNumber ?? undefined,
    providerNumberSid: autoInput.providerNumberSid ?? undefined,
    areaCode: autoInput.areaCode,
    country: "US",
  })

  const saved = await insertProvisionedLandlordMain(supabase, {
    landlordId,
    phoneNumber: provisioned.phoneNumber,
    provider: provisioned.provider,
    providerNumberSid: provisioned.providerNumberSid,
    messagingServiceSid: provisioned.messagingServiceSid ?? null,
  })

  await recordNumberGraphEvent(supabase, {
    landlordId,
    eventType: "sms.number_provisioned",
    smsNumberId: saved.id,
    metadata: {
      phone_number: saved.phone_number,
      provider: saved.provider,
      provider_number_sid: saved.provider_number_sid,
      provider_messaging_service_sid: saved.provider_messaging_service_sid,
      source: "provider",
      area_code: autoInput.areaCode ?? null,
    },
  })

  console.info("[smsNumberPool] provisioned via provider", {
    landlordId,
    phoneNumber: saved.phone_number,
    smsNumberId: saved.id,
  })

  return {
    smsNumberId: saved.id,
    phoneNumber: saved.phone_number,
    provider: saved.provider,
    providerNumberSid: saved.provider_number_sid,
    source: "provider",
    created: true,
  }
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
