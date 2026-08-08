import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { phoneLookupVariants } from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import type { SmsProviderName } from "./types.ts"

export type TenantSmsConsentStatus = "pending" | "opted_in" | "opted_out"

/** Inbound compliance keyword classification (carrier + first-party handled). */
export type TenantSmsKeyword = "stop" | "help" | "start" | null
export type TenantComplianceKeyword = "stop" | "help" | null
export type TenantActivationKeyword = "start" | null

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

function complianceToken(body: string): string {
  return body.trim().toLowerCase().replace(/[.!?,]+$/g, "")
}

/**
 * STOP / HELP only — single-token messages (global compliance).
 * Sentences like "the heater stopped working" never match.
 */
export function classifyTenantComplianceKeyword(body: string): TenantComplianceKeyword {
  const token = complianceToken(body)
  if (!token || token.includes(" ")) return null
  if (STOP_WORDS.has(token)) return "stop"
  if (HELP_WORDS.has(token)) return "help"
  return null
}

/** START / YES — tenant activation opt-in (contextual; see isTenantActivationPending). */
export function classifyTenantActivationKeyword(body: string): TenantActivationKeyword {
  const token = complianceToken(body)
  if (!token || token.includes(" ")) return null
  if (START_WORDS.has(token)) return "start"
  return null
}

/**
 * Classify a raw inbound body against SMS compliance + activation keywords.
 * Only reacts to a single-token message (the whole body is the keyword) so a
 * maintenance report like "the heater stopped working" is never mistaken for STOP.
 */
export function classifyTenantSmsKeyword(body: string): TenantSmsKeyword {
  return classifyTenantComplianceKeyword(body) ??
    classifyTenantActivationKeyword(body)
}

/** True when Ulo is waiting for a tenant YES/START to complete SMS activation. */
export function isTenantActivationPending(input: {
  activationStatus?: string | null
  smsConsentStatus?: string | null
  activationSmsSentAt?: string | null
}): boolean {
  const consent = (input.smsConsentStatus ?? "").trim().toLowerCase()
  const activation = (input.activationStatus ?? "").trim().toLowerCase()

  if (consent === "opted_in" || activation === "activated") return false
  if (consent === "opted_out" || activation === "opted_out") return false
  if (activation === "action_required") return false
  if (activation === "delivery_failed") return false

  // Onboarding-only window: welcome sent and resident has not yet replied YES/START.
  return activation === "waiting"
}

/**
 * Pure gate for the inbound activation-reply handler.
 * Does not send SMS — only decides eligibility before DB-backed handling.
 */
export function canHandleTenantActivationReply(input: {
  body: string
  residentId?: string | null
  identityType?: string | null
  conversationType?: string | null
  activeMaintenanceIntake?: boolean
  smsConsentStatus?: string | null
  activationStatus?: string | null
  activationSmsSentAt?: string | null
}): boolean {
  if (!classifyTenantActivationKeyword(input.body)) return false
  if (!input.residentId?.trim()) return false
  if (input.activeMaintenanceIntake) return false
  if (isNonTenantActivationThread(input.identityType, input.conversationType)) {
    return false
  }
  return isTenantActivationPending({
    smsConsentStatus: input.smsConsentStatus,
    activationStatus: input.activationStatus,
    activationSmsSentAt: input.activationSmsSentAt,
  })
}

/** @internal Exported for routing tests. */
export function isNonTenantActivationThread(
  identityType?: string | null,
  conversationType?: string | null,
): boolean {
  const identity = (identityType ?? "").trim().toLowerCase()
  const conversation = (conversationType ?? "").trim().toLowerCase()
  return (
    identity === "vendor" ||
    identity === "landlord" ||
    conversation === "vendor_alert" ||
    conversation === "landlord_alert"
  )
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
  unit?: string | null
}): string {
  const company = params.companyName?.trim()
  const unit = params.unit?.trim()
  const signoff = company ? ` The ${company} team is just a text away.` : ""
  const saveAs = unit
    ? `Save this number as "Repairs ${unit}".`
    : `Save this number as "Repairs".`
  return (
    `You're all set, thank you. We'll text you here about your maintenance ` +
    `requests and anything important for your home. Need a repair? Just text us ` +
    `anytime and we're happy to help.${signoff}\n\n` +
    `${saveAs}\n\n` +
    `Reply STOP to unsubscribe.`
  )
}

async function fetchResidentUnit(
  supabase: SupabaseClient,
  residentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("users")
    .select("unit")
    .eq("id", residentId)
    .maybeSingle()
  if (error) {
    console.warn("[tenantMessaging] fetchResidentUnit", error.message)
    return null
  }
  const unit = (data as { unit?: string | null } | null)?.unit
  return unit?.trim() || null
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

export type TenantComplianceKeywordResult = {
  handled: boolean
  keyword: TenantComplianceKeyword
  outboundMessageId?: string
}

export type TenantActivationKeywordResult = {
  handled: boolean
  keyword: TenantActivationKeyword
  outboundMessageId?: string
}

type TenantKeywordHandlerParams = {
  body: string
  landlordId: string
  conversationId: string
  provider: SmsProviderName
  uloNumber: string
  externalPhone: string
  residentId?: string | null
  smsIdentityId?: string | null
  companyName?: string | null
}

async function applyTenantKeywordAction(
  supabase: SupabaseClient,
  params: TenantKeywordHandlerParams & { keyword: "stop" | "help" | "start" },
): Promise<{ outboundMessageId?: string }> {
  const residentId = params.residentId?.trim() || null
  const nowIso = new Date().toISOString()

  let replyBody: string
  let eventType: string

  if (params.keyword === "stop") {
    if (residentId) {
      await updateTenantConsent(supabase, residentId, {
        sms_consent_status: "opted_out",
        sms_opt_out_at: nowIso,
        activation_status: "opted_out",
        last_delivery_error: null,
      })
    }
    if (params.smsIdentityId) {
      await markSmsIdentityVerified(supabase, params.smsIdentityId, false)
    }
    replyBody = tenantOptOutConfirmationSms()
    eventType = "tenant.sms_opted_out"
  } else if (params.keyword === "start") {
    if (residentId) {
      await updateTenantConsent(supabase, residentId, {
        sms_consent_status: "opted_in",
        sms_consent_at: nowIso,
        activation_status: "activated",
        last_delivery_error: null,
      })
      try {
        const { resolveActivationAdminAlerts } = await import(
          "./tenantActivationAdminAlert.ts"
        )
        await resolveActivationAdminAlerts(supabase, {
          landlordId: params.landlordId,
          residentId,
          reason: "activated",
        })
      } catch (e) {
        console.warn("[tenantMessaging] resolve activation alerts", e)
      }
    }
    if (params.smsIdentityId) {
      await markSmsIdentityVerified(supabase, params.smsIdentityId, true)
    }
    const unit = residentId
      ? await fetchResidentUnit(supabase, residentId)
      : null
    replyBody = tenantOptInConfirmationSms({
      companyName: params.companyName,
      unit,
    })
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
    source:
      params.keyword === "start"
        ? "tenant_activation_reply"
        : `tenant_compliance_${params.keyword}`,
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
      keyword: params.keyword,
      from: params.externalPhone,
      consent_status:
        params.keyword === "stop"
          ? "opted_out"
          : params.keyword === "start"
            ? "opted_in"
            : undefined,
    },
  })

  return { outboundMessageId: sent.ok ? sent.messageId : undefined }
}

/**
 * Global STOP / HELP — runs before active conversations and activation.
 * STOP is global. YES is contextual (see tenant_activation_reply handler).
 */
export async function tryHandleTenantComplianceKeyword(
  supabase: SupabaseClient,
  params: TenantKeywordHandlerParams,
): Promise<TenantComplianceKeywordResult> {
  const keyword = classifyTenantComplianceKeyword(params.body)
  if (!keyword) return { handled: false, keyword: null }

  const { outboundMessageId } = await applyTenantKeywordAction(supabase, {
    ...params,
    keyword,
  })

  return { handled: true, keyword, outboundMessageId }
}

/**
 * Inbound activation **reply** only — recognizes YES/START while onboarding is pending.
 * Does not own welcome send, retries, or activation orchestration (see tenantActivation.ts).
 */
export async function tryHandleTenantActivationReply(
  supabase: SupabaseClient,
  params: TenantKeywordHandlerParams & {
    identityType?: string | null
    conversationType?: string | null
    activeMaintenanceIntake?: boolean
  },
): Promise<TenantActivationKeywordResult> {
  const keyword = classifyTenantActivationKeyword(params.body)
  if (!keyword) return { handled: false, keyword: null }

  const residentId = params.residentId?.trim() || null
  if (!residentId) return { handled: false, keyword: null }

  const { data, error } = await supabase
    .from("users")
    .select("sms_consent_status, activation_status, activation_sms_sent_at")
    .eq("id", residentId)
    .maybeSingle()

  if (error) {
    console.warn("[tenantMessaging] activation reply state lookup", error.message)
    return { handled: false, keyword: null }
  }

  const row = data as {
    sms_consent_status?: string | null
    activation_status?: string | null
    activation_sms_sent_at?: string | null
  } | null

  if (
    !canHandleTenantActivationReply({
      body: params.body,
      residentId,
      identityType: params.identityType,
      conversationType: params.conversationType,
      activeMaintenanceIntake: params.activeMaintenanceIntake,
      smsConsentStatus: row?.sms_consent_status,
      activationStatus: row?.activation_status,
      activationSmsSentAt: row?.activation_sms_sent_at,
    })
  ) {
    return { handled: false, keyword: null }
  }

  const { outboundMessageId } = await applyTenantKeywordAction(supabase, {
    ...params,
    keyword: "start",
  })

  return { handled: true, keyword: "start", outboundMessageId }
}

/** @deprecated Prefer tryHandleTenantActivationReply */
export const tryHandleTenantActivationKeyword = tryHandleTenantActivationReply

/**
 * Legacy combined handler (compliance then activation). Prefer registry split handlers.
 */
export async function tryHandleTenantConsentKeyword(
  supabase: SupabaseClient,
  params: TenantKeywordHandlerParams & {
    identityType?: string | null
    conversationType?: string | null
    activeMaintenanceIntake?: boolean
  },
): Promise<TenantConsentKeywordResult> {
  const compliance = await tryHandleTenantComplianceKeyword(supabase, params)
  if (compliance.handled) {
    return {
      handled: true,
      keyword: compliance.keyword,
      outboundMessageId: compliance.outboundMessageId,
    }
  }

  const activation = await tryHandleTenantActivationReply(supabase, params)
  if (activation.handled) {
    return {
      handled: true,
      keyword: "start",
      outboundMessageId: activation.outboundMessageId,
    }
  }

  return { handled: false, keyword: null }
}

export type TenantConsentUpdate = {
  sms_consent_status: TenantSmsConsentStatus
  sms_consent_at?: string | null
  sms_opt_out_at?: string | null
  activation_sms_sent_at?: string | null
  /** Landlord-facing activation status (stops retries on YES / STOP). */
  activation_status?:
    | "not_started"
    | "waiting"
    | "delivery_failed"
    | "action_required"
    | "activated"
    | "opted_out"
    | null
  last_delivery_error?: string | null
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
