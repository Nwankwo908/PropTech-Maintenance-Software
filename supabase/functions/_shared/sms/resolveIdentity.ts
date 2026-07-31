import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import {
  createUnknownIdentity,
  lookupSmsIdentity,
  normalizeSmsPhone,
  phoneLookupVariants,
  touchIdentityLastSeen,
  upsertSmsIdentity,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"

export type IdentityResolutionSource =
  | "active_resident"
  | "sms_identity"
  | "vendor"
  | "invite_unit_suggestion"
  | "unknown"
  | "self_healed_unit"

export type SelfHealingPhase =
  | "none"
  | "awaiting_unit_number"
  | "resolved"
  | "unresolved"

export type ResolveIdentityInput = {
  fromNumber: string
  landlordId: string
  messageBody?: string
  conversationId?: string | null
  conversationStatus?: string | null
  /** Ulo SMS number the texter reached (for outbound replies). */
  replyFromNumber?: string
}

export type ResolveIdentityResult = {
  identity: SmsIdentityRow
  source: IdentityResolutionSource
  suggestedUnit: string | null
  selfHealingPhase: SelfHealingPhase
  replyHint?: string
  notifyLandlord: boolean
  continueIntake: boolean
  createdOrUpdated: boolean
  conversationStatus?: string
}

type ResidentRow = {
  id: string
  resident_id: string
  full_name: string
  email: string
  phone: string | null
  unit: string | null
  building: string | null
  status: string
}

const AWAITING_UNIT_STATUS = "awaiting_unit_number"

/** Unit comparison: ignore case, labels, #, spaces, and punctuation. */
export function normalizeUnitForMatch(v: string | null | undefined): string {
  let s = (v ?? "").trim().toLowerCase()
  s = s.replace(/#/g, "")
  s = s.replace(/\b(unit|apt|apartment|suite|ste)\b/g, "")
  s = s.replace(/[^a-z0-9]/g, "")
  return s
}

function generateSmsResidentId(): string {
  return `RES-SMS-${Date.now().toString(36).toUpperCase()}`
}

function looksLikeUnitToken(token: string): boolean {
  const norm = normalizeUnitForMatch(token)
  if (!norm) return false
  return /\d/.test(norm) || (norm.length <= 4 && /^[a-z0-9]+$/.test(norm))
}

export function extractUnitFromMessage(body: string): string | null {
  const trimmed = body.trim()
  if (!trimmed) return null

  const labeled = trimmed.match(
    /\b(?:unit|apt|apartment|suite|ste|#)\s*[:#]?\s*([a-z0-9][a-z0-9\-/]*)/i,
  )
  if (labeled?.[1]) return labeled[1].trim()

  const bare = trimmed.match(/^#?([a-z0-9][a-z0-9\-/]{0,15})$/i)
  if (bare?.[1] && looksLikeUnitToken(bare[1])) return bare[1].trim()

  const firstToken = trimmed.split(/\s+/)[0]
  if (firstToken && looksLikeUnitToken(firstToken)) {
    return firstToken.replace(/^#/, "").trim()
  }

  return null
}

async function findActiveResidentByPhone(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<ResidentRow | null> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("users")
    .select("id, resident_id, full_name, email, phone, unit, building, status")
    .in("phone", variants)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[resolveIdentity] active resident lookup", error.message)
    return null
  }

  return (data as ResidentRow | null) ?? null
}

async function findVendorByPhone(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<{ id: string; phone: string | null } | null> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("vendors")
    .select("id, phone")
    .in("phone", variants)
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[resolveIdentity] vendor lookup", error.message)
    return null
  }

  return data as { id: string; phone: string | null } | null
}

/** Recent ticket or pending roster row that hints at a likely unit for this phone. */
async function suggestUnitFromRecentInvite(
  supabase: SupabaseClient,
  fromNumber: string,
  _landlordId: string,
): Promise<string | null> {
  const e164 = normalizePhoneFlexible(fromNumber)
  if (e164) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("unit, created_at")
      .eq("resident_phone", e164)
      .not("unit", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const unit = (ticket as { unit?: string | null } | null)?.unit?.trim()
    if (unit) return unit
  }

  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return null

  const { data: pendingResident } = await supabase
    .from("users")
    .select("unit")
    .in("phone", variants)
    .eq("status", "pending")
    .not("unit", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const pendingUnit = (pendingResident as { unit?: string | null } | null)?.unit?.trim()
  return pendingUnit ?? null
}

export async function findActiveResidentsByUnit(
  supabase: SupabaseClient,
  unitInput: string,
): Promise<ResidentRow[]> {
  const wanted = normalizeUnitForMatch(unitInput)
  if (!wanted) return []

  const { data, error } = await supabase
    .from("users")
    .select("id, resident_id, full_name, email, phone, unit, building, status")
    .eq("status", "active")
    .not("unit", "is", null)
    .limit(500)

  if (error) {
    console.error("[resolveIdentity] active unit roster scan", error.message)
    return []
  }

  return ((data ?? []) as ResidentRow[]).filter(
    (row) => normalizeUnitForMatch(row.unit) === wanted,
  )
}

/**
 * Attach an unknown phone to a roster unit (vacant row or new SMS resident).
 * Call only after the sender consents to saving their number.
 */
export async function attachPhoneToUnitResident(
  supabase: SupabaseClient,
  params: {
    fromNumber: string
    unit: string
    matchedResidents: ResidentRow[]
    fullName?: string | null
    building?: string | null
  },
): Promise<ResidentRow> {
  const normalizedFrom = normalizeSmsPhone(params.fromNumber)
  const variants = phoneLookupVariants(params.fromNumber)

  const phoneMatch = params.matchedResidents.find((row) => {
    if (!row.phone) return false
    return variants.includes(row.phone) || variants.includes(normalizeSmsPhone(row.phone))
  })
  if (phoneMatch) return phoneMatch

  const vacant = params.matchedResidents.find((row) => !row.phone?.trim())
  if (vacant) {
    const { data, error } = await supabase
      .from("users")
      .update({
        phone: normalizedFrom,
        ...(params.fullName?.trim() ? { full_name: params.fullName.trim() } : {}),
        ...(params.building?.trim() ? { building: params.building.trim() } : {}),
      })
      .eq("id", vacant.id)
      .select("id, resident_id, full_name, email, phone, unit, building, status")
      .single()

    if (error || !data) {
      console.error("[resolveIdentity] attach phone to resident", error?.message)
      throw new Error("Failed to attach phone to resident")
    }

    return data as ResidentRow
  }

  const { data, error } = await supabase
    .from("users")
    .insert({
      resident_id: generateSmsResidentId(),
      full_name: params.fullName?.trim() || "SMS Resident",
      email: `${normalizedFrom.replace(/\D/g, "")}@sms-resident.ulohome.local`,
      phone: normalizedFrom,
      unit: params.unit,
      building: params.building?.trim() || null,
      status: "active",
      balance_due: 0,
      issues: [],
    })
    .select("id, resident_id, full_name, email, phone, unit, building, status")
    .single()

  if (error || !data) {
    console.error("[resolveIdentity] create resident from SMS", error?.message)
    throw new Error("Failed to create resident from SMS")
  }

  return data as ResidentRow
}

export async function notifyLandlordUnresolvedTenant(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    fromNumber: string
    attemptedUnit: string | null
    conversationId?: string | null
  },
): Promise<void> {
  const subject = "Ulo SMS: unresolved tenant registration needed"
  const text = [
    "An inbound SMS could not be matched to an active unit.",
    "",
    `Landlord ID: ${params.landlordId}`,
    `Phone: ${normalizeSmsPhone(params.fromNumber)}`,
    `Attempted unit: ${params.attemptedUnit ?? "(none parsed)"}`,
    params.conversationId ? `Conversation: ${params.conversationId}` : "",
    "",
    "Please register the tenant in the admin roster or confirm their unit assignment.",
  ]
    .filter(Boolean)
    .join("\n")

  const notify = await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject,
    text,
    html: `<pre>${text}</pre>`,
    logLabel: "sms-unresolved-tenant",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "sms.unresolved_tenant",
    source: "sms",
    actor_type: "system",
    conversation_id: params.conversationId ?? null,
    metadata: {
      from: normalizeSmsPhone(params.fromNumber),
      attempted_unit: params.attemptedUnit,
      notified_emails: notify.sent,
      blocked_vendor_emails: notify.blocked,
    },
  })
}

/**
 * While a conversation is in unit/onboarding healing, keep the identity unknown
 * and let `identity_onboarding` / unknownContactIntake drive consent-gated attach.
 * (Legacy auto-attach on unit reply is intentionally disabled.)
 */
async function processUnitNumberSelfHealing(
  supabase: SupabaseClient,
  input: ResolveIdentityInput,
): Promise<ResolveIdentityResult> {
  const identity =
    (await lookupSmsIdentity(supabase, input.fromNumber, input.landlordId)) ??
    (await createUnknownIdentity(supabase, input.fromNumber, input.landlordId))

  // If already linked (e.g. consent just completed mid-turn), allow intake.
  if (
    identity.identity_type === "resident" &&
    identity.resident_id?.trim()
  ) {
    return {
      identity,
      source: "self_healed_unit",
      suggestedUnit: null,
      selfHealingPhase: "resolved",
      notifyLandlord: false,
      continueIntake: true,
      createdOrUpdated: false,
      conversationStatus: "open",
    }
  }

  return {
    identity,
    source: "unknown",
    suggestedUnit: null,
    selfHealingPhase: "awaiting_unit_number",
    // Workflow (unknownContactIntake) owns the reply copy.
    replyHint: undefined,
    notifyLandlord: false,
    continueIntake: false,
    createdOrUpdated: false,
    conversationStatus: AWAITING_UNIT_STATUS,
  }
}

/**
 * Phone-to-unit resolver for inbound SMS.
 *
 * Resolution order:
 * 1. Active resident roster match (phone + landlord scope via sms_identities)
 * 2. Existing sms_identities row
 * 3. Vendor phone match
 * 4. Likely unit from recent invite/onboarding activity
 * 5. Unknown identity + self-healing onboarding fallback
 */
export async function resolvePhoneIdentity(
  supabase: SupabaseClient,
  input: ResolveIdentityInput,
): Promise<ResolveIdentityResult> {
  if (input.conversationStatus === AWAITING_UNIT_STATUS) {
    return processUnitNumberSelfHealing(supabase, input)
  }

  let createdOrUpdated = false

  // 1. Exact match active resident by phone_number (+ landlord-scoped identity)
  const activeResident = await findActiveResidentByPhone(supabase, input.fromNumber)
  if (activeResident) {
    const existing = await lookupSmsIdentity(supabase, input.fromNumber, input.landlordId)
    const identity = await upsertSmsIdentity(supabase, {
      fromNumber: input.fromNumber,
      landlordId: input.landlordId,
      existing,
      patch: {
        identity_type: "resident",
        resident_id: activeResident.id,
        unit_id: null,
        verified: false,
      },
    })
    createdOrUpdated = !existing || existing.identity_type === "unknown"

    return {
      identity,
      source: "active_resident",
      suggestedUnit: activeResident.unit,
      selfHealingPhase: "none",
      replyHint:
        "Hi — this is Ulo. Tell me what's going on with your unit (a photo or video helps too).",
      notifyLandlord: false,
      continueIntake: true,
      createdOrUpdated,
      conversationStatus: "open",
    }
  }

  // 2. Match sms_identities by phone_number + landlord_id
  const existingIdentity = await lookupSmsIdentity(
    supabase,
    input.fromNumber,
    input.landlordId,
  )
  if (existingIdentity && existingIdentity.identity_type !== "unknown") {
    if (
      existingIdentity.identity_type === "vendor" &&
      !existingIdentity.vendor_id?.trim()
    ) {
      const relinkVendor = await findVendorByPhone(supabase, input.fromNumber)
      if (relinkVendor) {
        const identity = await upsertSmsIdentity(supabase, {
          fromNumber: input.fromNumber,
          landlordId: input.landlordId,
          existing: existingIdentity,
          patch: {
            identity_type: "vendor",
            vendor_id: relinkVendor.id,
            verified: false,
          },
        })
        return {
          identity,
          source: "vendor",
          suggestedUnit: null,
          selfHealingPhase: "none",
          notifyLandlord: false,
          continueIntake: false,
          createdOrUpdated: true,
          conversationStatus: "open",
        }
      }
      console.warn("[resolveIdentity] stale vendor identity without vendor_id; demoting to unknown", {
        identityId: existingIdentity.id,
        phone: normalizeSmsPhone(input.fromNumber),
      })
      await upsertSmsIdentity(supabase, {
        fromNumber: input.fromNumber,
        landlordId: input.landlordId,
        existing: existingIdentity,
        patch: {
          identity_type: "unknown",
          vendor_id: null,
          verified: false,
        },
      })
    } else {
      await touchIdentityLastSeen(supabase, existingIdentity.id)

      return {
        identity: existingIdentity,
        source: "sms_identity",
        suggestedUnit: null,
        selfHealingPhase: "none",
        notifyLandlord: false,
        continueIntake:
          existingIdentity.identity_type === "resident" ||
          !!existingIdentity.resident_id?.trim(),
        createdOrUpdated: false,
        conversationStatus: "open",
      }
    }
  }

  // 3. Match vendor by phone_number (+ landlord scope via sms identity write)
  const vendor = await findVendorByPhone(supabase, input.fromNumber)
  if (vendor) {
    const identity = await upsertSmsIdentity(supabase, {
      fromNumber: input.fromNumber,
      landlordId: input.landlordId,
      existing: existingIdentity,
      patch: {
        identity_type: "vendor",
        vendor_id: vendor.id,
        verified: false,
      },
    })
    createdOrUpdated = true

    return {
      identity,
      source: "vendor",
      suggestedUnit: null,
      selfHealingPhase: "none",
      notifyLandlord: false,
      continueIntake: false,
      createdOrUpdated,
      conversationStatus: "open",
    }
  }

  // 4. Suggest likely unit from recent invite/onboarding activity
  const suggestedUnit = await suggestUnitFromRecentInvite(
    supabase,
    input.fromNumber,
    input.landlordId,
  )

  // 5. Unknown identity + self-healing fallback
  const identity = existingIdentity ??
    (await createUnknownIdentity(supabase, input.fromNumber, input.landlordId))
  if (existingIdentity) {
    await touchIdentityLastSeen(supabase, existingIdentity.id)
  } else {
    createdOrUpdated = true
  }

  return {
    identity,
    source: suggestedUnit ? "invite_unit_suggestion" : "unknown",
    suggestedUnit,
    selfHealingPhase: "awaiting_unit_number",
    // Conversational unknown-contact intake owns the first reply.
    replyHint: undefined,
    notifyLandlord: false,
    continueIntake: false,
    createdOrUpdated,
    conversationStatus: AWAITING_UNIT_STATUS,
  }
}

/** @deprecated Use sendInboundAutoReply from inboundReply.ts (persists to sms_messages). */
export async function sendIdentityReplyHint(
  _toNumber: string,
  _fromNumber: string | undefined,
  _replyHint: string | undefined,
): Promise<void> {
  // Replies are sent from inbound_processor after workflow routing.
}
