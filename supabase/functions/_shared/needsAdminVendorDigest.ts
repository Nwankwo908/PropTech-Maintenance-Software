/**
 * Daily digest: tickets stuck in sticky needs_admin_vendor for >24h.
 * Email only to SMS_ADMIN_NOTIFY_EMAILS (no SMS). One line per ticket, once per day.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "./delivery.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { adminNotifyEmailsFromEnv } from "./landlordOpsNotify.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import { formatUnitReference } from "./properties/unitLabelDisplay.ts"

const HOUR_MS = 60 * 60 * 1000
const STUCK_AFTER_MS = 24 * HOUR_MS

export type NeedsAdminDigestLine = {
  ticketId: string
  landlordId: string
  landlordName: string
  residentName: string
  issue: string
  hoursWaiting: number
  link: string
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function buildNeedsAdminVendorDigestEmail(
  lines: NeedsAdminDigestLine[],
  dayKey: string,
): { subject: string; text: string; html: string } {
  const subject = `Ulo: ${lines.length} ticket${lines.length === 1 ? "" : "s"} waiting for a vendor (${dayKey})`
  const bodyLines = lines.map(
    (l) =>
      `${l.landlordName} · ${formatWorkOrderRef(l.ticketId)} · ${l.residentName || "Resident"} · ${l.issue} · ${l.hoursWaiting}h · ${l.link}`,
  )
  const text = [
    `Tickets in needs_admin_vendor for over 24 hours (${dayKey}):`,
    "",
    ...bodyLines,
    "",
    "These stay parked until someone assigns a vendor or hands the ticket back to automation.",
  ].join("\n")
  const html = `<p>Tickets in needs_admin_vendor for over 24 hours (${dayKey}):</p><ul>${
    lines
      .map(
        (l) =>
          `<li><strong>${escapeHtml(l.landlordName)}</strong> · <a href="${escapeHtml(l.link)}">${escapeHtml(formatWorkOrderRef(l.ticketId))}</a> · ${escapeHtml(l.residentName || "Resident")} · ${escapeHtml(l.issue)} · ${l.hoursWaiting}h</li>`,
      )
      .join("")
  }</ul><p>These stay parked until someone assigns a vendor or hands the ticket back to automation.</p>`
  return { subject, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function loadNeedsAdminVendorDigestLines(
  supabase: SupabaseClient,
  opts?: { nowMs?: number; excludeDemo?: boolean },
): Promise<NeedsAdminDigestLine[]> {
  const nowMs = opts?.nowMs ?? Date.now()
  const cutoffIso = new Date(nowMs - STUCK_AFTER_MS).toISOString()

  let query = supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, description, issue_headline, issue_category, auto_reassign_last_outcome, auto_reassign_same_outcome_since, created_at",
    )
    .like("auto_reassign_last_outcome", "needs_admin_vendor|%")
    .or(
      `auto_reassign_same_outcome_since.lte.${cutoffIso},and(auto_reassign_same_outcome_since.is.null,created_at.lte.${cutoffIso})`,
    )
    .limit(200)

  const { data: rows, error } = await query
  if (error) {
    console.error("[needs-admin-digest] load tickets", error.message)
    throw new Error(`needs_admin_digest_query_failed: ${error.message}`)
  }

  const landlordIds = [
    ...new Set(
      (rows ?? [])
        .map((r) => (typeof r.landlord_id === "string" ? r.landlord_id : ""))
        .filter(Boolean),
    ),
  ]

  const landlordMeta = new Map<string, { name: string; isDemo: boolean }>()
  if (landlordIds.length > 0) {
    const { data: landlords } = await supabase
      .from("landlords")
      .select("id, name, is_demo")
      .in("id", landlordIds)
    for (const l of landlords ?? []) {
      const id = typeof l.id === "string" ? l.id : ""
      if (!id) continue
      landlordMeta.set(id, {
        name: typeof l.name === "string" && l.name.trim() ? l.name.trim() : "Landlord",
        isDemo: l.is_demo === true,
      })
    }
  }

  const excludeDemo = opts?.excludeDemo !== false
  const lines: NeedsAdminDigestLine[] = []
  for (const row of rows ?? []) {
    const ticketId = typeof row.id === "string" ? row.id : ""
    const landlordId =
      typeof row.landlord_id === "string" ? row.landlord_id : ""
    if (!ticketId || !landlordId) continue
    const meta = landlordMeta.get(landlordId)
    if (excludeDemo && meta?.isDemo) continue

    const sinceRaw =
      typeof row.auto_reassign_same_outcome_since === "string"
        ? row.auto_reassign_same_outcome_since
        : typeof row.created_at === "string"
          ? row.created_at
          : null
    const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN
    if (!Number.isFinite(sinceMs) || nowMs - sinceMs < STUCK_AFTER_MS) continue

    const hoursWaiting = Math.max(24, Math.floor((nowMs - sinceMs) / HOUR_MS))
    const issue =
      (typeof row.issue_headline === "string" && row.issue_headline.trim()) ||
      (typeof row.description === "string" &&
        row.description.trim().split("\n")[0]?.trim()) ||
      (typeof row.issue_category === "string" && row.issue_category.trim()) ||
      "Maintenance request"
    const unit = typeof row.unit === "string" ? row.unit.trim() : ""
    const resident =
      (typeof row.resident_name === "string" && row.resident_name.trim()) ||
      (formatUnitReference(unit) || "")

    lines.push({
      ticketId,
      landlordId,
      landlordName: meta?.name ?? "Landlord",
      residentName: resident,
      issue: issue.slice(0, 120),
      hoursWaiting,
      link: uloAppUrl.adminWorkOrder(formatWorkOrderRef(ticketId)),
    })
  }

  lines.sort((a, b) => b.hoursWaiting - a.hoursWaiting)
  return lines
}

async function digestAlreadySentToday(
  supabase: SupabaseClient,
  dayKey: string,
): Promise<boolean> {
  const since = `${dayKey}T00:00:00.000Z`
  const { data } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("event_type", "ops.needs_admin_vendor_digest")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10)
  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (meta?.day_key === dayKey) return true
  }
  return false
}

/**
 * Send today's digest if any stuck tickets and not already sent for this UTC day.
 * Returns skipped when empty list, no recipients, or already sent.
 */
export async function sendNeedsAdminVendorDigest(
  supabase: SupabaseClient,
  opts?: { nowMs?: number; force?: boolean; dryRun?: boolean },
): Promise<{
  sent: boolean
  skipped?: string
  dayKey: string
  lineCount: number
  recipients: string[]
}> {
  const dayKey = utcDayKey(opts?.nowMs ? new Date(opts.nowMs) : new Date())
  const recipients = adminNotifyEmailsFromEnv()
  if (recipients.length === 0) {
    return {
      sent: false,
      skipped: "no_sms_admin_notify_emails",
      dayKey,
      lineCount: 0,
      recipients: [],
    }
  }

  if (!opts?.force && (await digestAlreadySentToday(supabase, dayKey))) {
    return {
      sent: false,
      skipped: "already_sent_today",
      dayKey,
      lineCount: 0,
      recipients,
    }
  }

  const lines = await loadNeedsAdminVendorDigestLines(supabase, {
    nowMs: opts?.nowMs,
    excludeDemo: true,
  })
  if (lines.length === 0) {
    return {
      sent: false,
      skipped: "no_stuck_tickets",
      dayKey,
      lineCount: 0,
      recipients,
    }
  }

  const email = buildNeedsAdminVendorDigestEmail(lines, dayKey)
  if (opts?.dryRun) {
    return {
      sent: false,
      skipped: "dry_run",
      dayKey,
      lineCount: lines.length,
      recipients,
    }
  }

  const sentTo: string[] = []
  const errors: string[] = []
  for (const to of recipients) {
    const send = await sendResendEmail(to, email.subject, email.text, email.html)
    if ("error" in send) {
      errors.push(`${to}:${send.error}`)
      continue
    }
    sentTo.push(to)
  }
  if (sentTo.length === 0) {
    throw new Error(
      `needs_admin_digest_send_failed: ${errors.join("; ") || "no recipients sent"}`,
    )
  }

  const primaryLandlordId = lines[0]?.landlordId
  if (primaryLandlordId) {
    try {
      await recordActivityLog(supabase, {
        landlordId: primaryLandlordId,
        eventType: "ops.needs_admin_vendor_digest",
        source: "automation",
        actorType: "system",
        metadata: {
          message: `Staff digest: ${lines.length} tickets waiting for a vendor (>24h).`,
          day_key: dayKey,
          ticket_ids: lines.map((l) => l.ticketId),
          recipients: sentTo,
          send_errors: errors,
        },
      })
    } catch (e) {
      console.error("[needs-admin-digest] activity log", e)
    }
  }

  return {
    sent: true,
    dayKey,
    lineCount: lines.length,
    recipients: sentTo,
  }
}
