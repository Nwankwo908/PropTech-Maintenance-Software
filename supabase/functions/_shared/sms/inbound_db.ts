import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { claimPoolNumberByPhone } from "./smsNumberPool.ts"

/** Normalize to E.164 when possible; fall back to trimmed raw for lookup. */
export function normalizeSmsPhone(input: string): string {
  return normalizePhoneFlexible(input) ?? input.trim()
}

/** Candidate strings for DB phone equality (E.164 + digits-only). */
export function phoneLookupVariants(input: string): string[] {
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

export type SmsNumberRow = {
  id: string
  landlord_id: string | null
  vendor_id: string | null
  phone_number: string
  provider: string
  purpose: string
  status: string
  release_auto_reply?: string | null
}

export async function lookupSmsNumberByTo(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  const variants = phoneLookupVariants(toNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .select(
      "id, landlord_id, vendor_id, phone_number, provider, purpose, status, release_auto_reply",
    )
    .in("phone_number", variants)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] sms_numbers lookup", error.message)
    throw new Error("Failed to look up SMS number")
  }

  return (data as SmsNumberRow | null) ?? null
}

/**
 * Resolve the Ulo line for an inbound SMS.
 * Active landlord_main first; otherwise auto-claim an available pool row using DEFAULT_LANDLORD_ID.
 */
export async function resolveInboundSmsNumber(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  const active = await lookupSmsNumberByTo(supabase, toNumber)
  if (active) return active

  const variants = phoneLookupVariants(toNumber)
  if (variants.length === 0) return null

  const { data: poolRow, error: poolErr } = await supabase
    .from("sms_numbers")
    .select(
      "id, landlord_id, vendor_id, phone_number, provider, purpose, status, release_auto_reply",
    )
    .in("phone_number", variants)
    .eq("purpose", "pool")
    .is("landlord_id", null)
    .in("status", ["available", "active"])
    .limit(1)
    .maybeSingle()

  if (poolErr) {
    console.error("[sms-inbound] pool number lookup", poolErr.message)
    throw new Error("Failed to look up SMS pool number")
  }

  if (!poolRow) return null

  const landlordId = Deno.env.get("DEFAULT_LANDLORD_ID")?.trim()
  if (!landlordId) {
    console.error("[sms-inbound] pool number matched but DEFAULT_LANDLORD_ID is unset", {
      to: toNumber,
      smsNumberId: poolRow.id,
    })
    return null
  }

  const claimed = await claimPoolNumberByPhone(supabase, {
    phoneNumber: toNumber,
    landlordId,
  })

  if (claimed) {
    console.info("[sms-inbound] auto-claimed pool number for inbound", {
      to: toNumber,
      landlordId,
      smsNumberId: claimed.id,
    })
    return {
      id: claimed.id,
      landlord_id: claimed.landlord_id,
      vendor_id: null,
      phone_number: claimed.phone_number,
      provider: claimed.provider,
      purpose: claimed.purpose,
      status: claimed.status,
      release_auto_reply: claimed.release_auto_reply ?? null,
    }
  }

  return null
}

/** Numbers in churn — inbound gets auto-reply only, no workflow routing. */
export async function lookupReleasedPendingSmsNumber(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  const variants = phoneLookupVariants(toNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .select(
      "id, landlord_id, vendor_id, phone_number, provider, purpose, status, release_auto_reply",
    )
    .in("phone_number", variants)
    .eq("status", "released_pending")
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] released_pending lookup", error.message)
    return null
  }

  return (data as SmsNumberRow | null) ?? null
}

export type SmsIdentityRow = {
  id: string
  landlord_id: string | null
  resident_id: string | null
  vendor_id: string | null
  unit_id: string | null
  phone_number: string
  identity_type: string
  verified: boolean
}

const smsIdentitySelect =
  "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified"

/** All identity rows matching phone format variants for a landlord (may be >1 if stored inconsistently). */
export async function findSmsIdentitiesByPhone(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow[]> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return []

  const { data, error } = await supabase
    .from("sms_identities")
    .select(smsIdentitySelect)
    .eq("landlord_id", landlordId)
    .in("phone_number", variants)

  if (error) {
    console.error("[sms-inbound] sms_identities lookup", error.message)
    throw new Error("Failed to look up SMS identity")
  }

  return (data as SmsIdentityRow[] | null) ?? []
}

function pickCanonicalSmsIdentity(
  rows: SmsIdentityRow[],
  e164: string,
): SmsIdentityRow | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]

  const ranked = [...rows].sort((a, b) => {
    const aE164 = a.phone_number === e164 ? 0 : 1
    const bE164 = b.phone_number === e164 ? 0 : 1
    if (aE164 !== bE164) return aE164 - bE164

    const aKnown = a.identity_type !== "unknown" ? 0 : 1
    const bKnown = b.identity_type !== "unknown" ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown

    return a.id.localeCompare(b.id)
  })

  return ranked[0] ?? null
}

export async function lookupSmsIdentity(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow | null> {
  const e164 = normalizePhoneFlexible(fromNumber)
  const rows = await findSmsIdentitiesByPhone(supabase, fromNumber, landlordId)
  return pickCanonicalSmsIdentity(rows, e164 ?? normalizeSmsPhone(fromNumber))
}

export type UpsertSmsIdentityForPhoneParams = {
  landlordId: string
  phone: string
  identityType: "resident" | "vendor" | "landlord"
  residentId?: string | null
  vendorId?: string | null
  unitId?: string | null
}

/**
 * Create or upgrade an sms_identities row for a landlord-scoped phone.
 * Normalizes to E.164 before match/insert, upgrades unknown identities, preserves first_seen_at.
 */
export async function upsertSmsIdentityForPhone(
  supabase: SupabaseClient,
  params: UpsertSmsIdentityForPhoneParams,
): Promise<SmsIdentityRow | null> {
  const e164 = normalizePhoneFlexible(params.phone)
  if (!e164) {
    console.warn("[sms] upsertSmsIdentityForPhone: invalid phone", params.phone)
    return null
  }

  const landlordId = params.landlordId.trim()
  const now = new Date().toISOString()
  const matches = await findSmsIdentitiesByPhone(supabase, params.phone, landlordId)
  const existing = pickCanonicalSmsIdentity(matches, e164)
  const duplicateIds = matches
    .filter((row) => row.id !== existing?.id)
    .map((row) => row.id)

  const identityPatch =
    params.identityType === "resident"
      ? {
          identity_type: "resident" as const,
          resident_id: params.residentId?.trim() || null,
          vendor_id: null,
          unit_id: params.unitId?.trim() || null,
          verified: false,
        }
      : params.identityType === "landlord"
        ? {
            identity_type: "landlord" as const,
            resident_id: null,
            vendor_id: null,
            unit_id: null,
            verified: true,
          }
        : {
            identity_type: "vendor" as const,
            vendor_id: params.vendorId?.trim() || null,
            resident_id: null,
            unit_id: null,
            verified: false,
          }

  let result: SmsIdentityRow

  if (existing) {
    const canApplyType =
      existing.identity_type === "unknown" ||
      existing.identity_type === params.identityType

    const updatePayload = canApplyType
      ? { ...identityPatch, phone_number: e164, last_seen_at: now }
      : { phone_number: e164, last_seen_at: now }

    const { data, error } = await supabase
      .from("sms_identities")
      .update(updatePayload)
      .eq("id", existing.id)
      .select(smsIdentitySelect)
      .single()

    if (error || !data) {
      console.error("[sms] upsertSmsIdentityForPhone update", error?.message)
      throw new Error("Failed to update SMS identity")
    }

    result = data as SmsIdentityRow
  } else {
    const { data, error } = await supabase
      .from("sms_identities")
      .insert({
        landlord_id: landlordId,
        phone_number: e164,
        ...identityPatch,
        last_seen_at: now,
      })
      .select(smsIdentitySelect)
      .single()

    if (error || !data) {
      if (error?.code === "23505") {
        const retryExisting = await lookupSmsIdentity(
          supabase,
          params.phone,
          landlordId,
        )
        if (retryExisting) {
          return upsertSmsIdentityForPhone(supabase, params)
        }
      }
      console.error("[sms] upsertSmsIdentityForPhone insert", error?.message)
      throw new Error("Failed to create SMS identity")
    }

    result = data as SmsIdentityRow
  }

  if (duplicateIds.length > 0) {
    const { error: dedupeErr } = await supabase
      .from("sms_identities")
      .delete()
      .in("id", duplicateIds)
    if (dedupeErr) {
      console.warn(
        "[sms] upsertSmsIdentityForPhone dedupe failed",
        dedupeErr.message,
      )
    }
  }

  return result
}

export async function upsertSmsIdentity(
  supabase: SupabaseClient,
  params: {
    fromNumber: string
    landlordId: string
    existing: SmsIdentityRow | null
    patch: Partial<
      Pick<
        SmsIdentityRow,
        "identity_type" | "resident_id" | "vendor_id" | "unit_id" | "verified"
      >
    >
  },
): Promise<SmsIdentityRow> {
  const e164 = normalizePhoneFlexible(params.fromNumber)
  const normalizedFrom = e164 ?? params.fromNumber.trim()
  const now = new Date().toISOString()

  if (params.existing) {
    const { data, error } = await supabase
      .from("sms_identities")
      .update({
        ...params.patch,
        ...(e164 ? { phone_number: e164 } : {}),
        last_seen_at: now,
      })
      .eq("id", params.existing.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()

    if (error || !data) {
      console.error("[sms-inbound] sms_identities update", error?.message)
      throw new Error("Failed to update SMS identity")
    }

    return data as SmsIdentityRow
  }

  const { data, error } = await supabase
    .from("sms_identities")
    .insert({
      landlord_id: params.landlordId,
      phone_number: normalizedFrom,
      verified: false,
      ...params.patch,
    })
    .select(
      "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
    )
    .single()

  if (error || !data) {
    if (error?.code === "23505") {
      const existing = await lookupSmsIdentity(
        supabase,
        params.fromNumber,
        params.landlordId,
      )
      if (existing) {
        return upsertSmsIdentity(supabase, {
          ...params,
          existing,
        })
      }
    }
    console.error("[sms-inbound] sms_identities insert", error?.message)
    throw new Error("Failed to create SMS identity")
  }

  return data as SmsIdentityRow
}

export async function createUnknownIdentity(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow> {
  const normalizedFrom = normalizeSmsPhone(fromNumber)
  const { data, error } = await supabase
    .from("sms_identities")
    .insert({
      landlord_id: landlordId,
      phone_number: normalizedFrom,
      identity_type: "unknown",
      verified: false,
    })
    .select(
      "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
    )
    .single()

  if (error || !data) {
    if (error?.code === "23505") {
      const existing = await lookupSmsIdentity(supabase, fromNumber, landlordId)
      if (existing) return existing
    }
    console.error("[sms-inbound] sms_identities insert", error?.message)
    throw new Error("Failed to create SMS identity")
  }

  return data as SmsIdentityRow
}

/** Self-heal unknown identities by matching resident/vendor phone records. */
export async function trySelfHealIdentity(
  supabase: SupabaseClient,
  identity: SmsIdentityRow,
  fromNumber: string,
): Promise<SmsIdentityRow> {
  if (identity.identity_type !== "unknown") return identity

  const variants = phoneLookupVariants(fromNumber)

  const { data: vendorHit } = await supabase
    .from("vendors")
    .select("id, phone")
    .in("phone", variants)
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  if (vendorHit?.id) {
    const { data: updated, error } = await supabase
      .from("sms_identities")
      .update({
        identity_type: "vendor",
        vendor_id: vendorHit.id,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", identity.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()
    if (!error && updated) {
      console.info("[sms-inbound] self-healed identity to vendor", identity.id)
      return updated as SmsIdentityRow
    }
  }

  const { data: users } = await supabase
    .from("users")
    .select("id, phone, unit")
    .in("phone", variants)
    .limit(1)

  const resident = users?.[0] as { id: string; phone: string; unit: string | null } | undefined
  if (resident?.id) {
    const { data: updated, error } = await supabase
      .from("sms_identities")
      .update({
        identity_type: "resident",
        resident_id: resident.id,
        unit_id: resident.unit ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", identity.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()
    if (!error && updated) {
      console.info("[sms-inbound] self-healed identity to resident", identity.id)
      return updated as SmsIdentityRow
    }
  }

  const e164 = normalizePhoneFlexible(fromNumber)
  if (e164) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("id, resident_phone, unit")
      .eq("resident_phone", e164)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ticket?.id) {
      const { data: updated, error } = await supabase
        .from("sms_identities")
        .update({
          identity_type: "resident",
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", identity.id)
        .select(
          "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
        )
        .single()
      if (!error && updated) {
        console.info(
          "[sms-inbound] self-healed identity via maintenance_requests",
          identity.id,
        )
        return updated as SmsIdentityRow
      }
    }
  }

  return identity
}

export async function touchIdentityLastSeen(
  supabase: SupabaseClient,
  identityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("sms_identities")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", identityId)
  if (error) {
    console.error("[sms-inbound] identity last_seen update", error.message)
  }
}

export function conversationTypeForIdentity(
  identity: SmsIdentityRow | string,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  if (typeof identity === "string") {
    return resolveConversationTypeFromFields(identity, null, null)
  }
  return resolveConversationTypeFromFields(
    identity.identity_type,
    identity.vendor_id,
    identity.resident_id,
  )
}

/** Pick sms_conversations.conversation_type from resolved identity fields. */
export function resolveConversationTypeFromFields(
  identityType: string,
  vendorId: string | null | undefined,
  residentId: string | null | undefined,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  const vendor = vendorId?.trim() ?? ""
  const resident = residentId?.trim() ?? ""

  if (identityType === "vendor" && vendor) {
    return "vendor_alert"
  }
  if (identityType === "landlord") {
    return "landlord_update"
  }
  if (identityType === "resident" && resident) {
    return "resident_intake"
  }
  // unknown senders + incomplete vendor rows → tenant intake / self-healing
  return "resident_intake"
}

export function sanitizeConversationType(
  conversationType: string,
  identity: SmsIdentityRow,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  const resolved = conversationTypeForIdentity(identity)
  if (conversationType === "vendor_alert" && !identity.vendor_id?.trim()) {
    return "resident_intake"
  }
  if (conversationType === "vendor_alert" && identity.vendor_id?.trim()) {
    return "vendor_alert"
  }
  return resolved
}

export async function findOpenConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
  },
): Promise<{ id: string; maintenance_request_id: string | null; status: string; conversation_type: string } | null> {
  const external = normalizeSmsPhone(params.externalPhone)
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("id, maintenance_request_id, status, conversation_type")
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("external_phone_number", external)
    .in("status", [
      "open",
      "awaiting_unit_number",
      "unresolved",
      "intake_collecting",
      "intake_confirm",
      "intake_edit",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] conversation lookup", error.message)
    throw new Error("Failed to look up conversation")
  }

  return data as { id: string; maintenance_request_id: string | null; status: string; conversation_type: string } | null
}

/**
 * Find the most recent resident SMS thread for a phone (any status), including
 * completed late-rent / reminder threads that should receive follow-up SMS.
 * Falls back to resident_id when the phone on the thread was stored incorrectly
 * (e.g. demo ai_copilot rows keyed to the Ulo line).
 */
export async function findResidentConversationByPhone(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    residentId?: string | null
  },
): Promise<{ id: string; maintenance_request_id: string | null; status: string; conversation_type: string } | null> {
  const external = normalizeSmsPhone(params.externalPhone)
  const selectCols = "id, maintenance_request_id, status, conversation_type"

  const byPhone = await supabase
    .from("sms_conversations")
    .select(selectCols)
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("external_phone_number", external)
    .is("vendor_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byPhone.error) {
    console.error("[sms-inbound] resident conversation lookup", byPhone.error.message)
    throw new Error("Failed to look up resident conversation")
  }
  if (byPhone.data) {
    return byPhone.data as {
      id: string
      maintenance_request_id: string | null
      status: string
      conversation_type: string
    }
  }

  const residentId = params.residentId?.trim()
  if (!residentId) return null

  const byResident = await supabase
    .from("sms_conversations")
    .select(selectCols)
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("resident_id", residentId)
    .is("vendor_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byResident.error) {
    console.error("[sms-inbound] resident conversation lookup by id", byResident.error.message)
    throw new Error("Failed to look up resident conversation")
  }

  return (byResident.data as {
    id: string
    maintenance_request_id: string | null
    status: string
    conversation_type: string
  } | null) ?? null
}

export async function createConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    identity: SmsIdentityRow
    maintenanceRequestId?: string | null
    conversationStatus?: string
  },
): Promise<string> {
  let conversationType = conversationTypeForIdentity(params.identity)
  conversationType = sanitizeConversationType(conversationType, params.identity)

  const { data, error } = await supabase
    .from("sms_conversations")
    .insert({
      landlord_id: params.landlordId,
      sms_number_id: params.smsNumberId,
      external_phone_number: normalizeSmsPhone(params.externalPhone),
      conversation_type: conversationType,
      status: params.conversationStatus ?? "open",
      resident_id: params.identity.resident_id,
      vendor_id: params.identity.vendor_id,
      unit_id: params.identity.unit_id,
      maintenance_request_id: params.maintenanceRequestId ?? null,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[sms-inbound] conversation insert", error?.message)
    throw new Error("Failed to create conversation")
  }

  return data.id as string
}

export type FindOrCreateConversationResult = {
  conversationId: string
  created: boolean
  conversationType: ReturnType<typeof conversationTypeForIdentity>
}

/** Find an open thread or create one with a safe conversation_type. */
export async function findOrCreateConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    identity: SmsIdentityRow
    maintenanceRequestId?: string | null
    conversationStatus?: string
  },
): Promise<FindOrCreateConversationResult> {
  const conversationType = sanitizeConversationType(
    conversationTypeForIdentity(params.identity),
    params.identity,
  )

  const existing = await findOpenConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.externalPhone,
  })

  if (existing) {
    const preservedType =
      existing.conversation_type === "vendor_tenant_proxy"
        ? "vendor_tenant_proxy"
        : conversationType

    const { error } = await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        status: params.conversationStatus ?? existing.status ?? "open",
        conversation_type: preservedType,
        resident_id: params.identity.resident_id,
        vendor_id: params.identity.vendor_id,
        unit_id: params.identity.unit_id,
        maintenance_request_id:
          params.maintenanceRequestId ?? existing.maintenance_request_id,
      })
      .eq("id", existing.id)

    if (error) {
      console.error("[sms-inbound] conversation update", error.message)
      throw new Error("Failed to update conversation")
    }

    return {
      conversationId: existing.id,
      created: false,
      conversationType: preservedType,
    }
  }

  const conversationId = await createConversation(supabase, params)
  return { conversationId, created: true, conversationType }
}

export async function resolveOpenMaintenanceRequestId(
  supabase: SupabaseClient,
  identity: SmsIdentityRow,
  fromNumber: string,
): Promise<string | null> {
  if (identity.vendor_id?.trim()) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("id")
      .eq("assigned_vendor_id", identity.vendor_id)
      .in("vendor_work_status", ["pending_accept", "accepted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ticket?.id) return ticket.id as string
  }

  if (identity.resident_id) {
    const { data: user } = await supabase
      .from("users")
      .select("unit, email")
      .eq("id", identity.resident_id)
      .maybeSingle()

    if (user?.unit) {
      const { data: ticket } = await supabase
        .from("maintenance_requests")
        .select("id")
        .eq("unit", user.unit)
        .not("vendor_work_status", "eq", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (ticket?.id) return ticket.id as string
    }
  }

  const e164 = normalizePhoneFlexible(fromNumber)
  if (!e164) return null

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("resident_phone", e164)
    .not("vendor_work_status", "eq", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (ticket?.id as string | undefined) ?? null
}
