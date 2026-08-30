/**
 * External + in-app landlord alerts when resident activation SMS is permanently undeliverable.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  filterVendorEmailsFromOpsRecipients,
  normalizeOpsEmail,
  parseOpsEmailList,
  sendLandlordOpsEmail,
} from "../landlordOpsNotify.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import {
  buildOperationalMessage,
  normalizeCommunicationStyle,
} from "../communicationStyle.ts"
import {
  activationAdminAlertDedupKey,
  buildActivationAdminEmail,
  buildActivationInAppCopy,
  filterVendorPhonesFromOpsRecipients,
  friendlyActivationFailureReason,
  maskPhoneLast4,
  normalizeOpsAlertChannelPreference,
  opsAlertChannelsEnabled,
  type OpsAlertChannelPreference,
} from "./tenantActivationFailure.ts"
import { uloAppUrl } from "../uloAppUrl.ts"

export type { OpsAlertChannelPreference }
export {
  filterVendorPhonesFromOpsRecipients,
  normalizeOpsAlertChannelPreference,
  opsAlertChannelsEnabled,
}

export type ActivationAdminAlertParams = {
  landlordId: string
  residentId: string
  residentName?: string | null
  unitLabel?: string | null
  propertyName?: string | null
  phone?: string | null
  attemptNumber: number
  attemptId?: string | null
  failureReason?: string | null
  providerErrorCode?: string | null
  /** When true, skip SMS/email but still ensure in-app notification metadata is logged. */
  inAppOnly?: boolean
}

export type ActivationAdminAlertResult = {
  skipped: boolean
  reason?: string
  deduplicationKey: string
  smsSent: string[]
  emailSent: string[]
  inAppRecorded: boolean
  errors: string[]
  channelsAttempted: string[]
  channelsDelivered: string[]
}

function residentDetailsUrl(building: string, residentId: string): string {
  const slug = encodeURIComponent(building.trim() || "property")
  return uloAppUrl.admin(
    `properties/${slug}/residents/${encodeURIComponent(residentId)}`,
  )
}

function adminNotifyPhonesFromEnv(): string[] {
  const raw =
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ||
    Deno.env.get("LANDLORD_OPS_PHONE")?.trim() ||
    ""
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizePhoneFlexible(p))
    .filter((p): p is string => Boolean(p))
}

async function loadVendorPhonesForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Set<string>> {
  const blocked = new Set<string>()
  const { data, error } = await supabase
    .from("vendors")
    .select("phone")
    .eq("landlord_id", landlordId)
    .not("phone", "is", null)
    .limit(2000)
  if (error) {
    console.warn("[activation-admin-alert] vendor phone lookup", error.message)
    return blocked
  }
  for (const row of data ?? []) {
    const n = normalizePhoneFlexible(typeof row.phone === "string" ? row.phone : "")
    if (n) blocked.add(n)
  }
  return blocked
}

async function loadVendorEmailsForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("email")
    .eq("landlord_id", landlordId)
    .not("email", "is", null)
    .limit(2000)
  if (error) return []
  const out: string[] = []
  for (const row of data ?? []) {
    const n = normalizeOpsEmail(typeof row.email === "string" ? row.email : "")
    if (n) out.push(n)
  }
  return out
}

/**
 * Resolve landlord/property-team phones for operational activation alerts.
 * Sources: env ops phones, landlords.phone, onboarding account/backup/PM phones.
 * Excludes vendor phones.
 */
export async function resolveLandlordOpsPhones(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phones: string[]; blocked: string[] }> {
  const candidates = new Set<string>(adminNotifyPhonesFromEnv())

  const { data: landlord } = await supabase
    .from("landlords")
    .select("phone, email")
    .eq("id", landlordId)
    .maybeSingle()
  if (typeof landlord?.phone === "string") {
    const n = normalizePhoneFlexible(landlord.phone)
    if (n) candidates.add(n)
  }

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state, properties, onboarding_status")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  for (const key of ["phone", "backupContactPhone", "backup_contact_phone"]) {
    const n = normalizePhoneFlexible(
      typeof account[key] === "string" ? (account[key] as string) : "",
    )
    if (n) candidates.add(n)
  }

  const { data: propertyRows } = await supabase
    .from("properties")
    .select("manager_phone")
    .eq("landlord_id", landlordId)
    .limit(200)

  for (const row of propertyRows ?? []) {
    const n = normalizePhoneFlexible(
      typeof row.manager_phone === "string" ? row.manager_phone : "",
    )
    if (n) candidates.add(n)
  }

  const onboardingCompleted = onboarding?.onboarding_status === "completed"
  const hasCanonicalProperties = (propertyRows?.length ?? 0) > 0
  if (!onboardingCompleted && !hasCanonicalProperties) {
    const properties = Array.isArray(onboarding?.properties)
      ? onboarding.properties
      : Array.isArray(draft.properties)
        ? draft.properties
        : []
    for (const raw of properties) {
      if (!raw || typeof raw !== "object") continue
      const row = raw as Record<string, unknown>
      const n = normalizePhoneFlexible(
        typeof row.propertyManagerPhone === "string"
          ? row.propertyManagerPhone
          : typeof row.property_manager_phone === "string"
            ? row.property_manager_phone
            : "",
      )
      if (n) candidates.add(n)
    }
  }

  const vendorPhones = await loadVendorPhonesForLandlord(supabase, landlordId)
  const { allowed, blocked } = filterVendorPhonesFromOpsRecipients(
    candidates,
    vendorPhones,
  )
  return { phones: allowed, blocked }
}

/**
 * Resolve SMS / email preference from landlord_onboarding (column + draft approval rules).
 * Defaults to both when unset.
 */
export async function resolveLandlordOpsAlertChannelPreference(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<OpsAlertChannelPreference> {
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("notification_channel, draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const approval = (draft.approvalRules ?? {}) as Record<string, unknown>
  const fromDraft =
    approval.notificationChannel ?? approval.notification_channel
  const fromColumn = onboarding?.notification_channel
  return normalizeOpsAlertChannelPreference(fromDraft ?? fromColumn ?? "both")
}

/**
 * Extra landlord emails from onboarding account setup (not only landlords.email).
 */
export async function resolveOnboardingOpsEmails(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const out: string[] = []
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  for (const key of ["email"]) {
    const n = normalizeOpsEmail(
      typeof account[key] === "string" ? (account[key] as string) : "",
    )
    if (n) out.push(n)
  }
  // Env list already handled by sendLandlordOpsEmail; return onboarding extras only.
  void parseOpsEmailList
  return out
}

async function alreadyAlerted(
  supabase: SupabaseClient,
  landlordId: string,
  deduplicationKey: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", landlordId)
    .in("event_type", [
      "tenant.activation_admin_alert_sent",
      "tenant.activation_action_required",
    ])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(80)

  if (error) {
    console.warn("[activation-admin-alert] dedupe lookup", error.message)
    return false
  }

  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (
      meta?.deduplication_key === deduplicationKey ||
      meta?.idempotency_key === deduplicationKey
    ) {
      return true
    }
  }
  return false
}

/**
 * Notify landlord/property team (SMS and/or email) and record an in-app notification event.
 * Idempotent on deduplication_key.
 */
export async function notifyLandlordActivationUndeliverable(
  supabase: SupabaseClient,
  params: ActivationAdminAlertParams,
): Promise<ActivationAdminAlertResult> {
  const landlordId = params.landlordId.trim()
  const residentId = params.residentId.trim()
  const attemptKey = params.attemptId?.trim() || String(params.attemptNumber)
  const deduplicationKey = activationAdminAlertDedupKey(residentId, attemptKey)

  const empty = (reason: string): ActivationAdminAlertResult => ({
    skipped: true,
    reason,
    deduplicationKey,
    smsSent: [],
    emailSent: [],
    inAppRecorded: false,
    errors: [],
    channelsAttempted: [],
    channelsDelivered: [],
  })

  if (!landlordId || !residentId) return empty("missing_ids")

  if (await alreadyAlerted(supabase, landlordId, deduplicationKey)) {
    return empty("already_sent")
  }

  const unitLabel = (params.unitLabel ?? "").trim() || "—"
  const propertyName = (params.propertyName ?? "").trim() || "your property"
  const residentName = (params.residentName ?? "").trim()
  const last4 = maskPhoneLast4(params.phone)
  const maskedPhone = last4 ? `•••-•••-${last4}` : null
  const friendlyReason = friendlyActivationFailureReason(
    params.failureReason,
    params.providerErrorCode,
  )
  const detailsUrl = residentDetailsUrl(propertyName, residentId)
  const inApp = buildActivationInAppCopy({ unitLabel })

  const { data: landlordRow } = await supabase
    .from("landlords")
    .select("communication_style, name")
    .eq("id", landlordId)
    .maybeSingle()
  const communicationStyle = normalizeCommunicationStyle(
    landlordRow?.communication_style,
  )
  const landlordName =
    typeof landlordRow?.name === "string" ? landlordRow.name : null

  const styledSms = buildOperationalMessage({
    style: communicationStyle,
    audience: "landlord",
    channel: "sms",
    eventType: "activation_undeliverable",
    severity: "action_required",
    facts: {
      landlordName,
      residentName: residentName || "the resident",
      unitLabel,
      propertyName,
    },
  })
  const styledEmail = buildOperationalMessage({
    style: communicationStyle,
    audience: "landlord",
    channel: "email",
    eventType: "activation_undeliverable",
    severity: "action_required",
    facts: {
      landlordName,
      residentName: residentName || "the resident",
      unitLabel,
      propertyName,
      deepLink: detailsUrl,
    },
  })
  const smsBody = last4
    ? `${styledSms.body} Phone ending in ${last4}`
    : styledSms.body
  const emailCopy = {
    ...buildActivationAdminEmail({
      residentName,
      unitLabel,
      propertyName,
      maskedPhone,
      friendlyReason,
      residentDetailsUrl: detailsUrl,
    }),
    subject: styledEmail.subject ??
      `Resident phone needs attention — Unit ${unitLabel}`,
    text: styledEmail.body,
  }

  const errors: string[] = []
  const smsSent: string[] = []
  const emailSent: string[] = []
  const channelsAttempted: string[] = []
  let channelPref: OpsAlertChannelPreference | null = null

  if (!params.inAppOnly) {
    channelPref = await resolveLandlordOpsAlertChannelPreference(
      supabase,
      landlordId,
    )
    const enabled = opsAlertChannelsEnabled(channelPref)

    if (enabled.sms) {
      const { phones, blocked: blockedPhones } = await resolveLandlordOpsPhones(
        supabase,
        landlordId,
      )
      if (blockedPhones.length > 0) {
        console.warn("[activation-admin-alert] blocked vendor phones", {
          landlordId,
          blockedPhones,
        })
      }

      if (phones.length > 0) {
        channelsAttempted.push("sms")
        const sender = await findActiveLandlordMainNumber(supabase, landlordId)
        const from = sender?.phone_number?.trim() || undefined
        if (!from) {
          errors.push("no_landlord_main_sms")
        } else {
          const provider = getSMSProviderForSend({
            landlordId,
            lineProvider: sender.provider,
          })
          for (const to of phones) {
            const send = await provider.sendMessage({ to, body: smsBody, from })
            if (send.error) {
              errors.push(`sms:${to}:${send.error}`)
              continue
            }
            smsSent.push(to)
          }
        }
      }
    }

    if (enabled.email) {
      const onboardingEmails = await resolveOnboardingOpsEmails(
        supabase,
        landlordId,
      )
      channelsAttempted.push("email")
      const mail = await sendLandlordOpsEmail(supabase, {
        landlordId,
        subject: emailCopy.subject,
        text: emailCopy.text,
        html: emailCopy.html,
        extraEmails: onboardingEmails,
        logLabel: `tenant-activation-undeliverable:${deduplicationKey}`,
      })
      emailSent.push(...mail.sent)
      for (const e of mail.errors) errors.push(`email:${e}`)
    }

    // Vendor email filter lives in sendLandlordOpsEmail; phone filter above.
    void filterVendorEmailsFromOpsRecipients
    void loadVendorEmailsForLandlord
  }

  const activityFeedEnabled = channelPref
    ? opsAlertChannelsEnabled(channelPref).activityFeed
    : true
  if (activityFeedEnabled) {
    channelsAttempted.push("activity_feed")
  }
  const channelsDelivered = [
    ...(smsSent.length ? ["sms"] : []),
    ...(emailSent.length ? ["email"] : []),
    ...(activityFeedEnabled ? ["activity_feed"] : []),
  ]

  const externalDelivered = smsSent.length > 0 || emailSent.length > 0
  const alertDelivered = externalDelivered || activityFeedEnabled

  if (!alertDelivered && !params.inAppOnly) {
    console.warn("[activation-admin-alert] no external recipient available", {
      landlordId,
      residentId,
      deduplicationKey,
      errors,
    })
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "tenant.activation_admin_alert_failed",
      source: "edge_function",
      actor_type: "system",
      resident_id: residentId,
      metadata: {
        message: inApp.summary,
        title: inApp.title,
        deduplication_key: deduplicationKey,
        reason: "no_external_recipient",
        attempt_number: params.attemptNumber,
        failure_type: friendlyReason,
        provider_error_code: params.providerErrorCode ?? null,
        channel_preference: channelPref,
        channels_attempted: channelsAttempted,
        channels_delivered: activityFeedEnabled ? ["activity_feed"] : [],
        activity_feed: activityFeedEnabled,
        in_app: true,
        resident_details_url: detailsUrl,
        unit_label: unitLabel,
        property_name: propertyName,
      },
    })
  } else if (!params.inAppOnly) {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "tenant.activation_admin_alert_sent",
      source: "edge_function",
      actor_type: "system",
      resident_id: residentId,
      metadata: {
        message: inApp.summary,
        title: inApp.title,
        deduplication_key: deduplicationKey,
        attempt_number: params.attemptNumber,
        failure_type: friendlyReason,
        provider_error_code: params.providerErrorCode ?? null,
        channel_preference: channelPref,
        channels_attempted: channelsAttempted,
        channels_delivered: channelsDelivered,
        sms_sent_count: smsSent.length,
        email_sent_count: emailSent.length,
        activity_feed: activityFeedEnabled,
        in_app: true,
        resident_details_url: detailsUrl,
        unit_label: unitLabel,
        property_name: propertyName,
        phone_last4: last4,
      },
    })
  }

  // Always record action_required + in-app payload (even when external send failed).
  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "tenant.activation_action_required",
    source: "edge_function",
    actor_type: "system",
    resident_id: residentId,
    metadata: {
      message: inApp.summary,
      title: inApp.title,
      deduplication_key: deduplicationKey,
      attempt_number: params.attemptNumber,
      failure_type: friendlyReason,
      provider_error_code: params.providerErrorCode ?? null,
      channel_preference: channelPref,
      channels_attempted: channelsAttempted,
      channels_delivered: channelsDelivered,
      in_app: true,
      notification_status: "open",
      resident_details_url: detailsUrl,
      unit_label: unitLabel,
      property_name: propertyName,
      actions: ["review_resident", "edit_phone", "resend_activation"],
    },
  })

  return {
    skipped: false,
    deduplicationKey,
    smsSent,
    emailSent,
    inAppRecorded: true,
    errors,
    channelsAttempted,
    channelsDelivered,
  }
}

/** Mark prior undeliverable admin alerts resolved (phone edit or successful activation). */
export async function resolveActivationAdminAlerts(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    reason: "phone_updated" | "activated" | "resend_succeeded"
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "tenant.activation_failure_resolved",
    source: "edge_function",
    actor_type: "system",
    resident_id: params.residentId,
    metadata: {
      message: `Activation failure resolved (${params.reason}).`,
      reason: params.reason,
      notification_status: "resolved",
    },
  })
}
