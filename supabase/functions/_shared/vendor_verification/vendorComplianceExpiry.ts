/**
 * COI & license expiration management.
 *
 * | Trigger              | Action                         | Eligibility |
 * |----------------------|--------------------------------|-------------|
 * | 30 days before       | SMS warning + renewal link     | ACTIVE      |
 * | 7 days before        | 2nd SMS + Ulo ops notified     | ACTIVE      |
 * | Expiry date          | Auto-SUSPENDED                 | SUSPENDED   |
 * | New COI/license OK   | Status → ACTIVE restored       | ACTIVE      |
 *
 * Capacity (Paused) is separate — this updates account roster hold only.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import { getSMSProvider } from "../sms/providerFactory.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { resolveVendorVerificationConversationId } from "../sms/vendorVerificationInbox.ts"
import type { SmsProviderName } from "../sms/types.ts"
import { uloAppUrl } from "../uloAppUrl.ts"

export type ComplianceDocKind = "coi" | "license"

export type ComplianceExpiryNotices = {
  coi_30?: string
  coi_7?: string
  license_30?: string
  license_7?: string
  suspended_for?: string
}

export type ComplianceExpirySummary = {
  scanned: number
  warned30: number
  warned7: number
  suspended: number
  restored: number
  errors: string[]
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function daysUntil(dateIso: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso.trim())
  if (!m) return null
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((exp - today) / (24 * 60 * 60 * 1000))
}

function asNotices(raw: unknown): ComplianceExpiryNotices {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return { ...(raw as ComplianceExpiryNotices) }
}

function docLabel(kind: ComplianceDocKind): string {
  return kind === "coi" ? "insurance certificate (COI)" : "professional license"
}

export function buildComplianceExpiryWarningSms(input: {
  vendorLabel: string
  companyName?: string | null
  kind: ComplianceDocKind
  daysLeft: number
  expirationDate: string
  renewalLink: string
  isSecondNotice: boolean
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  const doc = docLabel(input.kind)
  const urgency = input.isSecondNotice
    ? `This is a second reminder — your ${doc} expires in ${input.daysLeft} day${
      input.daysLeft === 1 ? "" : "s"
    } (${input.expirationDate}).`
    : `Your ${doc} expires in ${input.daysLeft} day${
      input.daysLeft === 1 ? "" : "s"
    } (${input.expirationDate}).`

  return [
    `Hi ${name},`,
    "",
    team,
    "",
    urgency,
    "",
    "Please upload your renewed document so we can keep sending you work orders:",
    input.renewalLink,
  ].join("\n")
}

export function buildComplianceSuspendedSms(input: {
  vendorLabel: string
  companyName?: string | null
  kinds: ComplianceDocKind[]
  renewalLink: string
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  const docs = input.kinds.map(docLabel).join(" and ")
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    `Your ${docs} ${input.kinds.length > 1 ? "have" : "has"} expired, so new work orders are paused until we verify a renewal.`,
    "",
    "Jobs you already accepted are unchanged. Upload your renewed document here:",
    input.renewalLink,
  ].join("\n")
}

export function buildComplianceRestoredSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    "Thanks — we verified your renewed documents. You're eligible for new work orders again.",
  ].join("\n")
}

function adminNotifyPhones(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ?? ""
  return raw.split(",").map((p) => p.trim()).filter(Boolean)
}

async function loadCompanyName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", landlordId)
    .maybeSingle()
  const name = typeof data?.name === "string" ? data.name.trim() : ""
  return name || null
}

async function ensureVendorSmsChannel(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    phone: string | null
    inviteConversationId?: string | null
  },
): Promise<{
  conversationId: string | null
  fromNumber: string | null
  toNumber: string | null
  provider: SmsProviderName | null
}> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line?.phone) {
    return { conversationId: null, fromNumber: null, toNumber: null, provider: null }
  }
  const provider: SmsProviderName = line.provider === "telnyx" ? "telnyx" : "twilio"
  const toNumber = normalizeSmsPhone(params.phone ?? "")
  let conversationId = await resolveVendorVerificationConversationId(supabase, {
    landlordId: params.landlordId,
    inviteConversationId: params.inviteConversationId ?? null,
    vendorId: params.vendorId,
    phone: params.phone,
  })

  if (!conversationId && toNumber) {
    const identity = await upsertSmsIdentityForPhone(supabase, {
      landlordId: params.landlordId,
      phone: toNumber,
      identityType: "vendor",
      vendorId: params.vendorId ?? null,
    })
    if (identity) {
      const created = await findOrCreateConversation(supabase, {
        landlordId: params.landlordId,
        smsNumberId: line.id,
        externalPhone: toNumber,
        identity,
        conversationStatus: "open",
      })
      conversationId = created.conversationId
    }
  }

  return {
    conversationId,
    fromNumber: normalizeSmsPhone(line.phone),
    toNumber: toNumber || null,
    provider,
  }
}

async function sendVendorSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    phone: string | null
    inviteConversationId?: string | null
    body: string
    source: string
  },
): Promise<string | null> {
  const channel = await ensureVendorSmsChannel(supabase, params)
  if (
    !channel.conversationId ||
    !channel.fromNumber ||
    !channel.toNumber ||
    !channel.provider
  ) {
    return null
  }
  const sent = await sendInboundAutoReply(supabase, {
    conversationId: channel.conversationId,
    landlordId: params.landlordId,
    fromNumber: channel.fromNumber,
    toNumber: channel.toNumber,
    body: params.body,
    provider: channel.provider,
    source: params.source,
  })
  return sent.messageId
}

async function notifyOpsExpiry(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    vendorName: string
    kind: ComplianceDocKind
    daysLeft: number
    expirationDate: string
  },
): Promise<void> {
  const subject =
    `${params.vendorName}: ${docLabel(params.kind)} expires in ${params.daysLeft} day${
      params.daysLeft === 1 ? "" : "s"
    }`
  const text =
    `${params.vendorName}'s ${docLabel(params.kind)} expires on ${params.expirationDate} ` +
    `(${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"} left).\n\n` +
    `They've been texted a renewal link. Review vendors in the Ulo dashboard if needed.`
  const html =
    `<p><strong>${params.vendorName}</strong>'s ${docLabel(params.kind)} expires on ` +
    `<strong>${params.expirationDate}</strong> (${params.daysLeft} day${
      params.daysLeft === 1 ? "" : "s"
    } left).</p>` +
    `<p>They've been texted a renewal link. Review vendors in the Ulo dashboard if needed.</p>`

  await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject,
    text,
    html,
    logLabel: "vendor_compliance_expiry",
  })

  const phones = adminNotifyPhones()
  if (phones.length === 0) return
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line?.phone) return
  const provider = getSMSProvider()
  const body =
    `Ulo ops: ${params.vendorName} — ${docLabel(params.kind)} expires in ${params.daysLeft}d ` +
    `(${params.expirationDate}). Renewal SMS sent.`
  for (const to of phones) {
    const send = await provider.sendMessage({
      to,
      body,
      from: line.phone,
    })
    if (send.error) {
      console.warn("[vendor-compliance-expiry] ops SMS failed", to, send.error)
    }
  }
}

function licenseIsExpired(row: {
  license_expiration?: string | null
  license_status?: string | null
}, now = new Date()): boolean {
  const exp = typeof row.license_expiration === "string" ? row.license_expiration.trim() : ""
  if (exp) {
    const d = daysUntil(exp, now)
    return d != null && d <= 0
  }
  return (row.license_status ?? "").trim().toLowerCase() === "expired"
}

function coiIsExpired(row: {
  coi_expiration?: string | null
}, now = new Date()): boolean {
  const exp = typeof row.coi_expiration === "string" ? row.coi_expiration.trim() : ""
  if (!exp) return false
  const d = daysUntil(exp, now)
  return d != null && d <= 0
}

function coiIsValid(row: {
  coi_expiration?: string | null
  coi_general_liability?: number | null
  coi_status?: string | null
  coi_additional_insured?: boolean | null
}, now = new Date()): boolean {
  const gl = typeof row.coi_general_liability === "number" ? row.coi_general_liability : null
  if (gl == null || gl < 1_000_000) return false
  if (row.coi_additional_insured !== true) return false
  if (coiIsExpired(row, now)) return false
  const status = (row.coi_status ?? "").trim().toLowerCase()
  if (status && status !== "verified" && status !== "active" && status !== "review") {
    // allow review/verified/empty — treat expired separately
  }
  return true
}

function licenseIsValid(row: {
  license_expiration?: string | null
  license_status?: string | null
  license_number?: string | null
}, now = new Date()): boolean {
  if (licenseIsExpired(row, now)) return false
  const status = (row.license_status ?? "").trim().toLowerCase()
  if (["expired", "not_found"].includes(status)) return false
  return Boolean((row.license_number ?? "").trim() || ["verified", "active"].includes(status))
}

async function updateNotices(
  supabase: SupabaseClient,
  verificationId: string,
  notices: ComplianceExpiryNotices,
): Promise<void> {
  const { error } = await supabase
    .from("vendor_verifications")
    .update({
      compliance_expiry_notices: notices,
      updated_at: new Date().toISOString(),
    })
    .eq("id", verificationId)
  if (error) {
    console.error("[vendor-compliance-expiry] notices update", error.message)
  }
}

async function suspendVendorForExpiry(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    verificationId: string
    vendorName: string
    phone: string | null
    token: string
    inviteConversationId: string | null
    companyName: string | null
    kinds: ComplianceDocKind[]
    notices: ComplianceExpiryNotices
  },
): Promise<boolean> {
  const reason = params.kinds.length > 1
    ? "compliance_expired"
    : params.kinds[0] === "coi"
      ? "coi_expired"
      : "license_expired"

  const { error } = await supabase
    .from("vendors")
    .update({
      roster_status: "suspended",
      roster_status_reason: reason,
    })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)

  if (error) {
    console.error("[vendor-compliance-expiry] suspend", error.message)
    return false
  }

  const renewalLink = uloAppUrl.vendorVerification(params.token)
  const body = buildComplianceSuspendedSms({
    vendorLabel: params.vendorName,
    companyName: params.companyName,
    kinds: params.kinds,
    renewalLink,
  })
  const messageId = await sendVendorSms(supabase, {
    landlordId: params.landlordId,
    vendorId: params.vendorId,
    phone: params.phone,
    inviteConversationId: params.inviteConversationId,
    body,
    source: "vendor_compliance_suspended",
  })

  const nextNotices: ComplianceExpiryNotices = {
    ...params.notices,
    suspended_for: reason,
  }
  await updateNotices(supabase, params.verificationId, nextNotices)

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.compliance_auto_suspended",
    source: "automation",
    actor_type: "system",
    vendor_id: params.vendorId,
    message_id: messageId,
    metadata: {
      reason,
      kinds: params.kinds,
      summary: `${params.vendorName} auto-suspended — ${params.kinds.map(docLabel).join(" / ")} expired.`,
    },
  })

  await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject: `${params.vendorName} suspended — expired ${params.kinds.map(docLabel).join(" / ")}`,
    text:
      `${params.vendorName} was auto-suspended because their ${
        params.kinds.map(docLabel).join(" and ")
      } expired. They were texted a renewal link.`,
    html:
      `<p><strong>${params.vendorName}</strong> was auto-suspended because their ` +
      `${params.kinds.map(docLabel).join(" and ")} expired.</p>` +
      `<p>They were texted a renewal link.</p>`,
    logLabel: "vendor_compliance_suspend",
  })

  return true
}

async function processDocWarning(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    verificationId: string
    vendorName: string
    phone: string | null
    token: string
    inviteConversationId: string | null
    companyName: string | null
    kind: ComplianceDocKind
    expirationDate: string
    daysLeft: number
    notices: ComplianceExpiryNotices
  },
): Promise<{ warned30: boolean; warned7: boolean; notices: ComplianceExpiryNotices }> {
  let notices = { ...params.notices }
  let warned30 = false
  let warned7 = false
  const renewalLink = uloAppUrl.vendorVerification(params.token)
  const key30 = params.kind === "coi" ? "coi_30" : "license_30"
  const key7 = params.kind === "coi" ? "coi_7" : "license_7"

  if (params.daysLeft <= 30 && params.daysLeft > 7 && !notices[key30]) {
    const body = buildComplianceExpiryWarningSms({
      vendorLabel: params.vendorName,
      companyName: params.companyName,
      kind: params.kind,
      daysLeft: params.daysLeft,
      expirationDate: params.expirationDate,
      renewalLink,
      isSecondNotice: false,
    })
    const messageId = await sendVendorSms(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      phone: params.phone,
      inviteConversationId: params.inviteConversationId,
      body,
      source: `vendor_compliance_${params.kind}_30`,
    })
    notices = { ...notices, [key30]: new Date().toISOString() }
    await updateNotices(supabase, params.verificationId, notices)
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.compliance_expiry_warn_30",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      message_id: messageId,
      metadata: {
        kind: params.kind,
        days_left: params.daysLeft,
        expiration_date: params.expirationDate,
      },
    })
    warned30 = true
  }

  if (params.daysLeft <= 7 && params.daysLeft > 0 && !notices[key7]) {
    const body = buildComplianceExpiryWarningSms({
      vendorLabel: params.vendorName,
      companyName: params.companyName,
      kind: params.kind,
      daysLeft: params.daysLeft,
      expirationDate: params.expirationDate,
      renewalLink,
      isSecondNotice: true,
    })
    const messageId = await sendVendorSms(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      phone: params.phone,
      inviteConversationId: params.inviteConversationId,
      body,
      source: `vendor_compliance_${params.kind}_7`,
    })
    notices = {
      ...notices,
      [key7]: new Date().toISOString(),
      // Mark 30d as sent too so we don't later send a late first notice.
      [key30]: notices[key30] ?? new Date().toISOString(),
    }
    await updateNotices(supabase, params.verificationId, notices)
    await notifyOpsExpiry(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      vendorName: params.vendorName,
      kind: params.kind,
      daysLeft: params.daysLeft,
      expirationDate: params.expirationDate,
    })
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.compliance_expiry_warn_7",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      message_id: messageId,
      metadata: {
        kind: params.kind,
        days_left: params.daysLeft,
        expiration_date: params.expirationDate,
        ops_notified: true,
      },
    })
    warned7 = true
  }

  return { warned30, warned7, notices }
}

/** Daily sweep for ACTIVE vendors with COI/license approaching or past expiry. */
export async function checkVendorComplianceExpiry(
  supabase: SupabaseClient,
  landlordId: string | null,
): Promise<ComplianceExpirySummary> {
  const summary: ComplianceExpirySummary = {
    scanned: 0,
    warned30: 0,
    warned7: 0,
    suspended: 0,
    restored: 0,
    errors: [],
  }

  let query = supabase
    .from("vendor_verifications")
    .select(
      "id, landlord_id, vendor_id, token, status, business_name, contact_name, phone, " +
        "coi_expiration, coi_general_liability, coi_status, license_expiration, license_status, " +
        "license_number, compliance_expiry_notices, invite_conversation_id",
    )
    .eq("status", "verified")
    .not("vendor_id", "is", null)
    .limit(500)

  if (landlordId?.trim()) {
    query = query.eq("landlord_id", landlordId.trim())
  }

  const { data: rows, error } = await query
  if (error) {
    summary.errors.push(error.message)
    return summary
  }

  const now = new Date()
  const companyCache = new Map<string, string | null>()

  for (const raw of rows ?? []) {
    const row = raw as Record<string, unknown>
    const verificationId = typeof row.id === "string" ? row.id : ""
    const lid = typeof row.landlord_id === "string" ? row.landlord_id : ""
    const vendorId = typeof row.vendor_id === "string" ? row.vendor_id : ""
    const token = typeof row.token === "string" ? row.token : ""
    if (!verificationId || !lid || !vendorId || !token) continue

    summary.scanned += 1

    const { data: vendor, error: vendorErr } = await supabase
      .from("vendors")
      .select("id, name, phone, roster_status, roster_status_reason, active")
      .eq("id", vendorId)
      .eq("landlord_id", lid)
      .maybeSingle()

    if (vendorErr || !vendor) {
      if (vendorErr) summary.errors.push(vendorErr.message)
      continue
    }

    const rosterStatus = typeof vendor.roster_status === "string"
      ? vendor.roster_status.trim().toLowerCase()
      : ""
    if (rosterStatus === "banned") continue

    if (!companyCache.has(lid)) {
      companyCache.set(lid, await loadCompanyName(supabase, lid))
    }
    const companyName = companyCache.get(lid) ?? null
    const vendorName =
      (typeof vendor.name === "string" && vendor.name.trim()) ||
      (typeof row.business_name === "string" && row.business_name.trim()) ||
      (typeof row.contact_name === "string" && row.contact_name.trim()) ||
      "Vendor"
    const phone =
      (typeof vendor.phone === "string" && vendor.phone) ||
      (typeof row.phone === "string" && row.phone) ||
      null
    const inviteConversationId =
      typeof row.invite_conversation_id === "string" ? row.invite_conversation_id : null
    let notices = asNotices(row.compliance_expiry_notices)

    // Already suspended for compliance — skip warnings; restore path is separate.
    if (rosterStatus === "suspended") {
      const reason = typeof vendor.roster_status_reason === "string"
        ? vendor.roster_status_reason
        : notices.suspended_for ?? ""
      if (
        reason === "coi_expired" ||
        reason === "license_expired" ||
        reason === "compliance_expired"
      ) {
        continue
      }
      // Other suspensions — still don't warn.
      continue
    }

    const expiredKinds: ComplianceDocKind[] = []
    const coiExp = typeof row.coi_expiration === "string" ? row.coi_expiration.trim() : ""
    const licenseExp =
      typeof row.license_expiration === "string" ? row.license_expiration.trim() : ""

    if (coiExp) {
      const d = daysUntil(coiExp, now)
      if (d != null && d <= 0) expiredKinds.push("coi")
      else if (d != null && d > 0) {
        const result = await processDocWarning(supabase, {
          landlordId: lid,
          vendorId,
          verificationId,
          vendorName,
          phone,
          token,
          inviteConversationId,
          companyName,
          kind: "coi",
          expirationDate: coiExp,
          daysLeft: d,
          notices,
        })
        notices = result.notices
        if (result.warned30) summary.warned30 += 1
        if (result.warned7) summary.warned7 += 1
      }
    }

    if (licenseExp) {
      const d = daysUntil(licenseExp, now)
      if (d != null && d <= 0) expiredKinds.push("license")
      else if (d != null && d > 0) {
        const result = await processDocWarning(supabase, {
          landlordId: lid,
          vendorId,
          verificationId,
          vendorName,
          phone,
          token,
          inviteConversationId,
          companyName,
          kind: "license",
          expirationDate: licenseExp,
          daysLeft: d,
          notices,
        })
        notices = result.notices
        if (result.warned30) summary.warned30 += 1
        if (result.warned7) summary.warned7 += 1
      }
    } else if (licenseIsExpired({
      license_status: typeof row.license_status === "string" ? row.license_status : null,
    }, now)) {
      expiredKinds.push("license")
    }

    if (expiredKinds.length > 0) {
      const ok = await suspendVendorForExpiry(supabase, {
        landlordId: lid,
        vendorId,
        verificationId,
        vendorName,
        phone,
        token,
        inviteConversationId,
        companyName,
        kinds: expiredKinds,
        notices,
      })
      if (ok) summary.suspended += 1
    }
  }

  return summary
}

/**
 * After a renewed COI/license is saved: if the vendor was auto-suspended for
 * compliance expiry and docs are valid again, clear suspension and text them.
 */
export async function maybeRestoreVendorAfterComplianceRenewal(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null | undefined
    verificationId: string
    token: string
    phone?: string | null
    inviteConversationId?: string | null
    vendorLabel?: string | null
    coi_expiration?: string | null
    coi_general_liability?: number | null
    coi_status?: string | null
    coi_additional_insured?: boolean | null
    license_expiration?: string | null
    license_status?: string | null
    license_number?: string | null
    compliance_expiry_notices?: unknown
  },
): Promise<{ restored: boolean }> {
  const vendorId = params.vendorId?.trim()
  if (!vendorId) return { restored: false }

  const { data: vendor, error } = await supabase
    .from("vendors")
    .select("id, name, phone, roster_status, roster_status_reason")
    .eq("id", vendorId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (error || !vendor) return { restored: false }
  if ((vendor.roster_status ?? "").toString().toLowerCase() !== "suspended") {
    return { restored: false }
  }

  const reason = (vendor.roster_status_reason ?? "").toString()
  const notices = asNotices(params.compliance_expiry_notices)
  const complianceReason =
    reason === "coi_expired" ||
    reason === "license_expired" ||
    reason === "compliance_expired" ||
    Boolean(notices.suspended_for)
  if (!complianceReason) return { restored: false }

  const now = new Date()
  if (!coiIsValid(params, now) || !licenseIsValid(params, now)) {
    return { restored: false }
  }

  const { error: clearErr } = await supabase
    .from("vendors")
    .update({
      roster_status: null,
      roster_status_reason: null,
      active: true,
    })
    .eq("id", vendorId)
    .eq("landlord_id", params.landlordId)

  if (clearErr) {
    console.error("[vendor-compliance-expiry] restore", clearErr.message)
    return { restored: false }
  }

  // Reset notice markers so the next expiry cycle can warn again.
  await updateNotices(supabase, params.verificationId, {})

  const companyName = await loadCompanyName(supabase, params.landlordId)
  const vendorName =
    params.vendorLabel?.trim() ||
    (typeof vendor.name === "string" && vendor.name.trim()) ||
    "there"
  const phone =
    params.phone ||
    (typeof vendor.phone === "string" ? vendor.phone : null)

  const messageId = await sendVendorSms(supabase, {
    landlordId: params.landlordId,
    vendorId,
    phone,
    inviteConversationId: params.inviteConversationId ?? null,
    body: buildComplianceRestoredSms({
      vendorLabel: vendorName,
      companyName,
    }),
    source: "vendor_compliance_restored",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.compliance_restored",
    source: "edge_function",
    actor_type: "system",
    vendor_id: vendorId,
    message_id: messageId,
    metadata: {
      previous_reason: reason || notices.suspended_for || null,
      summary: `${vendorName} restored to Active after renewed compliance documents.`,
    },
  })

  return { restored: true }
}

/** Test helpers */
export const __test = {
  daysUntil,
  todayIso,
  licenseIsExpired,
  coiIsExpired,
  coiIsValid,
  licenseIsValid,
}
