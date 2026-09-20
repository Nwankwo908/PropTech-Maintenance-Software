import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import type { SmsProviderName } from "./types.ts"
import {
  classifyTenantActivationKeyword,
  classifyTenantComplianceKeyword,
  isNonTenantActivationThread,
  isTenantActivationPending,
  tenantSmsComplianceFooter,
} from "./tenantMessaging.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"

function firstNameOf(fullName?: string | null): string | null {
  const trimmed = fullName?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? null
}

function greeting(fullName?: string | null): string {
  const first = firstNameOf(fullName)
  return first ? `Hi ${first},` : "Hi there,"
}

/** Follow-up when the welcome SMS was delivered but the resident has not replied YES or NO. */
export function composeTenantActivationNudgeSms(params: {
  tenantName?: string | null
}): string {
  return (
    `${greeting(params.tenantName)}\n\n` +
    `This is the property management team.\n\n` +
    `We still need a quick reply to set up texts for your home.\n\n` +
    `Reply YES to submit maintenance requests and get important home updates.\n` +
    `Reply NO to opt out.\n\n` +
    tenantSmsComplianceFooter()
  )
}

/**
 * Ack an off-topic text during the YES/NO window and remind them to finish
 * the welcome reply first.
 */
export function composeTenantActivationHoldSms(params: {
  tenantName?: string | null
}): string {
  return (
    `${greeting(params.tenantName)}\n\n` +
    `This is the property management team.\n\n` +
    `Thanks for reaching out — I have your message.\n\n` +
    `Please reply YES or NO to the welcome text first. Then I can help with this.\n\n` +
    `Reply YES to get updates about repairs and important messages.\n` +
    `Reply NO if you don't want those updates.`
  )
}

export function canHandleTenantActivationHold(input: {
  body: string
  residentId?: string | null
  identityType?: string | null
  conversationType?: string | null
  smsConsentStatus?: string | null
  activationStatus?: string | null
  activationSmsSentAt?: string | null
}): boolean {
  if (!input.residentId?.trim()) return false
  if (classifyTenantComplianceKeyword(input.body)) return false
  if (classifyTenantActivationKeyword(input.body)) return false
  if (isNonTenantActivationThread(input.identityType, input.conversationType)) {
    return false
  }
  return isTenantActivationPending({
    smsConsentStatus: input.smsConsentStatus,
    activationStatus: input.activationStatus,
    activationSmsSentAt: input.activationSmsSentAt,
  })
}

export type ParkedOnboardingRequest = {
  body: string
  mediaUrls: string[]
}

function asIntake(raw: unknown): SmsIntakeState {
  if (raw && typeof raw === "object") return { ...(raw as SmsIntakeState) }
  return {}
}

export function mergeParkedOnboardingRequest(
  current: SmsIntakeState,
  next: ParkedOnboardingRequest,
  receivedAt: string,
): SmsIntakeState {
  const prior = (current.pending_onboarding_request_body ?? "").trim()
  const incoming = next.body.trim()
  const body = prior && incoming && prior !== incoming
    ? `${prior}\n${incoming}`
    : incoming || prior
  const priorMedia = current.pending_onboarding_request_media ?? []
  const media = [...priorMedia, ...next.mediaUrls].filter(Boolean)
  const uniqueMedia = [...new Set(media)]
  return {
    ...current,
    pending_onboarding_request_body: body,
    pending_onboarding_request_media: uniqueMedia.length > 0 ? uniqueMedia : undefined,
    pending_onboarding_request_at: receivedAt,
  }
}

export function takeParkedOnboardingRequest(
  current: SmsIntakeState,
): { parked: ParkedOnboardingRequest | null; next: SmsIntakeState } {
  const body = (current.pending_onboarding_request_body ?? "").trim()
  const media = (current.pending_onboarding_request_media ?? []).filter(Boolean)
  const {
    pending_onboarding_request_body: _b,
    pending_onboarding_request_media: _m,
    pending_onboarding_request_at: _a,
    ...rest
  } = current
  if (!body) return { parked: null, next: rest }
  return { parked: { body, mediaUrls: media }, next: rest }
}

async function loadIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<SmsIntakeState> {
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  if (error) {
    console.warn("[tenantActivationPending] load intake_state", error.message)
    return {}
  }
  return asIntake(data?.intake_state)
}

async function writeIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
  intake: SmsIntakeState,
): Promise<void> {
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      intake_state: intake,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
  if (error) {
    console.warn("[tenantActivationPending] write intake_state", error.message)
  }
}

export async function parkOnboardingRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string | null
    body: string
    mediaUrls?: string[]
  },
): Promise<ParkedOnboardingRequest> {
  const current = await loadIntakeState(supabase, params.conversationId)
  const parked = mergeParkedOnboardingRequest(
    current,
    {
      body: params.body,
      mediaUrls: params.mediaUrls ?? [],
    },
    new Date().toISOString(),
  )
  await writeIntakeState(supabase, params.conversationId, parked)
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "tenant.activation_request_held",
    source: "sms",
    actorType: "resident",
    actorId: params.residentId,
    residentId: params.residentId,
    conversationId: params.conversationId,
    metadata: {
      message:
        "Noted the resident's text and asked them to reply YES or NO to the welcome message first.",
    },
  })
  return {
    body: (parked.pending_onboarding_request_body ?? "").trim(),
    mediaUrls: parked.pending_onboarding_request_media ?? [],
  }
}

export async function consumeParkedOnboardingRequest(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ParkedOnboardingRequest | null> {
  const current = await loadIntakeState(supabase, conversationId)
  const { parked, next } = takeParkedOnboardingRequest(current)
  if (!parked) return null
  await writeIntakeState(supabase, conversationId, next)
  return parked
}

export async function tryHandleTenantActivationHold(
  supabase: SupabaseClient,
  params: {
    body: string
    landlordId: string
    conversationId: string
    provider: SmsProviderName
    uloNumber: string
    externalPhone: string
    residentId?: string | null
    identityType?: string | null
    conversationType?: string | null
    mediaUrls?: string[]
  },
): Promise<{ handled: boolean; outboundMessageId?: string }> {
  const residentId = params.residentId?.trim() || null
  if (!residentId) return { handled: false }

  const { data, error } = await supabase
    .from("users")
    .select("full_name, sms_consent_status, activation_status, activation_sms_sent_at")
    .eq("id", residentId)
    .maybeSingle()

  if (error) {
    console.warn("[tenantActivationPending] hold state lookup", error.message)
    return { handled: false }
  }

  const row = data as {
    full_name?: string | null
    sms_consent_status?: string | null
    activation_status?: string | null
    activation_sms_sent_at?: string | null
  } | null

  if (
    !canHandleTenantActivationHold({
      body: params.body,
      residentId,
      identityType: params.identityType,
      conversationType: params.conversationType,
      smsConsentStatus: row?.sms_consent_status,
      activationStatus: row?.activation_status,
      activationSmsSentAt: row?.activation_sms_sent_at,
    })
  ) {
    return { handled: false }
  }

  await parkOnboardingRequest(supabase, {
    landlordId: params.landlordId,
    conversationId: params.conversationId,
    residentId,
    body: params.body,
    mediaUrls: params.mediaUrls,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    fromNumber: params.uloNumber,
    toNumber: params.externalPhone,
    body: composeTenantActivationHoldSms({ tenantName: row?.full_name }),
    provider: params.provider,
    source: "tenant_activation_hold",
  })

  return { handled: true, outboundMessageId: sent.ok ? sent.messageId : undefined }
}
