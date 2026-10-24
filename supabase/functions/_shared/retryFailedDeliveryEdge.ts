import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  handleRetryFailedDelivery,
  type ClaimOutcome,
  type DeliveryLog,
  type RetryChannel,
  type RetryDeps,
  type RetrySource,
} from "./retryFailedDelivery.ts"

type LogTable =
  | "resident_notification_log"
  | "vendor_notification_log"
  | "broadcast_notification_log"

function tableFor(source: RetrySource): LogTable {
  if (source === "resident") return "resident_notification_log"
  if (source === "vendor") return "vendor_notification_log"
  return "broadcast_notification_log"
}

function optedOut(row: {
  sms_consent_status?: string | null
  sms_opt_out_at?: string | null
  activation_status?: string | null
}): boolean {
  if (row.sms_opt_out_at) return true
  const consent = (row.sms_consent_status ?? "").trim().toLowerCase()
  const activation = (row.activation_status ?? "").trim().toLowerCase()
  return consent === "opted_out" || activation === "opted_out"
}

async function recipientOptedOut(
  supabase: SupabaseClient,
  landlordId: string,
  email: string,
  phone: string,
): Promise<boolean> {
  if (email) {
    const { data } = await supabase
      .from("users")
      .select("sms_consent_status, sms_opt_out_at, activation_status")
      .eq("landlord_id", landlordId)
      .ilike("email", email)
      .limit(5)
    if ((data ?? []).some((row) => optedOut(row))) return true
  }
  const digits = phone.replace(/\D/g, "")
  const national = digits.length >= 10 ? digits.slice(-10) : ""
  if (national.length === 10) {
    const { data } = await supabase
      .from("users")
      .select("sms_consent_status, sms_opt_out_at, activation_status")
      .eq("landlord_id", landlordId)
      .ilike("phone", `%${national}%`)
      .limit(5)
    if ((data ?? []).some((row) => optedOut(row))) return true
  }
  return false
}

async function loadDeliveryLog(
  supabase: SupabaseClient,
  input: { source: RetrySource; logId: string; landlordIds: string[] | null },
): Promise<DeliveryLog | null> {
  let query = supabase
    .from(tableFor(input.source))
    .select("id, landlord_id, created_at, retry_count, last_retry_at, delivery_status, channel")
    .eq("id", input.logId)
  if (input.landlordIds) query = query.in("landlord_id", input.landlordIds)
  const { data, error } = await query.maybeSingle()
  if (error || !data?.id || typeof data.landlord_id !== "string") return null

  let email = ""
  let phone = ""
  if (input.source === "resident") {
    const { data: full } = await supabase
      .from("resident_notification_log")
      .select("ticket_id, maintenance_requests(email, resident_phone)")
      .eq("id", input.logId)
      .maybeSingle()
    const ticket = Array.isArray(full?.maintenance_requests)
      ? full?.maintenance_requests[0]
      : full?.maintenance_requests
    email = typeof ticket?.email === "string" ? ticket.email.trim() : ""
    phone = typeof ticket?.resident_phone === "string" ? ticket.resident_phone : ""
  } else if (input.source === "vendor") {
    const { data: full } = await supabase
      .from("vendor_notification_log")
      .select("vendors(email, phone)")
      .eq("id", input.logId)
      .maybeSingle()
    const vendor = Array.isArray(full?.vendors) ? full?.vendors[0] : full?.vendors
    email = typeof vendor?.email === "string" ? vendor.email.trim() : ""
    phone = typeof vendor?.phone === "string" ? vendor.phone : ""
  } else {
    const { data: full } = await supabase
      .from("broadcast_notification_log")
      .select("recipient_email, recipient_user_id")
      .eq("id", input.logId)
      .maybeSingle()
    email = typeof full?.recipient_email === "string" ? full.recipient_email.trim() : ""
    if (typeof full?.recipient_user_id === "string") {
      const { data: user } = await supabase
        .from("users")
        .select("email, phone, sms_consent_status, sms_opt_out_at, activation_status")
        .eq("id", full.recipient_user_id)
        .maybeSingle()
      if (!email && typeof user?.email === "string") email = user.email.trim()
      phone = typeof user?.phone === "string" ? user.phone : ""
      if (user && optedOut(user)) {
        return toLog(data, input.source, true)
      }
    }
  }

  const optedOutRecipient = await recipientOptedOut(
    supabase,
    data.landlord_id,
    email,
    phone,
  )
  return toLog(data, input.source, optedOutRecipient)
}

function toLog(
  data: {
    id: string
    landlord_id: string
    created_at?: string
    retry_count?: number | null
    last_retry_at?: string | null
    delivery_status?: string | null
    channel?: string | null
  },
  source: RetrySource,
  recipientOptedOut: boolean,
): DeliveryLog {
  const channel: RetryChannel = data.channel === "email" ? "email" : "sms"
  return {
    id: data.id,
    landlordId: data.landlord_id,
    source,
    channel,
    status: typeof data.delivery_status === "string" ? data.delivery_status : "",
    createdAt: typeof data.created_at === "string" ? data.created_at : "",
    retryCount: typeof data.retry_count === "number" ? data.retry_count : 0,
    lastRetryAt: typeof data.last_retry_at === "string" ? data.last_retry_at : null,
    recipientOptedOut,
    results: {},
  }
}

function asClaim(value: unknown): ClaimOutcome {
  const row = value as {
    kind?: string
    status?: number
    reason?: string
    body?: Record<string, unknown>
    retryCount?: number
    idempotencyKey?: string
  }
  if (row?.kind === "replay" && row.body) return { kind: "replay", body: row.body }
  if (row?.kind === "send" && row.idempotencyKey && typeof row.retryCount === "number") {
    return { kind: "send", retryCount: row.retryCount, idempotencyKey: row.idempotencyKey }
  }
  return {
    kind: "deny",
    status: typeof row?.status === "number" ? row.status : 400,
    reason: typeof row?.reason === "string" ? row.reason : "retry_failed",
  }
}

export function buildRetryDeps(
  supabase: SupabaseClient,
  env: RetryDeps["env"] & { supabaseUrl: string },
  send: RetryDeps["send"],
): RetryDeps {
  return {
    env,
    resolveLandlords: async (jwt) => {
      const res = await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: env.anonKey },
      })
      if (!res.ok) return null
      const user = (await res.json()) as { email?: unknown }
      const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : ""
      if (!email) return null
      const { data, error } = await supabase
        .from("landlord_portal_members")
        .select("landlord_id")
        .eq("email", email)
      if (error) return null
      return (data ?? [])
        .map((row) =>
          typeof (row as { landlord_id?: unknown }).landlord_id === "string"
            ? (row as { landlord_id: string }).landlord_id
            : "",
        )
        .filter(Boolean)
    },
    loadLog: (input) => loadDeliveryLog(supabase, input),
    claim: async (log) => {
      const { data, error } = await supabase.rpc("claim_delivery_retry", {
        p_source: log.source,
        p_log_id: log.id,
        p_landlord_id: log.landlordId,
        p_opted_out: log.recipientOptedOut,
      })
      if (error) return { kind: "deny", status: 500, reason: "claim_failed" }
      return asClaim(data)
    },
    send,
    storeResult: async (key, body) => {
      await supabase.rpc("complete_delivery_retry", { p_key: key, p_result: body })
    },
  }
}

export async function serveRetryFailedDelivery(
  req: Request,
  supabase: SupabaseClient,
  env: RetryDeps["env"] & { supabaseUrl: string },
  send: RetryDeps["send"],
): Promise<Response> {
  return handleRetryFailedDelivery(req, buildRetryDeps(supabase, env, send))
}
