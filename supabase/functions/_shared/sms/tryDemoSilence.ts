import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { DEMO_LANDLORD_ID } from "../../../../shared/admin/landlordAccess.ts"
import {
  normalizeSmsPhone,
  phoneLookupVariants,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"

/** Landlord / vendor Try Demo: one sample SMS, then silence. */
const SILENT_TRY_DEMO_EXPERIENCES = ["landlord", "vendor"] as const

/**
 * Resident Try Demo may run real maintenance intake on Demo, then stop after
 * this many Ulo outbound replies in the request thread (sample invite excluded —
 * it is not stored on the conversation).
 */
export const TRY_DEMO_RESIDENT_MAX_ULO_REPLIES = 3

export type TryDemoUnmatchedDecision =
  | { action: "silence"; reason: "sample_preview" | "resident_cap" }
  | { action: "resident_intake"; landlordId: string; residentId: string }
  | { action: "none" }

type TryDemoExperienceRow = {
  id: string
  experience: string
}

async function lookupTryDemoExperienceRows(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<TryDemoExperienceRow[]> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return []

  const { data, error } = await supabase
    .from("try_demo_experience_sends")
    .select("id, experience")
    .in("phone_e164", variants)
    .limit(8)

  if (error) {
    console.warn("[sms-inbound] try_demo silence lookup", error.message)
    return []
  }

  return (data ?? []) as TryDemoExperienceRow[]
}

/**
 * Landing Try Demo sample recipients (landlord / vendor) get only that one
 * outbound. Resident samples may continue into Demo intake until the reply cap.
 * If they text back on the shared Ulo DID and they are not a signed-up account
 * (unmatched shared DID), use {@link resolveTryDemoUnmatchedInbound}.
 */
export async function shouldSilenceTryDemoSampleReply(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<boolean> {
  const decision = await resolveTryDemoUnmatchedInbound(supabase, fromNumber)
  return decision.action === "silence"
}

/** @deprecated Prefer shouldSilenceTryDemoSampleReply */
export const shouldSilenceTryDemoLandlordReply = shouldSilenceTryDemoSampleReply

async function countDemoOutboundRepliesForPhone(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<number> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return 0

  const { data: conversations, error: convErr } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("landlord_id", DEMO_LANDLORD_ID)
    .in("external_phone_number", variants)
    .limit(20)

  if (convErr) {
    console.warn("[sms-inbound] try_demo outbound count conversations", convErr.message)
    return 0
  }

  const conversationIds = (conversations ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean)
  if (conversationIds.length === 0) return 0

  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", conversationIds)
    .eq("direction", "outbound")

  if (error) {
    console.warn("[sms-inbound] try_demo outbound count messages", error.message)
    return 0
  }

  return typeof count === "number" && count > 0 ? count : 0
}

async function pickDemoUnitForTryDemoVisitor(
  supabase: SupabaseClient,
): Promise<{ id: string; unit_label: string | null; building: string | null } | null> {
  const { data: vacant, error: vacantErr } = await supabase
    .from("units")
    .select("id, unit_label, building")
    .eq("landlord_id", DEMO_LANDLORD_ID)
    .eq("status", "vacant")
    .order("unit_label", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (vacantErr) {
    console.warn("[sms-inbound] try_demo vacant unit lookup", vacantErr.message)
  } else if (vacant?.id) {
    return vacant as { id: string; unit_label: string | null; building: string | null }
  }

  const { data: anyUnit, error: anyErr } = await supabase
    .from("units")
    .select("id, unit_label, building")
    .eq("landlord_id", DEMO_LANDLORD_ID)
    .order("unit_label", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (anyErr) {
    console.warn("[sms-inbound] try_demo unit fallback lookup", anyErr.message)
    return null
  }
  if (!anyUnit?.id) return null
  return anyUnit as { id: string; unit_label: string | null; building: string | null }
}

/**
 * Ensure the Try Demo phone is a Demo resident so maintenance_intake can classify.
 * Idempotent per phone under Demo.
 */
export async function ensureTryDemoResidentIdentity(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<{ landlordId: string; residentId: string } | null> {
  const e164 = normalizeSmsPhone(fromNumber)
  if (!e164) return null

  const variants = phoneLookupVariants(e164)
  const { data: existingUsers, error: userLookupErr } = await supabase
    .from("users")
    .select("id, phone, unit, building, landlord_id")
    .eq("landlord_id", DEMO_LANDLORD_ID)
    .in("phone", variants)
    .limit(4)

  if (userLookupErr) {
    console.warn("[sms-inbound] try_demo resident lookup", userLookupErr.message)
  }

  let residentId =
    typeof existingUsers?.[0]?.id === "string" ? existingUsers[0].id : null
  let unitId: string | null = null
  let unitLabel: string | null =
    typeof existingUsers?.[0]?.unit === "string" ? existingUsers[0].unit : null
  let building: string | null =
    typeof existingUsers?.[0]?.building === "string"
      ? existingUsers[0].building
      : null

  if (!residentId) {
    const unit = await pickDemoUnitForTryDemoVisitor(supabase)
    if (!unit) {
      console.warn("[sms-inbound] try_demo — no Demo unit available for visitor")
      return null
    }
    unitId = unit.id
    unitLabel = unit.unit_label
    building = unit.building

    const { data: created, error: createErr } = await supabase
      .from("users")
      .insert({
        landlord_id: DEMO_LANDLORD_ID,
        resident_id: `TRYDEMO-${e164.replace(/\D/g, "").slice(-8)}`,
        full_name: "Try Demo Visitor",
        email: `try-demo+${e164.replace(/\D/g, "")}@ulohome.io`,
        phone: e164,
        unit: unitLabel,
        building,
        status: "active",
        activation_status: "activated",
        sms_consent_status: "opted_in",
      })
      .select("id")
      .single()

    if (createErr || !created?.id) {
      console.error("[sms-inbound] try_demo create resident", createErr?.message)
      return null
    }
    residentId = created.id as string

    const { data: activeOcc } = await supabase
      .from("occupancy")
      .select("id")
      .eq("landlord_id", DEMO_LANDLORD_ID)
      .eq("unit_id", unitId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    if (!activeOcc?.id) {
      const { error: occErr } = await supabase.from("occupancy").insert({
        landlord_id: DEMO_LANDLORD_ID,
        unit_id: unitId,
        resident_id: residentId,
        move_in_date: new Date().toISOString().slice(0, 10),
        status: "active",
      })
      if (occErr) {
        console.warn("[sms-inbound] try_demo occupancy insert", occErr.message)
      }
    }
  } else {
    const { data: occ } = await supabase
      .from("occupancy")
      .select("unit_id")
      .eq("landlord_id", DEMO_LANDLORD_ID)
      .eq("resident_id", residentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()
    unitId = typeof occ?.unit_id === "string" ? occ.unit_id : null

    if (!unitId) {
      const unit = await pickDemoUnitForTryDemoVisitor(supabase)
      unitId = unit?.id ?? null
      unitLabel = unit?.unit_label ?? unitLabel
      building = unit?.building ?? building
    }
  }

  try {
    await upsertSmsIdentityForPhone(supabase, {
      landlordId: DEMO_LANDLORD_ID,
      phone: e164,
      identityType: "resident",
      residentId,
      unitId,
    })
  } catch (err) {
    console.error("[sms-inbound] try_demo sms identity", err)
    return null
  }

  // Keep activation out of the YES/NO hold path for this preview visitor.
  await supabase
    .from("users")
    .update({
      activation_status: "activated",
      sms_consent_status: "opted_in",
      phone: e164,
      ...(unitLabel ? { unit: unitLabel } : {}),
      ...(building ? { building } : {}),
    })
    .eq("id", residentId)

  return { landlordId: DEMO_LANDLORD_ID, residentId }
}

/**
 * Once a resident Try Demo visitor is linked on Demo, later replies skip the
 * unmatched gate — still enforce the Ulo-reply cap here.
 */
export async function shouldSilenceTryDemoResidentAfterCap(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<boolean> {
  const rows = await lookupTryDemoExperienceRows(supabase, fromNumber)
  if (!rows.some((row) => row.experience === "resident")) return false
  const outboundCount = await countDemoOutboundRepliesForPhone(supabase, fromNumber)
  return outboundCount >= TRY_DEMO_RESIDENT_MAX_ULO_REPLIES
}

/**
 * Decide what to do when a shared-DID inbound has no roster/identity match.
 * Resident Try Demo → Demo intake until {@link TRY_DEMO_RESIDENT_MAX_ULO_REPLIES}
 * Ulo outbounds, then silence. Landlord/vendor samples stay silent.
 */
export async function resolveTryDemoUnmatchedInbound(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<TryDemoUnmatchedDecision> {
  const rows = await lookupTryDemoExperienceRows(supabase, fromNumber)
  if (rows.length === 0) return { action: "none" }

  const hasResident = rows.some((row) => row.experience === "resident")
  const hasSilentPreview = rows.some((row) =>
    (SILENT_TRY_DEMO_EXPERIENCES as readonly string[]).includes(row.experience),
  )

  if (!hasResident) {
    return hasSilentPreview
      ? { action: "silence", reason: "sample_preview" }
      : { action: "none" }
  }

  const outboundCount = await countDemoOutboundRepliesForPhone(supabase, fromNumber)
  if (outboundCount >= TRY_DEMO_RESIDENT_MAX_ULO_REPLIES) {
    return { action: "silence", reason: "resident_cap" }
  }

  const ensured = await ensureTryDemoResidentIdentity(supabase, fromNumber)
  if (!ensured) {
    // Fail closed to silence so we do not send the generic unmatched ack.
    return { action: "silence", reason: "sample_preview" }
  }

  return {
    action: "resident_intake",
    landlordId: ensured.landlordId,
    residentId: ensured.residentId,
  }
}
