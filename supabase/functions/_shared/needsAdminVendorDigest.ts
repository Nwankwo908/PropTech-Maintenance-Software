/**
 * Daily digest: tickets stuck in sticky needs_admin_vendor for >24h.
 * Email only to SMS_ADMIN_NOTIFY_EMAILS (no SMS). Redesigned via buildAdminVendorDigest.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  buildAdminVendorDigest,
  type StaleVendorTicket,
} from "./adminVendorDigest.ts"
import { sendResendEmail } from "./delivery.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { adminNotifyEmailsFromEnv } from "./landlordOpsNotify.ts"
import { formatUnitReference } from "./properties/unitLabelDisplay.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

const HOUR_MS = 60 * 60 * 1000
const STUCK_AFTER_MS = 24 * HOUR_MS
const THRESHOLD_HOURS = 24

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function propertyAddressLine(row: {
  street_address?: string | null
  name?: string | null
}): string | null {
  const street =
    typeof row.street_address === "string" ? row.street_address.trim() : ""
  if (street) return street
  const name = typeof row.name === "string" ? row.name.trim() : ""
  return name || null
}

/**
 * Load sticky needs_admin_vendor tickets older than 24h and map to StaleVendorTicket.
 * Keeps the same sticky filter / parked-since threshold as the previous digest.
 */
export async function loadStaleVendorTickets(
  supabase: SupabaseClient,
  opts?: { nowMs?: number; excludeDemo?: boolean; thresholdHours?: number },
): Promise<{ tickets: StaleVendorTicket[]; primaryLandlordId: string | null }> {
  const nowMs = opts?.nowMs ?? Date.now()
  const thresholdHours = opts?.thresholdHours ?? THRESHOLD_HOURS
  const stuckAfterMs = thresholdHours * HOUR_MS
  const cutoffIso = new Date(nowMs - stuckAfterMs).toISOString()

  const { data: rows, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, property_id, unit_id, unit, resident_name, resident_phone, description, photo_paths, created_at, auto_reassign_same_outcome_since, summary, category, room, location_detail, context_urgency",
    )
    .like("auto_reassign_last_outcome", "needs_admin_vendor|%")
    .or(
      `auto_reassign_same_outcome_since.lte.${cutoffIso},and(auto_reassign_same_outcome_since.is.null,created_at.lte.${cutoffIso})`,
    )
    .limit(200)

  if (error) {
    console.error("[needs-admin-digest] load tickets", error.message)
    throw new Error(`needs_admin_digest_query_failed: ${error.message}`)
  }

  const list = rows ?? []
  const landlordIds = [
    ...new Set(
      list
        .map((r) => (typeof r.landlord_id === "string" ? r.landlord_id : ""))
        .filter(Boolean),
    ),
  ]
  const propertyIds = [
    ...new Set(
      list
        .map((r) => (typeof r.property_id === "string" ? r.property_id : ""))
        .filter(Boolean),
    ),
  ]
  const unitIds = [
    ...new Set(
      list
        .map((r) => (typeof r.unit_id === "string" ? r.unit_id : ""))
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
        name:
          typeof l.name === "string" && l.name.trim() ? l.name.trim() : "Landlord",
        isDemo: l.is_demo === true,
      })
    }
  }

  const propertyMeta = new Map<
    string,
    { address: string | null; propertyType: string | null }
  >()
  if (propertyIds.length > 0) {
    const { data: properties } = await supabase
      .from("properties")
      .select("id, name, street_address, property_type")
      .in("id", propertyIds)
    for (const p of properties ?? []) {
      const id = typeof p.id === "string" ? p.id : ""
      if (!id) continue
      propertyMeta.set(id, {
        address: propertyAddressLine(p),
        propertyType:
          typeof p.property_type === "string" ? p.property_type : null,
      })
    }
  }

  const unitMeta = new Map<string, { label: string | null }>()
  if (unitIds.length > 0) {
    const { data: units } = await supabase
      .from("units")
      .select("id, unit_label")
      .in("id", unitIds)
    for (const u of units ?? []) {
      const id = typeof u.id === "string" ? u.id : ""
      if (!id) continue
      unitMeta.set(id, {
        label:
          typeof u.unit_label === "string" && u.unit_label.trim()
            ? u.unit_label.trim()
            : null,
      })
    }
  }

  // Active occupancy → current tenant (for HQS "Resident" placeholders).
  const tenantByUnitId = new Map<
    string,
    { name: string | null; phone: string | null }
  >()
  if (unitIds.length > 0) {
    const { data: occ } = await supabase
      .from("occupancy")
      .select("unit_id, resident_id")
      .in("unit_id", unitIds)
      .eq("status", "active")
    const residentIds = [
      ...new Set(
        (occ ?? [])
          .map((o) =>
            typeof o.resident_id === "string" ? o.resident_id : "",
          )
          .filter(Boolean),
      ),
    ]
    const residents = new Map<string, { name: string | null; phone: string | null }>()
    if (residentIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, phone")
        .in("id", residentIds)
      for (const u of users ?? []) {
        const id = typeof u.id === "string" ? u.id : ""
        if (!id) continue
        residents.set(id, {
          name:
            typeof u.full_name === "string" && u.full_name.trim()
              ? u.full_name.trim()
              : null,
          phone:
            typeof u.phone === "string" && u.phone.trim()
              ? u.phone.trim()
              : null,
        })
      }
    }
    for (const o of occ ?? []) {
      const unitId = typeof o.unit_id === "string" ? o.unit_id : ""
      const residentId =
        typeof o.resident_id === "string" ? o.resident_id : ""
      if (!unitId || !residentId) continue
      const r = residents.get(residentId)
      if (r) tenantByUnitId.set(unitId, r)
    }
  }

  const excludeDemo = opts?.excludeDemo !== false
  const tickets: StaleVendorTicket[] = []
  let primaryLandlordId: string | null = null
  for (const row of list) {
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
    if (!Number.isFinite(sinceMs) || nowMs - sinceMs < stuckAfterMs) continue

    const propertyId =
      typeof row.property_id === "string" ? row.property_id : null
    const unitId = typeof row.unit_id === "string" ? row.unit_id : null
    const prop = propertyId ? propertyMeta.get(propertyId) : undefined
    const unitRow = unitId ? unitMeta.get(unitId) : undefined
    const unitLabel =
      unitRow?.label ??
      (typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null)
    const unitDisplay = unitLabel
      ? formatUnitReference(unitLabel, prop?.propertyType) || unitLabel
      : null

    let residentName =
      typeof row.resident_name === "string" && row.resident_name.trim()
        ? row.resident_name.trim()
        : null
    let residentPhone =
      typeof row.resident_phone === "string" && row.resident_phone.trim()
        ? row.resident_phone.trim()
        : null

    // HQS imports often store "Resident" — prefer the unit's current tenant.
    if (residentName && /^resident$/i.test(residentName) && unitId) {
      const tenant = tenantByUnitId.get(unitId)
      if (tenant?.name) residentName = tenant.name
      if (tenant?.phone) residentPhone = tenant.phone
    }

    const photos = Array.isArray(row.photo_paths) ? row.photo_paths : []
    const description =
      typeof row.description === "string" ? row.description : ""

    if (!primaryLandlordId) primaryLandlordId = landlordId

    tickets.push({
      id: ticketId,
      displayId: formatWorkOrderRef(ticketId),
      landlordName: meta?.name ?? "Landlord",
      description,
      createdAt:
        typeof row.created_at === "string"
          ? row.created_at
          : new Date(sinceMs).toISOString(),
      parkedSince: sinceRaw,
      propertyId,
      propertyAddress: prop?.address ?? null,
      unit: unitDisplay,
      residentName,
      residentPhone,
      photoCount: photos.filter((p) => typeof p === "string" && p.trim())
        .length,
      summary: typeof row.summary === "string" ? row.summary : null,
      category: typeof row.category === "string" ? row.category : null,
      room: typeof row.room === "string" ? row.room : null,
      locationDetail:
        typeof row.location_detail === "string" ? row.location_detail : null,
      // Staff digest urgency only — never map resident-facing `urgency`
      // (low|normal|urgent). That column is intentionally not selected above.
      urgency:
        typeof row.context_urgency === "string" ? row.context_urgency : null,
    })
  }

  tickets.sort((a, b) => {
    const aSince = Date.parse(a.parkedSince ?? a.createdAt)
    const bSince = Date.parse(b.parkedSince ?? b.createdAt)
    return aSince - bSince
  })
  return { tickets, primaryLandlordId }
}

/** @deprecated Use loadStaleVendorTickets — kept for any external imports. */
export async function loadNeedsAdminVendorDigestLines(
  supabase: SupabaseClient,
  opts?: { nowMs?: number; excludeDemo?: boolean },
): Promise<StaleVendorTicket[]> {
  const { tickets } = await loadStaleVendorTickets(supabase, opts)
  return tickets
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

export type NeedsAdminVendorDigestResult = {
  sent: boolean
  skipped?: string
  dayKey: string
  lineCount: number
  recipients: string[]
  /** Present on dryRun / preview — full email body without marking sent. */
  subject?: string
  html?: string
  text?: string
}

/**
 * Send today's digest if any stuck tickets and not already sent for this UTC day.
 *
 * Preview (does not mark sent, skips once-per-day guard):
 * - `dryRun: true` → return { subject, html, text }, no email
 * - `preview: true` + optional `recipients` → send only to those addresses,
 *   still no activity-log day_key mark
 *
 * One-liner (Edge):
 *   curl -sS -X POST "$SUPABASE_URL/functions/v1/run-ops-sms-crons" \
 *     -H "Authorization: Bearer $ULO_OPS_CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"needs_admin_digest_only":true,"dry_run":true}'
 */
export async function sendNeedsAdminVendorDigest(
  supabase: SupabaseClient,
  opts?: {
    nowMs?: number
    force?: boolean
    dryRun?: boolean
    /** Send without writing ops.needs_admin_vendor_digest (no once-per-day mark). */
    preview?: boolean
    /** Override SMS_ADMIN_NOTIFY_EMAILS (preview or real send). */
    recipients?: string[]
  },
): Promise<NeedsAdminVendorDigestResult> {
  const dayKey = utcDayKey(opts?.nowMs ? new Date(opts.nowMs) : new Date())
  const isDryRun = opts?.dryRun === true
  const isPreview = opts?.preview === true
  const skipDayGuard = isDryRun || isPreview || opts?.force === true

  const recipients =
    opts?.recipients && opts.recipients.length > 0
      ? opts.recipients.map((e) => e.trim()).filter(Boolean)
      : adminNotifyEmailsFromEnv()

  if (!isDryRun && recipients.length === 0) {
    return {
      sent: false,
      skipped: "no_sms_admin_notify_emails",
      dayKey,
      lineCount: 0,
      recipients: [],
    }
  }

  if (!skipDayGuard && (await digestAlreadySentToday(supabase, dayKey))) {
    return {
      sent: false,
      skipped: "already_sent_today",
      dayKey,
      lineCount: 0,
      recipients,
    }
  }

  const { tickets, primaryLandlordId } = await loadStaleVendorTickets(supabase, {
    nowMs: opts?.nowMs,
    excludeDemo: true,
    thresholdHours: THRESHOLD_HOURS,
  })
  if (tickets.length === 0) {
    return {
      sent: false,
      skipped: "no_stuck_tickets",
      dayKey,
      lineCount: 0,
      recipients,
    }
  }

  // No assign-vendor deep link in uloAppUrl — view ticket only.
  const email = buildAdminVendorDigest(tickets, {
    now: opts?.nowMs ? new Date(opts.nowMs) : new Date(),
    thresholdHours: THRESHOLD_HOURS,
    ticketUrl: (displayId) => uloAppUrl.adminWorkOrder(displayId),
  })
  if (!email) {
    return {
      sent: false,
      skipped: "no_stuck_tickets",
      dayKey,
      lineCount: 0,
      recipients,
    }
  }

  if (isDryRun) {
    return {
      sent: false,
      skipped: "dry_run",
      dayKey,
      lineCount: tickets.length,
      recipients,
      subject: email.subject,
      html: email.html,
      text: email.text,
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

  // Preview sends must not write the day_key activity log (once-per-day guard).
  if (!isPreview && primaryLandlordId) {
    try {
      await recordActivityLog(supabase, {
        landlordId: primaryLandlordId,
        eventType: "ops.needs_admin_vendor_digest",
        source: "automation",
        actorType: "system",
        metadata: {
          message: `Staff digest: ${tickets.length} tickets waiting for a vendor (>24h).`,
          day_key: dayKey,
          ticket_ids: tickets.map((t) => t.id),
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
    lineCount: tickets.length,
    recipients: sentTo,
    ...(isPreview
      ? {
          skipped: "preview",
          subject: email.subject,
          html: email.html,
          text: email.text,
        }
      : {}),
  }
}
