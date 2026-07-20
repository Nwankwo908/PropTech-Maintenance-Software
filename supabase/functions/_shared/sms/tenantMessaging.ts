import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { phoneLookupVariants } from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import type { SmsProviderName } from "./types.ts"

export type TenantSmsConsentStatus = "pending" | "opted_in" | "opted_out"

/** Inbound compliance keyword classification (carrier + first-party handled). */
export type TenantSmsKeyword = "stop" | "help" | "start" | null

const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
])
const HELP_WORDS = new Set(["help", "info"])
const START_WORDS = new Set(["start", "unstop", "yes", "y"])

/**
 * Classify a raw inbound body against SMS compliance + activation keywords.
 * Only reacts to a single-token message (the whole body is the keyword) so a
 * maintenance report like "the heater stopped working" is never mistaken for STOP.
 */
export function classifyTenantSmsKeyword(body: string): TenantSmsKeyword {
  const token = body.trim().toLowerCase().replace(/[.!?,]+$/g, "")
  if (!token || token.includes(" ")) return null
  if (STOP_WORDS.has(token)) return "stop"
  if (HELP_WORDS.has(token)) return "help"
  if (START_WORDS.has(token)) return "start"
  return null
}

/**
 * Compliance footer. Required tokens (HELP, STOP, msg & data rates) kept, but
 * phrased like a friendly sign-off instead of legal boilerplate. Lives at the
 * end of a message so residents read the helpful part first.
 */
export function tenantSmsComplianceFooter(): string {
  return "Reply HELP for help or STOP to unsubscribe. Msg & data rates may apply."
}

function firstNameOf(fullName?: string | null): string | null {
  const trimmed = fullName?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? null
}

/**
 * Compose the post-onboarding welcome/activation SMS.
 * Leads with what the resident can do, keeps the tone warm, and tucks the
 * required opt-in prompt + compliance footer at the end.
 */
export function composeTenantWelcomeSms(params: {
  tenantName?: string | null
  companyName?: string | null
}): string {
  const first = firstNameOf(params.tenantName)
  const company = params.companyName?.trim()
  const greeting = first ? `Hi ${first},` : "Hi there,"
  const team = company
    ? `this is the property management team at ${company}.`
    : "this is your property management team."

  return (
    `${greeting} ${team}\n\n` +
    `You can now reach us by text anytime you need a repair or have a question ` +
    `about your home.\n\n` +
    `Reply YES to get updates about your maintenance requests and important ` +
    `messages about your home.\n\n` +
    tenantSmsComplianceFooter()
  )
}

/** Auto-reply after a tenant confirms consent (YES/START). */
export function tenantOptInConfirmationSms(params: {
  companyName?: string | null
}): string {
  const company = params.companyName?.trim()
  const signoff = company ? ` The ${company} team is just a text away.` : ""
  return (
    `You're all set, thank you. We'll text you here about your maintenance ` +
    `requests and anything important for your home. Need a repair? Just text us ` +
    `anytime and we're happy to help.${signoff} ` +
    `Reply STOP to unsubscribe.`
  )
}

/** Auto-reply for HELP. */
export function tenantHelpReplySms(params: {
  companyName?: string | null
}): string {
  const company = params.companyName?.trim()
  const lead = company ? `${company} here. ` : ""
  return (
    `${lead}We're here to help! Just text us what's going on with your home, ` +
    `like a repair you need or a question, and we'll take care of it. ` +
    `Reply STOP to unsubscribe. Msg & data rates may apply.`
  )
}

/** Auto-reply confirming opt-out (carrier may also send its own). */
export function tenantOptOutConfirmationSms(): string {
  return (
    "You're unsubscribed and won't get any more texts from us. " +
    "Changed your mind? Just reply START anytime and we'll be right here to help."
  )
}

export type TenantConsentRow = {
  id: string
  full_name: string | null
  phone: string | null
  unit: string | null
  building: string | null
  status: string | null
  sms_consent_status: string | null
}

const TENANT_CONSENT_SELECT =
  "id, full_name, phone, unit, building, status, sms_consent_status"

/** Resolve a resident row by landlord-scoped phone (for inbound keyword handling). */
export async function findTenantByPhone(
  supabase: SupabaseClient,
  phone: string,
): Promise<TenantConsentRow | null> {
  const variants = phoneLookupVariants(phone)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("users")
    .select(TENANT_CONSENT_SELECT)
    .in("phone", variants)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[tenantMessaging] findTenantByPhone", error.message)
    return null
  }

  return (data as TenantConsentRow | null) ?? null
}

/**
 * Compliance suppression guard. Returns false when the resident has opted out;
 * every tenant-facing send MUST call this before delivery.
 */
export async function canSendTenantSms(
  supabase: SupabaseClient,
  residentId: string,
): Promise<boolean> {
  const id = residentId.trim()
  if (!id) return false

  const { data, error } = await supabase
    .from("users")
    .select("sms_consent_status")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[tenantMessaging] canSendTenantSms", error.message)
    // Fail open only for missing column; fail closed otherwise is safer, but the
    // consent column may not be migrated yet in some environments.
    return true
  }

  const status = (data?.sms_consent_status as string | null) ?? "pending"
  return status !== "opted_out"
}

async function markSmsIdentityVerified(
  supabase: SupabaseClient,
  smsIdentityId: string,
  verified: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("sms_identities")
    .update({ verified })
    .eq("id", smsIdentityId)
  if (error) {
    console.warn("[tenantMessaging] mark identity verified", error.message)
  }
}

export type TenantConsentKeywordResult = {
  handled: boolean
  keyword: TenantSmsKeyword
  outboundMessageId?: string
}

/**
 * Pre-router for SMS compliance + activation keywords (STOP / HELP / YES).
 * Runs before workflow routing so a resident's opt-out/opt-in is honored and
 * never treated as a maintenance report. Updates consent + identity verification
 * and sends the matching compliance auto-reply.
 */
export async function tryHandleTenantConsentKeyword(
  supabase: SupabaseClient,
  params: {
    body: string
    landlordId: string
    conversationId: string
    provider: SmsProviderName
    uloNumber: string
    externalPhone: string
    residentId?: string | null
    smsIdentityId?: string | null
    companyName?: string | null
    identityType?: string | null
    conversationType?: string | null
    /**
     * When true, ignore START/YES opt-in keywords so mid-intake replies like
     * "Yes" (urgency confirm) are not hijacked by consent handling.
     * STOP and HELP still apply.
     */
    activeMaintenanceIntake?: boolean
  },
): Promise<TenantConsentKeywordResult> {
  const keyword = classifyTenantSmsKeyword(params.body)
  if (!keyword) return { handled: false, keyword: null }

  // YES/START is tenant SMS opt-in only. Never steal vendor job accept/decline
  // (or landlord APPROVE/DECLINE threads) — STOP and HELP still apply.
  if (keyword === "start") {
    const identityType = (params.identityType ?? "").trim().toLowerCase()
    const conversationType = (params.conversationType ?? "").trim().toLowerCase()
    const nonTenantThread =
      identityType === "vendor" ||
      identityType === "landlord" ||
      conversationType === "vendor_alert" ||
      conversationType === "landlord_alert"
    if (params.activeMaintenanceIntake || nonTenantThread) {
      return { handled: false, keyword: null }
    }
  }

  const residentId = params.residentId?.trim() || null
  const nowIso = new Date().toISOString()

  let replyBody: string
  let eventType: string

  if (keyword === "stop") {
    if (residentId) {
      await updateTenantConsent(supabase, residentId, {
        sms_consent_status: "opted_out",
        sms_opt_out_at: nowIso,
      })
    }
    if (params.smsIdentityId) {
      await markSmsIdentityVerified(supabase, params.smsIdentityId, false)
    }
    replyBody = tenantOptOutConfirmationSms()
    eventType = "tenant.sms_opted_out"
  } else if (keyword === "start") {
    if (residentId) {
      await updateTenantConsent(supabase, residentId, {
        sms_consent_status: "opted_in",
        sms_consent_at: nowIso,
      })
    }
    if (params.smsIdentityId) {
      await markSmsIdentityVerified(supabase, params.smsIdentityId, true)
    }
    replyBody = tenantOptInConfirmationSms({ companyName: params.companyName })
    eventType = "tenant.sms_opted_in"
  } else {
    replyBody = tenantHelpReplySms({ companyName: params.companyName })
    eventType = "tenant.sms_help"
  }

  const sent = await sendInboundAutoReply(supabase, {
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    fromNumber: params.uloNumber,
    toNumber: params.externalPhone,
    body: replyBody,
    provider: params.provider,
    source: `tenant_consent_${keyword}`,
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: eventType,
    source: "sms",
    actor_type: "resident",
    actor_id: residentId,
    resident_id: residentId,
    conversation_id: params.conversationId,
    metadata: {
      keyword,
      from: params.externalPhone,
      consent_status:
        keyword === "stop"
          ? "opted_out"
          : keyword === "start"
          ? "opted_in"
          : undefined,
    },
  })

  return {
    handled: true,
    keyword,
    outboundMessageId: sent.ok ? sent.messageId : undefined,
  }
}

export type TenantConsentUpdate = {
  sms_consent_status: TenantSmsConsentStatus
  sms_consent_at?: string | null
  sms_opt_out_at?: string | null
  activation_sms_sent_at?: string | null
}

/**
 * Patch tenant consent columns, degrading gracefully if the consent migration
 * has not been applied yet (columns missing → no-op instead of hard failure).
 */
export async function updateTenantConsent(
  supabase: SupabaseClient,
  residentId: string,
  patch: TenantConsentUpdate,
): Promise<boolean> {
  const id = residentId.trim()
  if (!id) return false

  const { error } = await supabase.from("users").update(patch).eq("id", id)

  if (error) {
    if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
      console.warn(
        "[tenantMessaging] consent columns not migrated — skipping consent update",
        error.message,
      )
      return false
    }
    console.error("[tenantMessaging] updateTenantConsent", error.message)
    return false
  }

  return true
}
