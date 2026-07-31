/**
 * Alert landlords when something lands in Needs Your Attention.
 * Best-effort SMS and/or email — never blocks the originating workflow.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendLandlordOpsEmail } from "./landlordOpsNotify.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { getSMSProvider } from "./sms/providerFactory.ts"
import { uloAppUrl } from "./uloAppUrl.ts"

export type LandlordAttentionKind =
  | "invoice_ready"
  | "assign_vendor"
  | "workflow_escalated"
  | "late_rent"
  | "lease_renewal"
  | "unknown_occupant"

export type NotifyLandlordAttentionParams = {
  landlordId: string
  kind: LandlordAttentionKind
  /** Short label shown after "needs your attention", e.g. "Invoice ready to pay". */
  headline: string
  /** One plain-language context line (unit, vendor, amount, etc.). */
  detail: string
  idempotencyKey: string
  maintenanceRequestId?: string | null
  workflowRunId?: string | null
  vendorId?: string | null
  unitId?: string | null
  residentId?: string | null
  propertyId?: string | null
}

export type NotifyLandlordAttentionResult = {
  skipped: boolean
  reason?: string
  smsSent: string[]
  emailSent: string[]
  errors: string[]
}

function attentionDashboardUrl(): string {
  return uloAppUrl.admin()
}

function adminNotifyPhones(): string[] {
  const raw =
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ||
    Deno.env.get("LANDLORD_OPS_PHONE")?.trim() ||
    ""
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((p: string) => normalizePhoneFlexible(p))
    .filter((p: string | null): p is string => Boolean(p))
}

export function buildLandlordAttentionSms(input: {
  headline: string
  detail: string
  dashboardUrl: string
}): string {
  const detail = input.detail.trim()
  return [
    "This is the property management team.",
    "",
    `Something needs your attention in Ulo: ${input.headline.trim()}.`,
    detail ? detail : null,
    "",
    "Review it in Needs Your Attention or your Ulo Activity Feed:",
    input.dashboardUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")
}

export function buildLandlordAttentionEmail(input: {
  headline: string
  detail: string
  dashboardUrl: string
}): { subject: string; text: string; html: string } {
  const headline = input.headline.trim()
  const detail = input.detail.trim()
  const subject = `Needs your attention: ${headline}`
  const text = [
    "This is the property management team.",
    "",
    `Something needs your attention in Ulo: ${headline}.`,
    detail ? detail : null,
    "",
    "Review it in Needs Your Attention or your Ulo Activity Feed on Overview:",
    input.dashboardUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")

  const html = `<p>This is the property management team.</p>
<p>Something needs your attention in Ulo: <strong>${escapeHtml(headline)}</strong>.</p>
${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
<p>This alert also appears in your <strong>Ulo Activity Feed</strong> on Overview.</p>
<p><a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open Needs Your Attention</a></p>
<p style="color:#6a7282;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(input.dashboardUrl)}</p>`

  return { subject, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function alreadyAlerted(
  supabase: SupabaseClient,
  landlordId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", landlordId)
    .eq("event_type", "landlord.attention_alert_sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40)

  if (error) {
    console.warn("[landlord-attention] idempotency lookup", error.message)
    return false
  }

  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (meta?.idempotency_key === idempotencyKey) return true
  }
  return false
}

/**
 * Send SMS and/or email when an item is added to Needs Your Attention.
 * Idempotent on `idempotencyKey` (14-day window).
 */
export async function notifyLandlordNeedsAttention(
  supabase: SupabaseClient,
  params: NotifyLandlordAttentionParams,
): Promise<NotifyLandlordAttentionResult> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) {
    return {
      skipped: true,
      reason: "missing_landlord",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const key = params.idempotencyKey.trim()
  if (!key) {
    return {
      skipped: true,
      reason: "missing_idempotency_key",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  if (await alreadyAlerted(supabase, landlordId, key)) {
    return {
      skipped: true,
      reason: "already_sent",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const dashboardUrl = attentionDashboardUrl()
  const smsBody = buildLandlordAttentionSms({
    headline: params.headline,
    detail: params.detail,
    dashboardUrl,
  })
  const email = buildLandlordAttentionEmail({
    headline: params.headline,
    detail: params.detail,
    dashboardUrl,
  })

  const errors: string[] = []
  const smsSent: string[] = []
  const emailSent: string[] = []

  const phones = adminNotifyPhones()
  if (phones.length > 0) {
    const sender = await findActiveLandlordMainNumber(supabase, landlordId)
    const from = sender?.phone_number?.trim() || undefined
    if (!from) {
      errors.push("no_landlord_main_sms")
      console.warn("[landlord-attention] no landlord_main SMS number", landlordId)
    } else {
      const provider = getSMSProvider()
      for (const to of phones) {
        const send = await provider.sendMessage({ to, body: smsBody, from })
        if (send.error) {
          errors.push(`sms:${to}:${send.error}`)
          console.error("[landlord-attention] SMS failed", to, send.error)
          continue
        }
        smsSent.push(to)
      }
    }
  }

  const mail = await sendLandlordOpsEmail(supabase, {
    landlordId,
    subject: email.subject,
    text: email.text,
    html: email.html,
    logLabel: `attention:${params.kind}:${key}`,
  })
  emailSent.push(...mail.sent)
  for (const e of mail.errors) errors.push(`email:${e}`)

  if (smsSent.length === 0 && emailSent.length === 0) {
    console.warn("[landlord-attention] no delivery", {
      landlordId,
      kind: params.kind,
      errors,
    })
    return { skipped: false, smsSent, emailSent, errors }
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "landlord.attention_alert_sent",
      source: "automation",
      actor_type: "system",
      maintenance_request_id: params.maintenanceRequestId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      vendor_id: params.vendorId ?? null,
      unit_id: params.unitId ?? null,
      resident_id: params.residentId ?? null,
      property_id: params.propertyId ?? null,
      metadata: {
        kind: params.kind,
        headline: params.headline,
        detail: params.detail,
        idempotency_key: key,
        sms_sent: smsSent,
        email_sent: emailSent,
        channels: [
          ...(smsSent.length ? ["sms"] : []),
          ...(emailSent.length ? ["email"] : []),
          "activity_feed",
        ],
        activity_feed: true,
      },
    })
  } catch (e) {
    console.error("[landlord-attention] graph", e)
  }

  return { skipped: false, smsSent, emailSent, errors }
}
