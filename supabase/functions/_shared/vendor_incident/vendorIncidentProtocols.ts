/**
 * Vendor Incident Protocols — pre-launch gates before marketplace matching.
 *
 * | Protocol           | Key rule                                              |
 * |--------------------|-------------------------------------------------------|
 * | 1 — No-Show        | T+120 notify landlord+tenant; T+125 rematch (auto)    |
 * | 2 — Property Damage| $1M COI + Ulo AI; Ulo never pays claims; suspend      |
 * | 3 — Bad Actor      | Suspend immediately; Class A founder call ≤15min; bans|
 *
 * Matching requires vendor ACTIVE — see isVendorMatchableForDispatch.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import { notifyResident } from "../resident_notify.ts"
import { getSMSProvider } from "../sms/providerFactory.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { tryNoShowVendorRematch } from "../vendor_reassignment.ts"
import {
  reportVendorMisconduct,
  type MisconductClass,
} from "../vendor_performance/vendorPerformanceStandards.ts"

/** Minutes after scheduled_at for landlord + tenant notify. */
export const NOSHOW_NOTIFY_MINUTES = 120
/** Minutes after scheduled_at for automatic rematch. */
export const NOSHOW_REMATCH_MINUTES = 125

export type NoShowIncidentSummary = {
  recorded: number
  notified: number
  rematched: number
  errors: string[]
}

function adminNotifyPhones(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ?? ""
  return raw.split(",").map((p: string) => p.trim()).filter(Boolean)
}

function founderNotifyPhones(): string[] {
  const raw = Deno.env.get("FOUNDER_NOTIFY_PHONES")?.trim() ??
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ??
    ""
  return raw.split(",").map((p: string) => p.trim()).filter(Boolean)
}

function founderNotifyEmails(): string[] {
  const raw = Deno.env.get("FOUNDER_NOTIFY_EMAILS")?.trim() ?? ""
  return raw.split(",").map((e: string) => e.trim()).filter(Boolean)
}

async function notifyOpsSms(
  supabase: SupabaseClient,
  landlordId: string,
  body: string,
  phones: string[],
): Promise<void> {
  if (phones.length === 0) return
  const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
  if (!line?.phone) return
  const provider = getSMSProvider()
  for (const to of phones) {
    const send = await provider.sendMessage({
      to,
      body,
      from: line.phone,
    })
    if (send.error) {
      console.warn("[vendor-incident] ops SMS failed", to, send.error)
    }
  }
}

export function buildNoShowLandlordEmail(input: {
  vendorName: string
  unit: string
  scheduledAt: string
}): { subject: string; text: string; html: string } {
  const when = new Date(input.scheduledAt).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  })
  const subject = `${input.vendorName} missed the appointment${
    input.unit ? ` (${input.unit})` : ""
  }`
  const text =
    `${input.vendorName} did not arrive for the confirmed appointment` +
    (input.unit ? ` at ${input.unit}` : "") +
    ` (scheduled ${when} UTC).\n\n` +
    `The resident was notified. Ulo will automatically find another vendor in a few minutes.`
  const html =
    `<p><strong>${input.vendorName}</strong> did not arrive for the confirmed appointment` +
    (input.unit ? ` at <strong>${input.unit}</strong>` : "") +
    ` (scheduled ${when} UTC).</p>` +
    `<p>The resident was notified. Ulo will automatically find another vendor in a few minutes.</p>`
  return { subject, text, html }
}

/**
 * Protocol 1 — No-Show.
 * Record at T+120, notify landlord+tenant, rematch at T+125.
 */
export async function processNoShowIncidents(
  supabase: SupabaseClient,
  landlordId: string | null,
  now = new Date(),
): Promise<NoShowIncidentSummary> {
  const summary: NoShowIncidentSummary = {
    recorded: 0,
    notified: 0,
    rematched: 0,
    errors: [],
  }

  const notifyCutoff = new Date(
    now.getTime() - NOSHOW_NOTIFY_MINUTES * 60_000,
  ).toISOString()
  const rematchCutoff = new Date(
    now.getTime() - NOSHOW_REMATCH_MINUTES * 60_000,
  ).toISOString()

  // --- Record + notify candidates past T+120 ---
  let query = supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, scheduled_at, schedule_confirmed_at, " +
        "vendor_work_status, unit, resident_name, email, resident_phone, " +
        "resident_notification_channel, issue_category",
    )
    .not("schedule_confirmed_at", "is", null)
    .not("scheduled_at", "is", null)
    .not("assigned_vendor_id", "is", null)
    .lt("scheduled_at", notifyCutoff)
    .in("vendor_work_status", ["accepted", "pending_accept"])
    .limit(200)

  if (landlordId?.trim()) {
    query = query.eq("landlord_id", landlordId.trim())
  }

  const { data: tickets, error } = await query
  if (error) {
    summary.errors.push(error.message)
    return summary
  }

  for (const raw of tickets ?? []) {
    const ticket = raw as Record<string, unknown>
    const ticketId = typeof ticket.id === "string" ? ticket.id : ""
    const lid = typeof ticket.landlord_id === "string" ? ticket.landlord_id : ""
    const vendorId = typeof ticket.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id
      : ""
    const scheduledAt = typeof ticket.scheduled_at === "string"
      ? ticket.scheduled_at
      : ""
    if (!ticketId || !lid || !vendorId || !scheduledAt) continue

    // Upsert no-show row (unique on maintenance_request_id).
    const { data: existing } = await supabase
      .from("vendor_job_no_shows")
      .select("id, landlord_tenant_notified_at, rematched_at")
      .eq("maintenance_request_id", ticketId)
      .maybeSingle()

    let noShowId = typeof existing?.id === "string" ? existing.id : null
    if (!noShowId) {
      const { data: inserted, error: insertErr } = await supabase
        .from("vendor_job_no_shows")
        .insert({
          landlord_id: lid,
          vendor_id: vendorId,
          maintenance_request_id: ticketId,
          scheduled_at: scheduledAt,
          source: "incident_protocol",
        })
        .select("id")
        .maybeSingle()
      if (insertErr) {
        if (!/duplicate|unique/i.test(insertErr.message)) {
          summary.errors.push(insertErr.message)
        }
        const { data: again } = await supabase
          .from("vendor_job_no_shows")
          .select("id, landlord_tenant_notified_at, rematched_at")
          .eq("maintenance_request_id", ticketId)
          .maybeSingle()
        noShowId = typeof again?.id === "string" ? again.id : null
        if (!noShowId) continue
        Object.assign(existing ?? {}, again)
      } else {
        noShowId = typeof inserted?.id === "string" ? inserted.id : null
        summary.recorded += 1
        await logGraphEvent(supabase, {
          landlord_id: lid,
          event_type: "vendor.job_no_show",
          source: "automation",
          actor_type: "system",
          vendor_id: vendorId,
          maintenance_request_id: ticketId,
          metadata: {
            scheduled_at: scheduledAt,
            protocol: "no_show",
            summary: "Confirmed appointment lapsed (T+120) — no-show recorded.",
          },
        })
      }
    }

    const { data: noshowRow } = await supabase
      .from("vendor_job_no_shows")
      .select("id, landlord_tenant_notified_at, rematched_at")
      .eq("maintenance_request_id", ticketId)
      .maybeSingle()

    if (!noshowRow?.id) continue

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("id", vendorId)
      .maybeSingle()
    const vendorName =
      (typeof vendor?.name === "string" && vendor.name.trim()) || "The vendor"
    const unit = typeof ticket.unit === "string" ? ticket.unit.trim() : ""

    // T+120 notify
    if (!noshowRow.landlord_tenant_notified_at) {
      const email = buildNoShowLandlordEmail({
        vendorName,
        unit,
        scheduledAt,
      })
      await sendLandlordOpsEmail(supabase, {
        landlordId: lid,
        subject: email.subject,
        text: email.text,
        html: email.html,
        logLabel: "vendor_noshow_landlord",
      })

      await notifyResident(supabase, {
        ticketId,
        event: "vendor_no_show",
        recipientName: String(ticket.resident_name ?? ""),
        recipientEmail: typeof ticket.email === "string" ? ticket.email : "",
        recipientPhone: typeof ticket.resident_phone === "string"
          ? ticket.resident_phone
          : "",
        notificationChannel: typeof ticket.resident_notification_channel === "string"
          ? ticket.resident_notification_channel
          : null,
        unit: unit || undefined,
        vendorName,
        scheduleWindow: scheduledAt,
      })

      await supabase
        .from("vendor_job_no_shows")
        .update({ landlord_tenant_notified_at: now.toISOString() })
        .eq("id", noshowRow.id)

      await logGraphEvent(supabase, {
        landlord_id: lid,
        event_type: "vendor.noshow_notified",
        source: "automation",
        actor_type: "system",
        vendor_id: vendorId,
        maintenance_request_id: ticketId,
        metadata: {
          summary: `${vendorName} no-show — landlord and tenant notified (T+120).`,
        },
      })
      summary.notified += 1
    }

    // T+125 rematch
    const scheduledMs = new Date(scheduledAt).getTime()
    const pastRematch = !Number.isNaN(scheduledMs) &&
      scheduledMs <= now.getTime() - NOSHOW_REMATCH_MINUTES * 60_000
    if (pastRematch && !noshowRow.rematched_at) {
      const issueCategory = typeof ticket.issue_category === "string"
        ? ticket.issue_category
        : null
      const rematchResult = await tryNoShowVendorRematch(supabase, {
        ticketId,
        landlordId: lid,
        noShowVendorId: vendorId,
        noShowVendorName: vendorName,
        issueCategory,
      })
      if (rematchResult.outcome === "no_vendor") {
        summary.errors.push(`no ACTIVE rematch for ticket ${ticketId}`)
        await sendLandlordOpsEmail(supabase, {
          landlordId: lid,
          subject: `No-show rematch failed — ${vendorName}${unit ? ` (${unit})` : ""}`,
          text:
            `Could not find another Active vendor after ${vendorName} missed the appointment` +
            (unit ? ` at ${unit}` : "") +
            `. Please assign manually.`,
          html:
            `<p>Could not find another <strong>Active</strong> vendor after ` +
            `<strong>${vendorName}</strong> missed the appointment` +
            (unit ? ` at <strong>${unit}</strong>` : "") +
            `.</p><p>Please assign manually.</p>`,
          logLabel: "vendor_noshow_rematch_failed",
        })
        continue
      }
      if (rematchResult.outcome === "failed") {
        summary.errors.push(rematchResult.reason)
        continue
      }

      await supabase
        .from("vendor_job_no_shows")
        .update({
          rematched_at: now.toISOString(),
          rematch_vendor_id: rematchResult.newVendorId,
        })
        .eq("id", noshowRow.id)

      summary.rematched += 1
    } else if (
      !pastRematch &&
      scheduledAt < rematchCutoff &&
      !noshowRow.rematched_at
    ) {
      // scheduled already past rematchCutoff via query; handled above
    }
  }

  // Also rematch any already-recorded no-shows past T+125 that missed rematch.
  let pendingRematch = supabase
    .from("vendor_job_no_shows")
    .select(
      "id, landlord_id, vendor_id, maintenance_request_id, scheduled_at, rematched_at",
    )
    .is("rematched_at", null)
    .lt("scheduled_at", rematchCutoff)
    .limit(100)
  if (landlordId?.trim()) {
    pendingRematch = pendingRematch.eq("landlord_id", landlordId.trim())
  }
  const { data: pending } = await pendingRematch
  for (const row of pending ?? []) {
    const ticketId = typeof row.maintenance_request_id === "string"
      ? row.maintenance_request_id
      : ""
    const lid = typeof row.landlord_id === "string" ? row.landlord_id : ""
    const vendorId = typeof row.vendor_id === "string" ? row.vendor_id : ""
    if (!ticketId || !lid || !vendorId) continue

    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("id, vendor_work_status, issue_category, unit, assigned_vendor_id")
      .eq("id", ticketId)
      .maybeSingle()
    if (!ticket) continue
    const status = (ticket.vendor_work_status ?? "").toString()
    if (!["accepted", "pending_accept"].includes(status)) {
      // Job progressed or was reassigned elsewhere — mark rematch skipped.
      await supabase
        .from("vendor_job_no_shows")
        .update({ rematched_at: now.toISOString() })
        .eq("id", row.id)
      continue
    }
    if (ticket.assigned_vendor_id !== vendorId) {
      await supabase
        .from("vendor_job_no_shows")
        .update({
          rematched_at: now.toISOString(),
          rematch_vendor_id: ticket.assigned_vendor_id,
        })
        .eq("id", row.id)
      continue
    }

    const issueCategory = typeof ticket.issue_category === "string"
      ? ticket.issue_category
      : null

    const { data: noShowVendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", vendorId)
      .maybeSingle()
    const noShowVendorName = typeof noShowVendor?.name === "string"
      ? noShowVendor.name
      : "Vendor"

    const rematchResult = await tryNoShowVendorRematch(supabase, {
      ticketId,
      landlordId: lid,
      noShowVendorId: vendorId,
      noShowVendorName,
      issueCategory,
    })
    if (rematchResult.outcome !== "reassigned") {
      if (rematchResult.outcome === "failed") {
        summary.errors.push(rematchResult.reason)
      }
      continue
    }

    await supabase
      .from("vendor_job_no_shows")
      .update({
        rematched_at: now.toISOString(),
        rematch_vendor_id: rematchResult.newVendorId,
      })
      .eq("id", row.id)
    summary.rematched += 1
  }

  return summary
}

/**
 * Protocol 2 — Property Damage.
 * Suspend immediately pending review. Ulo does not pay claims.
 */
export async function reportPropertyDamage(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    summary: string
    reportedBy?: string | null
    maintenanceRequestId?: string | null
  },
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const summaryText = params.summary.trim()
  if (!summaryText) return { ok: false, error: "summary required" }

  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, name, phone, roster_status")
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (vendorErr || !vendor) {
    return { ok: false, error: vendorErr?.message ?? "vendor not found" }
  }
  if ((vendor.roster_status ?? "").toString().toLowerCase() === "banned") {
    return { ok: false, error: "vendor is banned" }
  }

  const { data: report, error: insertErr } = await supabase
    .from("vendor_property_damage_reports")
    .insert({
      landlord_id: params.landlordId,
      vendor_id: params.vendorId,
      summary: summaryText,
      reported_by: params.reportedBy?.trim() || null,
      maintenance_request_id: params.maintenanceRequestId?.trim() || null,
    })
    .select("id")
    .maybeSingle()

  if (insertErr) return { ok: false, error: insertErr.message }

  const { error: suspendErr } = await supabase
    .from("vendors")
    .update({
      roster_status: "suspended",
      roster_status_reason: "property_damage",
      performance_review: "suspension_review",
    })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)

  if (suspendErr) return { ok: false, error: suspendErr.message }

  const vendorName =
    (typeof vendor.name === "string" && vendor.name.trim()) || "Vendor"

  const { data: verif } = await supabase
    .from("vendor_verifications")
    .select(
      "coi_general_liability, coi_additional_insured, coi_expiration, status",
    )
    .eq("vendor_id", params.vendorId)
    .eq("landlord_id", params.landlordId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const gl = typeof verif?.coi_general_liability === "number"
    ? verif.coi_general_liability
    : null
  const ai = verif?.coi_additional_insured === true
  const coiLine = gl != null
    ? `COI on file: $${gl.toLocaleString()} GL` +
      (ai ? "; Ulo listed as Additional Insured." : "; Additional Insured not confirmed.")
    : "No COI on file."

  await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject: `${vendorName}: SUSPENDED — property damage report`,
    text:
      `${vendorName} was suspended pending review after a property damage report.\n\n` +
      `Summary: ${summaryText}\n\n` +
      `${coiLine}\n\n` +
      `Ulo does not pay property damage claims. Claims run through the vendor's insurance.`,
    html:
      `<p><strong>${vendorName}</strong> was suspended pending review after a property damage report.</p>` +
      `<p>${summaryText}</p>` +
      `<p>${coiLine}</p>` +
      `<p><strong>Ulo does not pay property damage claims.</strong> Claims run through the vendor's insurance.</p>`,
    logLabel: "vendor_property_damage",
  })

  await notifyOpsSms(
    supabase,
    params.landlordId,
    `Ulo: ${vendorName} suspended — property damage. Claims via vendor COI (Ulo does not pay).`,
    adminNotifyPhones(),
  )

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.property_damage_suspended",
    source: "edge_function",
    actor_type: "system",
    vendor_id: params.vendorId,
    maintenance_request_id: params.maintenanceRequestId?.trim() || null,
    metadata: {
      reason: "property_damage",
      report_id: report?.id ?? null,
      coi_gl: gl,
      coi_additional_insured: ai,
      summary: `${vendorName} suspended — property damage: ${summaryText}`,
    },
  })

  return { ok: true, reportId: typeof report?.id === "string" ? report.id : undefined }
}

/**
 * Protocol 3 — Bad Actor.
 * Immediate suspend (before investigation). Class A pages founder (15-min SLA).
 */
export async function reportBadActor(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    class: MisconductClass
    summary: string
    reportedBy?: string | null
    maintenanceRequestId?: string | null
  },
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const result = await reportVendorMisconduct(supabase, params)
  if (!result.ok) return result

  if (params.class === "A") {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", params.vendorId)
      .maybeSingle()
    const vendorName =
      (typeof vendor?.name === "string" && vendor.name.trim()) || "Vendor"
    const body =
      `ULO CLASS A — ${vendorName} suspended. Founder contact within 15 minutes. ` +
      `${params.summary.trim().slice(0, 140)}`

    await notifyOpsSms(
      supabase,
      params.landlordId,
      body,
      founderNotifyPhones(),
    )

    const founderEmails = founderNotifyEmails()
    if (founderEmails.length > 0) {
      await sendLandlordOpsEmail(supabase, {
        landlordId: params.landlordId,
        subject: `CLASS A SAFETY — ${vendorName} (founder contact ≤15 min)`,
        text:
          `${vendorName} was immediately suspended for a Class A (physical safety) incident.\n\n` +
          `${params.summary.trim()}\n\n` +
          `Founder contact required within 15 minutes during business hours.\n` +
          `Notify: ${founderEmails.join(", ")}`,
        html:
          `<p><strong>${vendorName}</strong> was immediately suspended for a ` +
          `<strong>Class A (physical safety)</strong> incident.</p>` +
          `<p>${params.summary.trim()}</p>` +
          `<p><strong>Founder contact required within 15 minutes</strong> during business hours.</p>`,
        logLabel: "vendor_bad_actor_class_a_founder",
      })
    }

    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.bad_actor_class_a_paged",
      source: "edge_function",
      actor_type: "system",
      vendor_id: params.vendorId,
      metadata: {
        sla_minutes: 15,
        summary: `Class A founder page for ${vendorName}.`,
      },
    })
  }

  return result
}

/** Permanent ban — irreversible. */
export async function banVendorPermanent(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    reason: string
    reportedBy?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const reason = params.reason.trim()
  if (!reason) return { ok: false, error: "reason required" }

  const { data: vendor, error } = await supabase
    .from("vendors")
    .select("id, name, roster_status")
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (error || !vendor) {
    return { ok: false, error: error?.message ?? "vendor not found" }
  }

  const { error: banErr } = await supabase
    .from("vendors")
    .update({
      roster_status: "banned",
      roster_status_reason: "permanent_ban",
      active: false,
      performance_review: null,
    })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)

  if (banErr) return { ok: false, error: banErr.message }

  const vendorName =
    (typeof vendor.name === "string" && vendor.name.trim()) || "Vendor"

  await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject: `${vendorName}: PERMANENT BAN`,
    text:
      `${vendorName} was permanently banned from the preferred vendor network.\n\n` +
      `Reason: ${reason}\n\n` +
      `Permanent bans are permanent — no reinstatement.`,
    html:
      `<p><strong>${vendorName}</strong> was permanently banned.</p>` +
      `<p>Reason: ${reason}</p>` +
      `<p>Permanent bans are permanent — no reinstatement.</p>`,
    logLabel: "vendor_permanent_ban",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.permanently_banned",
    source: "edge_function",
    actor_type: "system",
    vendor_id: params.vendorId,
    metadata: {
      reason,
      reported_by: params.reportedBy ?? null,
      summary: `${vendorName} permanently banned: ${reason}`,
    },
  })

  return { ok: true }
}

export const __test = {
  NOSHOW_NOTIFY_MINUTES,
  NOSHOW_REMATCH_MINUTES,
  buildNoShowLandlordEmail,
}
